// POST /api/ai/plan: rank the open tasks and recommend the fastest route through each.
// The model answers through structured output; whenever it cannot (no key, daily cap,
// API error, refusal, cut-off or malformed answer) the offline planner from shared takes over.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  approachFor, buildPlan, estimateMinutes, promptsFor, touch,
  type Plan, type PlanItem, type PlanRes, type SaveState, type Task,
} from '../../../shared/src/index.ts';
import type { Ctx } from '../context.ts';
import { HttpError } from '../http.ts';
import { safeTz } from '../tz.ts';
import { dailyCap, resolveNow, usageDay } from './chat.ts';
import { baseParams, describeAiError, usageLine } from './client.ts';
import { planCandidates, planRequest, planSystem } from './prompt.ts';
import { clampMinutes } from './tools.ts';

/** Thinking at medium effort plus up to fifteen detailed items. */
const MAX_TOKENS = 32_000;
/** Per attempt; the SDK retries rate limits and server errors twice on top of this. */
const REQUEST_TIMEOUT_MS = 180_000;

// Kept static: the API compiles a grammar per schema and caches it, so the schema must not
// vary per request (which is why task ids are checked afterwards instead of being an enum).
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          why: { type: 'string' },
          approach: { type: 'array', items: { type: 'string' } },
          est_min: { type: 'integer' },
          prompts: { type: 'array', items: { type: 'string' } },
        },
        required: ['task_id', 'why', 'approach', 'est_min', 'prompts'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'items'],
  additionalProperties: false,
} as const;

const planOutput = z.object({
  summary: z.string(),
  items: z.array(
    z.object({
      task_id: z.string(),
      why: z.string(),
      approach: z.array(z.string()),
      est_min: z.number().finite(),
      prompts: z.array(z.string()),
    }),
  ),
});

class PlanFailure extends Error {}

const tidy = (text: string, max: number): string => text.replace(/\s+/g, ' ').trim().slice(0, max);

function localItem(task: Task, now: number): PlanItem {
  const item = buildPlan([task], now).items[0];
  return item ?? { taskId: task.id, rank: 1, why: '', approach: approachFor(task), estMin: estimateMinutes(task), prompts: promptsFor(task) };
}

/** Turn the model's answer into a Plan over exactly the tasks it was given. */
export function toPlan(raw: unknown, tasks: Task[], now: number): Plan {
  const parsed = planOutput.safeParse(raw);
  if (!parsed.success) throw new PlanFailure('answer did not match the plan shape');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const items: PlanItem[] = [];
  const used = new Set<string>();
  for (const entry of parsed.data.items) {
    const task = byId.get(entry.task_id.trim());
    if (!task || used.has(task.id)) continue;
    used.add(task.id);
    const approach = entry.approach.map((s) => tidy(s, 400)).filter(Boolean).slice(0, 5);
    const prompts = entry.prompts.map((s) => s.trim().slice(0, 1200)).filter(Boolean).slice(0, 3);
    items.push({
      taskId: task.id,
      rank: items.length + 1,
      why: tidy(entry.why, 300),
      approach: approach.length ? approach : approachFor(task),
      estMin: clampMinutes(entry.est_min),
      prompts: prompts.length ? prompts : promptsFor(task),
    });
  }
  if (!items.length) throw new PlanFailure('answer covered none of the tasks');
  // anything the model skipped still gets a place, after the ones it ranked
  for (const task of tasks) {
    if (!used.has(task.id)) items.push({ ...localItem(task, now), rank: items.length + 1 });
  }
  const summary = tidy(parsed.data.summary, 600) || buildPlan(tasks, now).summary;
  return { generatedAt: now, summary, items, source: 'ai' };
}

async function aiPlan(ctx: Ctx, ai: Anthropic, state: SaveState, tasks: Task[], now: number, tz: string): Promise<Plan> {
  // Streamed, so a long answer cannot run into an HTTP timeout; only the final message is used.
  const stream = ai.beta.messages.stream(
    {
      ...baseParams(ctx.config),
      max_tokens: MAX_TOKENS,
      // a plain JSON-schema format (no SDK auto-parse), so stop_reason is checked before any parsing
      output_config: { effort: ctx.config.ai.planEffort, format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      system: planSystem(state),
      messages: [{ role: 'user', content: planRequest(state, tasks, now, tz) }],
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );
  const message = await stream.finalMessage();
  ctx.log.info(usageLine('plan', message));
  if (message.stop_reason === 'refusal') throw new PlanFailure(`declined (${message.stop_details?.category ?? 'uncategorised'})`);
  if (message.stop_reason !== 'end_turn') throw new PlanFailure(`stopped early (${message.stop_reason ?? 'unknown'})`);

  const boundary = message.content.findLastIndex((b) => b.type === 'fallback');
  const textOf = (from: number): string =>
    message.content
      .filter((b, i): b is Anthropic.Beta.BetaTextBlock => b.type === 'text' && i > from)
      .map((b) => b.text)
      .join('');
  // After a mid-answer fallback the JSON may be split around the boundary or restarted after it.
  for (const candidate of boundary === -1 ? [textOf(-1)] : [textOf(-1), textOf(boundary)]) {
    let raw: unknown;
    try {
      raw = JSON.parse(candidate);
    } catch {
      continue;
    }
    return toPlan(raw, tasks, now);
  }
  throw new PlanFailure('answer was not valid JSON');
}

export async function makePlan(ctx: Ctx, args: { accountId: string; deviceId: string; now: number; tz: string }): Promise<PlanRes> {
  const state = ctx.states.get(args.accountId);
  if (!state) throw new HttpError(409, 'Save your game to the server before asking for a plan', 'no_state');
  const now = resolveNow(ctx, args.now);
  const tz = safeTz(args.tz, safeTz(state.settings.tz));
  const tasks = planCandidates(state, now);

  let plan: Plan | null = null;
  const day = usageDay(ctx.now());
  if (ctx.ai && tasks.length && ctx.db.aiUsage(args.accountId, day) < dailyCap(ctx, args.accountId)) {
    ctx.db.addAiUsage(args.accountId, day, 1);
    try {
      plan = await aiPlan(ctx, ctx.ai, state, tasks, now, tz);
    } catch (err) {
      ctx.db.addAiUsage(args.accountId, day, -1);
      ctx.log.warn(`plan: falling back to the offline planner (${err instanceof PlanFailure ? err.message : describeAiError(err).log})`);
    }
  }
  plan ??= buildPlan(state.tasks, now);

  const chosen = plan;
  const saved = ctx.states.update(
    args.accountId,
    (s) => {
      s.plan = chosen;
      touch(s, 'plan');
    },
    args.deviceId,
  );
  return { plan: chosen, state: saved ?? state };
}
