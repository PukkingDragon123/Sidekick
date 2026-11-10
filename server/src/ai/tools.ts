// The planner tools the sidekick can call, and their server-side execution against a save.
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { guessKind, touch, uid, type Emote, type PlanItem, type SaveState, type Task } from '../../../shared/src/index.ts';
import { formatLocalIso, parseLocalDateTime } from '../tz.ts';

type Tool = Anthropic.Beta.BetaTool;

const EMOTES = ['happy', 'cheer', 'think', 'laugh', 'sad', 'surprised', 'sleepy', 'love', 'dance', 'pose', 'wave', 'nod'] as const satisfies readonly Emote[];
const KINDS = ['assignment', 'quiz', 'reading', 'project', 'exam', 'essay', 'problems', 'other'] as const;

const TIME_HINT = "The student's local time as YYYY-MM-DDTHH:MM (24-hour clock).";

// Strict schemas: every object closes with additionalProperties:false, and only genuinely
// optional fields are left out of `required` (strict mode budgets optional fields per request).
const DEFINITIONS: Tool[] = [
  {
    name: 'add_task',
    description:
      "Add a new task to the student's list. Call this when the student mentions schoolwork that is not already in the open list, or asks you to add something. Do not call it for work that is already listed.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name of the work, as the student would say it.' },
        course: { type: 'string', description: 'Class or subject, if known.' },
        due: { type: 'string', description: `Deadline. ${TIME_HINT} A date alone (YYYY-MM-DD) means the end of that day. Leave out if there is no deadline.` },
        est_min: { type: 'integer', description: 'Estimated minutes of work, if the student said or it is obvious.' },
        kind: { type: 'string', enum: [...KINDS], description: 'What sort of work it is.' },
        notes: { type: 'string', description: 'Anything the student wants remembered about it.' },
        steps: { type: 'array', items: { type: 'string' }, description: 'A short checklist, only if the student asked for the task to be broken down.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_task',
    description:
      'Change an existing task. Call this when the student asks to move a deadline, change the time estimate, pin or unpin it, add notes, rename it, or set its checklist. Only include the fields that change. Title and due time of imported tasks belong to the school and cannot be changed.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Id of the task, exactly as listed in the notes.' },
        title: { type: 'string', description: 'New name.' },
        due: { type: 'string', description: `New deadline. ${TIME_HINT} A date alone means the end of that day. Use "none" to remove the deadline.` },
        est_min: { type: 'integer', description: 'New estimate in minutes.' },
        pinned: { type: 'boolean', description: 'true to pin it to the top, false to unpin.' },
        notes: { type: 'string', description: 'Replaces the notes on the task.' },
        steps: {
          type: 'array',
          description: 'Replaces the whole checklist. Keep steps that are already done marked done.',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, done: { type: 'boolean' } },
            required: ['text', 'done'],
            additionalProperties: false,
          },
        },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as finished. Call this when the student tells you they have done it or handed it in. Do not call it because a deadline passed.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'Id of the task, exactly as listed in the notes.' } },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_reminder',
    description:
      'Schedule a notification for the student. Call this when they ask to be reminded of something, or say yes to a nudge you offered. The reminder is delivered as a push notification signed with your name.',
    input_schema: {
      type: 'object',
      properties: {
        at: { type: 'string', description: `When to remind them. ${TIME_HINT}` },
        text: { type: 'string', description: 'What the notification says, in your voice, one short sentence.' },
        task_id: { type: 'string', description: 'Id of the task it is about, if any.' },
      },
      required: ['at', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_plan',
    description:
      "Save a study plan to the student's plan screen, replacing the previous one. Call this when the student asks you to plan or re-plan their day or week, or agrees to a plan you proposed. List the tasks in the order to do them.",
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One or two short sentences in your voice: what the day looks like and where to start.' },
        items: {
          type: 'array',
          description: 'The tasks in the order to do them, first to last.',
          items: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'Id of the task, exactly as listed in the notes.' },
              why: { type: 'string', description: 'One short sentence on why it sits at this place in the order.' },
              approach: { type: 'array', items: { type: 'string' }, description: 'The fastest sensible route through it: 2 to 5 short concrete steps.' },
              est_min: { type: 'integer', description: 'Minutes of focused work left.' },
              prompts: { type: 'array', items: { type: 'string' }, description: '2 or 3 ready-to-paste prompts for an AI tutor, specific to this task.' },
            },
            required: ['task_id', 'why', 'approach', 'est_min', 'prompts'],
            additionalProperties: false,
          },
        },
      },
      required: ['summary', 'items'],
      additionalProperties: false,
    },
  },
  {
    name: 'emote',
    description:
      'Play a short animation on your body. Use it at most once per reply, when a feeling genuinely fits: cheer when the student finishes something, think while planning, sad when they are swamped.',
    input_schema: {
      type: 'object',
      properties: { emote: { type: 'string', enum: [...EMOTES] } },
      required: ['emote'],
      additionalProperties: false,
    },
  },
];

