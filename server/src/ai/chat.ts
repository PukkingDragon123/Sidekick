// POST /api/ai/chat: one student message in, a stream of ChatEvents out.
// A manual streaming tool loop (rather than the SDK tool runner) because the loop has to
// forward text as it arrives, publish state after each tool batch, and apply the rules for
// echoing an assistant turn that a refusal fallback split in two.
import Anthropic from '@anthropic-ai/sdk';
import { touch, uid, type ChatEvent, type ChatMsg, type SaveState } from '../../../shared/src/index.ts';
import type { Ctx } from '../context.ts';
import { CHAT_CAP } from '../state.ts';
import { safeTz } from '../tz.ts';
import { baseParams, describeAiError } from './client.ts';
import { chatSystem } from './prompt.ts';
import { chatTools, runTool, type ToolOutcome } from './tools.ts';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type ToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

const HISTORY_MESSAGES = 24;
/** Model requests per student message: the answer plus a few rounds of tool use. */
const MAX_TURNS = 6;
/** Room for thinking, a tool call as large as a saved plan, and a reply that goes into depth. */
const MAX_TOKENS = 16_000;
/** A client clock this far from ours is not believed. */
const MAX_CLIENT_CLOCK_DRIFT_MS = 12 * 3_600_000;

export type Emit = (event: ChatEvent) => void | Promise<void>;

export interface ChatArgs {
  accountId: string;
  deviceId: string;
  text: string;
  now: number;
  tz: string;
  signal?: AbortSignal;
}

/** Calendar day the per-account message allowance is counted in. */
export function usageDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function dailyCap(ctx: Ctx, accountId: string): number {
  return ctx.states.premium(accountId).plus ? ctx.config.ai.plusPerDay : ctx.config.ai.freePerDay;
}

/** The request's idea of "now", unless the client clock is clearly wrong. */
export function resolveNow(ctx: Ctx, clientNow: number): number {
  const server = ctx.now();
  return Math.abs(clientNow - server) <= MAX_CLIENT_CLOCK_DRIFT_MS ? clientNow : server;
}

