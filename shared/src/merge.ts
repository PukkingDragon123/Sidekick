import { SECTIONS, type SaveState, type Section, type Task } from './types.ts';

/** Keep tombstones this long so every device sees a deletion before it is dropped. */
const TOMBSTONE_MS = 30 * 86400000;

export function mergeTasks(a: Task[], b: Task[], now = Date.now()): Task[] {
  const out = new Map<string, Task>();
  for (const t of [...a, ...b]) {
    const cur = out.get(t.id);
    if (!cur || t.updatedAt > cur.updatedAt) out.set(t.id, t);
  }
  return [...out.values()].filter((t) => !(t.deleted && now - t.updatedAt > TOMBSTONE_MS));
}

/**
 * Merge two copies of a save. Each section is last-write-wins by its stamp;
 * tasks merge per task so an import on one device and an edit on another both survive.
 * `premium` is taken from `base` (the server passes its own copy as base).
 */
export function mergeState(base: SaveState, incoming: SaveState, now = Date.now()): SaveState {
  const out: SaveState = { ...base, stamps: { ...base.stamps } };
  const dst = out as unknown as Record<string, unknown>;
  const src = incoming as unknown as Record<string, unknown>;
  for (const s of SECTIONS) {
    const mine = base.stamps[s] ?? 0;
    const theirs = incoming.stamps[s] ?? 0;
    if (theirs > mine) {
      dst[s] = src[s];
      out.stamps[s] = theirs;
    }
  }
  out.tasks = mergeTasks(base.tasks, incoming.tasks, now);
  return out;
}

/** Mark sections as written now. Returns the same object for chaining. */
export function touch(state: SaveState, ...sections: Section[]): SaveState {
  const now = Date.now();
  for (const s of sections) state.stamps[s] = Math.max(now, (state.stamps[s] ?? 0) + 1);
  return state;
}