/**
 * The tool list for a chat request. Order and text are fixed so the cached prefix stays
 * byte-identical. With `eager` the inputs stream as they are generated and the API no
 * longer validates them, which is why every input is checked again below before it runs.
 */
export function chatTools(eager: boolean): Tool[] {
  return DEFINITIONS.map((tool) => (eager ? { ...tool, strict: true, eager_input_streaming: true } : { ...tool, strict: true }));
}

// ---- validation -------------------------------------------------------------

// Enum casing is not guaranteed by constrained decoding, so enums are compared in lower case.
const lower = (v: unknown): unknown => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const line = (max: number) => z.string().trim().min(1).max(max);
const minutes = z.number().finite();

const addTaskInput = z
  .object({
    title: line(300),
    course: z.string().trim().max(200).optional(),
    due: z.string().trim().max(40).optional(),
    est_min: minutes.optional(),
    kind: z.preprocess(lower, z.enum(KINDS)).optional(),
    notes: z.string().trim().max(4000).optional(),
    steps: z.array(line(300)).max(20).optional(),
  })
  .strict();

const updateTaskInput = z
  .object({
    task_id: line(200),
    title: line(300).optional(),
    due: z.string().trim().max(40).optional(),
    est_min: minutes.optional(),
    pinned: z.boolean().optional(),
    notes: z.string().trim().max(4000).optional(),
    steps: z.array(z.object({ text: line(300), done: z.boolean() }).strict()).max(30).optional(),
  })
  .strict();

const completeTaskInput = z.object({ task_id: line(200) }).strict();

const setReminderInput = z.object({ at: line(40), text: line(300), task_id: z.string().trim().max(200).optional() }).strict();