/** The last stretch of the conversation as plain text turns, starting on a student turn. */
function history(state: SaveState, text: string): MessageParam[] {
  const turns: MessageParam[] = [];
  for (const m of state.chat.slice(-HISTORY_MESSAGES)) {
    if (!m.text.trim()) continue;
    turns.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  turns.push({ role: 'user', content: text });
  return turns;
}

/**
 * What to send back of an assistant turn. Normally everything, unchanged (thinking blocks
 * included). After a mid-output refusal fallback, the declining model's thinking and tool
 * calls before the final `fallback` block must be left out; text, the block itself and
 * everything after it stay where they were.
 */
export function echoable(blocks: ContentBlock[]): ContentBlockParam[] {
  const boundary = blocks.findLastIndex((b) => b.type === 'fallback');
  const kept =
    boundary === -1
      ? blocks
      : blocks.filter((b, i) => {
          if (i >= boundary) return true;
          const type: string = b.type;
          return type !== 'thinking' && type !== 'redacted_thinking' && type !== 'connector_text' && type !== 'tool_use';
        });
  return kept as ContentBlockParam[];
}

/** Tool calls that are still valid to run: those the serving model made after any fallback boundary. */
function pendingToolUses(blocks: ContentBlock[]): ToolUseBlock[] {
  const boundary = blocks.findLastIndex((b) => b.type === 'fallback');
  return blocks.filter((b, i): b is ToolUseBlock => b.type === 'tool_use' && i > boundary);
}

class ChatStop extends Error {}

export async function runChat(ctx: Ctx, args: ChatArgs, emit: Emit): Promise<void> {
  const ai = ctx.ai;
  if (!ai) {
    await emit({ type: 'error', code: 'no_ai', message: 'Chat needs an AI key on the server. Your planner still works without it.' });
    return;
  }
  const day = usageDay(ctx.now());
  if (ctx.db.aiUsage(args.accountId, day) >= dailyCap(ctx, args.accountId)) {
    await emit({ type: 'error', code: 'limit', message: 'I am all talked out for today. Ask me again tomorrow.' });
    return;
  }
  const state = ctx.states.get(args.accountId);
  if (!state) {
    await emit({ type: 'error', code: 'failed', message: 'Save your game to the server first, then ask me again.' });
    return;
  }

  ctx.db.addAiUsage(args.accountId, day, 1);
  const now = resolveNow(ctx, args.now);
  const tz = safeTz(args.tz, safeTz(state.settings.tz));
  const { ai: settings } = ctx.config;

  // Built once: system and tools must stay byte-identical for every request of this loop,
  // both for the prompt cache and because replayed thinking blocks are bound to them.
  const system = chatSystem(state, now, tz);
  const tools = chatTools(settings.eagerToolInput);
  const messages = history(state, args.text);

  let reply = '';
  const say = async (delta: string): Promise<void> => {
    reply += delta;
    await emit({ type: 'text', delta });
  };

  try {
    let unparseable = 0;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = ai.beta.messages.stream(
        { ...baseParams(ctx.config), max_tokens: MAX_TOKENS, output_config: { effort: settings.chatEffort }, system, tools, messages },
        args.signal ? { signal: args.signal } : undefined,
      );

      let spoke = false;
      let newBlock = false;
      let message: Anthropic.Beta.BetaMessage;
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'text') newBlock = true;
          else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
            // separate text that came before a tool call from text that came after it
            if (newBlock && reply && !/\s$/.test(reply) && !/^\s/.test(event.delta.text)) await say(' ');
            newBlock = false;
            spoke = true;
            await say(event.delta.text);
          }
        }
        message = await stream.finalMessage();
        unparseable = 0;
      } catch (err) {
        // With eager input streaming the SDK rejects when a tool input is not parseable
        // JSON at all. Only that is retried, and only if nothing of the turn was shown yet.
        if (err instanceof Anthropic.APIError || spoke || unparseable++ >= 2) throw err;
        turn -= 1;
        continue;
      }

      // Check why the model stopped before trusting anything it produced.
      if (message.stop_reason === 'refusal') {
        ctx.log.warn(`chat: declined (${message.stop_details?.category ?? 'uncategorised'})`);
        throw new ChatStop("That's one I can't help with. Want to pick something off your list instead?");
      }
      const calls = pendingToolUses(message.content);
      if (message.stop_reason === 'max_tokens' && calls.length) {
        // a tool input cut off at the limit can still look valid: never run it
        throw new ChatStop('I ran out of room mid-thought. Ask me that again, maybe in smaller pieces.');
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: echoable(message.content) });
        continue;
      }
      if (message.stop_reason !== 'tool_use' || !calls.length) break;

      messages.push({ role: 'assistant', content: echoable(message.content) });
      const results: ToolResult[] = [];
      let latest: SaveState | null = null;
      for (const call of calls) {
        let outcome: ToolOutcome = { content: 'The planner is not available right now.', isError: true, changed: false };
        // each call is one synchronous read-modify-write of the freshest save
        const saved = ctx.states.update(
          args.accountId,
          (s) => {
            outcome = runTool(call.name, call.input, { state: s, now: ctx.now(), tz });
          },
          args.deviceId,
        );
        if (outcome.emote) await emit({ type: 'emote', emote: outcome.emote });
        if (outcome.changed && saved) latest = saved;
        results.push(
          outcome.isError
            ? { type: 'tool_result', tool_use_id: call.id, content: outcome.content, is_error: true }
            : { type: 'tool_result', tool_use_id: call.id, content: outcome.content },
        );
      }
      if (latest) await emit({ type: 'state', state: latest });
      // every result of the turn goes back in a single user message
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError || args.signal?.aborted) return; // the student left
    if (err instanceof ChatStop) {
      await emit({ type: 'error', code: 'failed', message: err.message });
      return;
    }
    // our side broke, not the student's: this one does not count against their day
    ctx.db.addAiUsage(args.accountId, day, -1);
    const { message, log } = describeAiError(err);
    ctx.log.error(`chat: ${log}`);
    await emit({ type: 'error', code: 'failed', message });
    return;
  }

  if (!reply.trim()) await say('Done.');
  const at = ctx.now();
  const mine: ChatMsg = { id: uid(), role: 'user', text: args.text, at };
  const answer: ChatMsg = { id: uid(), role: 'sidekick', text: reply.trim(), at: at + 1 };
  ctx.states.update(
    args.accountId,
    (s) => {
      s.chat.push(mine, answer);
      if (s.chat.length > CHAT_CAP) s.chat = s.chat.slice(-CHAT_CAP);
      touch(s, 'chat');
    },
    args.deviceId,
  );
  await emit({ type: 'done', message: answer });
}
