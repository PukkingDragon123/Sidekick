// The account save: validation of what clients send, and the one place it is read and written.
import { z } from 'zod';
import { SECTIONS, SPECIES, mergeState, type Premium, type SaveState } from '../../shared/src/index.ts';
import type { Db } from './db.ts';

export const CHAT_CAP = 60;
/** How far ahead of the server clock a client timestamp may run before it is pulled back. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
/** Premium survives this long past `until`, so a late renewal webhook does not drop a paying user. */
const PREMIUM_GRACE_MS = 3 * 86_400_000;

const ms = z.number().finite();
const text = (max: number) => z.string().max(max);
const id = z.string().min(1).max(200);

// Objects are `passthrough` so a newer client's extra fields survive a round trip through
// an older server; the fields the server itself reads are checked strictly.
const lookSchema = z
  .object({ species: z.enum(SPECIES) })
  .passthrough();

const sidekickSchema = z
  .object({ id, name: text(60), look: lookSchema, outfit: z.record(text(80)) })
  .passthrough();

export const taskSchema = z
  .object({
    id,
    source: z.enum(['manual', 'google', 'microsoft', 'ics']),
    externalId: text(300).optional(),
    title: text(300),
    course: text(200).optional(),
    description: text(8000).optional(),
    due: ms.optional(),
    url: text(2000).optional(),
    points: ms.optional(),
    kind: z.enum(['assignment', 'quiz', 'reading', 'project', 'exam', 'essay', 'problems', 'other']).optional(),
    estMin: ms.optional(),
    done: z.boolean(),
    doneAt: ms.optional(),
    createdAt: ms,
    updatedAt: ms,
    pinned: z.boolean().optional(),
    notes: text(8000).optional(),
    steps: z.array(z.object({ text: text(500), done: z.boolean() }).passthrough()).max(100).optional(),
    rewarded: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
  .passthrough();

const planSchema = z
  .object({
    generatedAt: ms,
    summary: text(2000),
    items: z
      .array(
        z
          .object({
            taskId: id,
            rank: ms,
            why: text(1000),
            approach: z.array(text(1000)).max(20),
            estMin: ms,
            prompts: z.array(text(2000)).max(20),
          })
          .passthrough(),
      )
      .max(200),
    source: z.enum(['ai', 'local']),
  })
  .passthrough();

const questProgress = z.object({ id, n: ms, claimed: z.boolean() }).passthrough();

export const saveStateSchema = z
  .object({
    v: z.literal(1),
    owner: z.object({ name: text(80), onboarded: z.boolean() }).passthrough(),
    // may be empty before onboarding has picked a sidekick
    sidekicks: z.array(sidekickSchema).max(50),
    active: text(200),
    progress: z
      .object({
        coins: ms, gems: ms, xp: ms, level: ms, streakDays: ms, streakLast: text(16),
        tasksDone: ms, focusMin: ms, fed: ms, adsToday: ms, adsDay: text(16),
      })
      .passthrough(),
    inventory: z.record(ms),
    wardrobe: z.array(text(120)).max(5000),
    garden: z
      .object({
        unlocked: z.boolean(),
        items: z.array(z.object({ id, item: text(120), x: ms, z: ms, rot: ms }).passthrough()).max(5000),
      })
      .passthrough(),
    quests: z
      .object({ day: text(16), daily: z.array(questProgress).max(100), week: text(16), weekly: z.array(questProgress).max(100) })
      .passthrough(),
    tasks: z.array(taskSchema).max(5000),
    reminders: z
      .array(
        z
          .object({ id, at: ms, text: text(500), taskId: id.optional(), fired: z.boolean().optional(), createdAt: ms })
          .passthrough(),
      )
      .max(1000),
    plan: planSchema.nullable(),
    settings: z
      .object({
        sfx: ms, ambience: ms, voice: z.boolean(), notifyDueSoon: z.boolean(), notifyDaily: z.boolean(),
        dailyAt: text(8), quality: z.enum(['auto', 'low', 'high']), reduceMotion: z.boolean(),
        tz: text(64), desktopAuto: z.boolean(),
      })
      .passthrough(),
    pet: z.object({ hunger: ms, joy: ms, energy: ms, at: ms }).passthrough(),
    chat: z.array(z.object({ id, role: z.enum(['user', 'sidekick']), text: text(16000), at: ms }).passthrough()).max(500),
    // server-authoritative: accepted so a client can send its whole save back, then overwritten
    premium: z.object({ plus: z.boolean(), until: ms.optional() }).passthrough().optional(),
    stamps: z.record(ms),
  })
  .passthrough();

export function parseSaveState(input: unknown): SaveState {
  return saveStateSchema.parse(input) as unknown as SaveState;
}

export type StateListener = (accountId: string, state: SaveState, exceptDevice: string | undefined) => void;

export class StateStore {
  readonly #db: Db;
  readonly #now: () => number;
  #listener: StateListener = () => {};

  constructor(db: Db, now: () => number) {
    this.#db = db;
    this.#now = now;
  }

  /** Called after every stored change, with the device that caused it (if any). */
  onChange(listener: StateListener): void {
    this.#listener = listener;
  }

  premium(accountId: string): Premium {
    const row = this.#db.premium(accountId);
    if (!row?.plus) return { plus: false };
    if (row.until != null && row.until + PREMIUM_GRACE_MS < this.#now()) return { plus: false };
    return row.until != null ? { plus: true, until: row.until } : { plus: true };
  }

  get(accountId: string): SaveState | null {
    const json = this.#db.stateJson(accountId);
    if (!json) return null;
    const state = JSON.parse(json) as SaveState;
    state.premium = this.premium(accountId);
    return state;
  }

  /** PUT /api/state: merge a client's copy into the stored one and return the result. */
  put(accountId: string, incoming: SaveState, exceptDevice?: string): SaveState {
    const now = this.#now();
    const limit = now + MAX_CLOCK_SKEW_MS;
    for (const s of SECTIONS) {
      const stamp = incoming.stamps[s];
      if (stamp != null && stamp > limit) incoming.stamps[s] = limit;
    }
    for (const t of incoming.tasks) if (t.updatedAt > limit) t.updatedAt = limit;

    const current = this.get(accountId);
    const before = current ? JSON.stringify(current) : null;
    const next = current ? mergeState(current, incoming, now) : incoming;
    return this.#store(accountId, next, before, exceptDevice);
  }

  /**
   * Read-modify-write under one synchronous step, so concurrent requests cannot interleave.
   * Returns null when the account has no save yet (the server never invents one).
   */
  update(accountId: string, mutate: (state: SaveState) => void, exceptDevice?: string): SaveState | null {
    const current = this.get(accountId);
    if (!current) return null;
    const before = JSON.stringify(current);
    mutate(current);
    return this.#store(accountId, current, before, exceptDevice);
  }

  /** Re-publish the save after something outside it changed (premium). */
  republish(accountId: string): void {
    const state = this.get(accountId);
    if (!state) return;
    this.#db.saveStateJson(accountId, JSON.stringify(state), this.#now());
    this.#listener(accountId, state, undefined);
  }

  #store(accountId: string, state: SaveState, before: string | null, exceptDevice: string | undefined): SaveState {
    state.premium = this.premium(accountId);
    if (state.chat.length > CHAT_CAP) state.chat = state.chat.slice(-CHAT_CAP);
    const json = JSON.stringify(state);
    if (json !== before) {
      this.#db.saveStateJson(accountId, json, this.#now());
      this.#listener(accountId, state, exceptDevice);
    }
    return state;
  }
}