const savePlanInput = z
  .object({
    summary: line(1000),
    items: z
      .array(
        z
          .object({
            task_id: line(200),
            why: z.string().trim().max(600),
            approach: z.array(z.string().trim().max(600)).max(12),
            est_min: minutes,
            prompts: z.array(z.string().trim().max(1500)).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();

const emoteInput = z.object({ emote: z.preprocess(lower, z.enum(EMOTES)) }).strict();

// ---- execution --------------------------------------------------------------

export interface ToolEnv {
  /** the account's save; tools mutate it in place */
  state: SaveState;
  /** server clock */
  now: number;
  tz: string;
}

export interface ToolOutcome {
  /** what goes back to the model as the tool_result */
  content: string;
  isError: boolean;
  /** the save was modified */
  changed: boolean;
  emote?: Emote;
}

const DAY = 86_400_000;
const MAX_OPEN_REMINDERS = 100;

const ok = (value: Record<string, unknown>): ToolOutcome => ({ content: JSON.stringify({ ok: true, ...value }), isError: false, changed: true });
const fail = (message: string): ToolOutcome => ({ content: message, isError: true, changed: false });

export function clampMinutes(value: number): number {
  return Math.min(720, Math.max(5, Math.round(value / 5) * 5));
}

function findTask(state: SaveState, id: string): Task | undefined {
  return state.tasks.find((t) => t.id === id && !t.deleted);
}

const unknownTask = (id: string): ToolOutcome =>
  fail(`There is no task with id "${id}". Use an id exactly as it appears in the notes, or add the task first.`);

function parseDue(input: string, env: ToolEnv): number | null {
  const at = parseLocalDateTime(input, env.tz, { hour: 23, minute: 59 });
  if (at == null || at < env.now - 60 * DAY || at > env.now + 730 * DAY) return null;
  return at;
}

const badTime = (env: ToolEnv): ToolOutcome =>
  fail(`That time could not be read. Write it as YYYY-MM-DDTHH:MM in the student's local time; right now it is ${formatLocalIso(env.now, env.tz)}.`);

function bump(task: Task, now: number): void {
  task.updatedAt = Math.max(now, task.updatedAt + 1);
}

function addTask(input: z.infer<typeof addTaskInput>, env: ToolEnv): ToolOutcome {
  let due: number | undefined;
  if (input.due) {
    const parsed = parseDue(input.due, env);
    if (parsed == null) return badTime(env);
    due = parsed;
  }
  const task: Task = { id: uid(), source: 'manual', title: input.title, done: false, createdAt: env.now, updatedAt: env.now };
  if (input.course) task.course = input.course;
  if (due != null) task.due = due;
  if (input.est_min != null) task.estMin = clampMinutes(input.est_min);
  if (input.notes) task.notes = input.notes;
  if (input.steps?.length) task.steps = input.steps.map((text) => ({ text, done: false }));
  task.kind = input.kind ?? guessKind(task);
  env.state.tasks.push(task);
  return ok({ task_id: task.id, title: task.title, due: due != null ? formatLocalIso(due, env.tz) : null });
}

function updateTask(input: z.infer<typeof updateTaskInput>, env: ToolEnv): ToolOutcome {
  const task = findTask(env.state, input.task_id);
  if (!task) return unknownTask(input.task_id);
  const imported = task.source !== 'manual';
  if (imported && (input.title != null || input.due != null)) {
    return fail('This task is imported from the school, so its title and due time cannot be changed here. Notes, estimate, pin and checklist can.');
  }
  let due: number | null | undefined;
  if (input.due != null) {
    if (input.due.toLowerCase() === 'none') due = null;
    else {
      const parsed = parseDue(input.due, env);
      if (parsed == null) return badTime(env);
      due = parsed;
    }
  }
  if (input.title != null) task.title = input.title;
  if (due === null) delete task.due;
  else if (due != null) task.due = due;
  if (input.est_min != null) task.estMin = clampMinutes(input.est_min);
  if (input.pinned != null) task.pinned = input.pinned;
  if (input.notes != null) task.notes = input.notes;
  if (input.steps != null) task.steps = input.steps.map((s) => ({ text: s.text, done: s.done }));
  bump(task, env.now);
  return ok({ task_id: task.id, title: task.title, due: task.due != null ? formatLocalIso(task.due, env.tz) : null });
}

function completeTask(input: z.infer<typeof completeTaskInput>, env: ToolEnv): ToolOutcome {
  const task = findTask(env.state, input.task_id);
  if (!task) return unknownTask(input.task_id);
  if (task.done) return { content: JSON.stringify({ ok: true, task_id: task.id, already_done: true }), isError: false, changed: false };
  task.done = true;
  task.doneAt = env.now;
  // `rewarded` is deliberately untouched: the game client grants the reward when it sees this
  bump(task, env.now);
  return ok({ task_id: task.id, title: task.title });
}

function setReminder(input: z.infer<typeof setReminderInput>, env: ToolEnv): ToolOutcome {
  const at = parseLocalDateTime(input.at, env.tz, { hour: 8, minute: 0 });
  if (at == null) return badTime(env);
  if (at < env.now - 60_000) return fail('That time is already in the past. Pick a time later than the local time in the notes.');
  if (at > env.now + 366 * DAY) return fail('That is more than a year away. Pick a closer time.');
  if (env.state.reminders.filter((r) => !r.fired).length >= MAX_OPEN_REMINDERS) {
    return fail('There are already too many reminders waiting. Tell the student to clear some first.');
  }
  if (input.task_id && !findTask(env.state, input.task_id)) return unknownTask(input.task_id);
  const reminder = { id: uid(), at, text: input.text, createdAt: env.now, ...(input.task_id ? { taskId: input.task_id } : {}) };
  env.state.reminders.push(reminder);
  touch(env.state, 'reminders');
  return ok({ reminder_id: reminder.id, at: formatLocalIso(at, env.tz) });
}

function savePlan(input: z.infer<typeof savePlanInput>, env: ToolEnv): ToolOutcome {
  const items: PlanItem[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const item of input.items) {
    const task = findTask(env.state, item.task_id);
    if (!task) {
      unknown.push(item.task_id);
      continue;
    }
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    items.push({
      taskId: task.id,
      rank: items.length + 1,
      why: item.why,
      approach: item.approach.filter(Boolean).slice(0, 5),
      estMin: clampMinutes(item.est_min),
      prompts: item.prompts.filter(Boolean).slice(0, 3),
    });
  }
  if (!items.length) return fail('None of those task ids exist. Use ids exactly as they appear in the notes.');
  env.state.plan = { generatedAt: env.now, summary: input.summary, items, source: 'ai' };
  touch(env.state, 'plan');
  return ok({ saved_items: items.length, ...(unknown.length ? { skipped_unknown_ids: unknown } : {}) });
}

/**
 * Validate and run one tool call. Never throws: anything wrong comes back as an error
 * result the model can read and correct.
 */
export function runTool(name: string, input: unknown, env: ToolEnv): ToolOutcome {
  const schemas = {
    add_task: addTaskInput,
    update_task: updateTaskInput,
    complete_task: completeTaskInput,
    set_reminder: setReminderInput,
    save_plan: savePlanInput,
    emote: emoteInput,
  } as const;
  if (!Object.hasOwn(schemas, name)) return fail(`There is no tool called "${name}".`);
  const parsed = schemas[name as keyof typeof schemas].safeParse(input);
  if (!parsed.success) {
    // same shape the API docs use for unparseable streamed input, so the model retries cleanly
    return fail(JSON.stringify({ INVALID_JSON: JSON.stringify(input ?? null), problem: parsed.error.issues[0]?.message ?? 'invalid input' }));
  }
  try {
    switch (name) {
      case 'add_task': return addTask(parsed.data as z.infer<typeof addTaskInput>, env);
      case 'update_task': return updateTask(parsed.data as z.infer<typeof updateTaskInput>, env);
      case 'complete_task': return completeTask(parsed.data as z.infer<typeof completeTaskInput>, env);
      case 'set_reminder': return setReminder(parsed.data as z.infer<typeof setReminderInput>, env);
      case 'save_plan': return savePlan(parsed.data as z.infer<typeof savePlanInput>, env);
      default: {
        const { emote } = parsed.data as z.infer<typeof emoteInput>;
        return { content: JSON.stringify({ ok: true }), isError: false, changed: false, emote };
      }
    }
  } catch {
    return fail('The planner hit a problem with that. Try once more, or tell the student it did not work.');
  }
}
