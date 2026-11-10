// Turning what a school source says into tasks, without ever undoing the student's own edits.
import type { SaveState, Task, TaskKind, TaskSource } from '../../../shared/src/index.ts';

const DAY = 86_400_000;
/** Work whose deadline passed this long ago is history, not something to plan. */
export const STALE_AFTER_MS = 14 * DAY;
/** Undated work is only picked up while it is reasonably fresh. */
const UNDATED_FRESH_MS = 60 * DAY;
/** mergeTasks drops tombstones after 30 days; refresh ours a little before that. */
const TOMBSTONE_REFRESH_MS = 20 * DAY;

export interface ImportedTask {
  /** `${source}:${externalId}` */
  id: string;
  source: Exclude<TaskSource, 'manual'>;
  externalId: string;
  title: string;
  course?: string;
  description?: string;
  /** epoch ms; null = the source says there is no deadline; undefined = the source did not tell us */
  due?: number | null;
  url?: string;
  points?: number;
  kind?: TaskKind;
  /** submitted / turned in / completed according to the source */
  doneAtSource: boolean;
  /** when the source created or published it, if it says */
  sourceCreatedAt?: number;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

/** Trimmed, whitespace-tidied text capped at `max` characters; undefined when nothing is left. */
export function cleanText(input: unknown, max: number): string | undefined {
  if (typeof input !== 'string') return undefined;
  const text = input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Links from feeds end up as clickable buttons: only plain web links get through. */
export function safeHttpUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > 2000) return undefined;
  try {
    const url = new URL(input.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Whether an item the account has never seen is too old to be worth adding. */
export function isStale(item: ImportedTask, now: number): boolean {
  if (item.due != null) return item.due < now - STALE_AFTER_MS;
  if (item.doneAtSource) return true;
  return item.sourceCreatedAt != null && item.sourceCreatedAt < now - UNDATED_FRESH_MS;
}

/**
 * Fold imported items into the save.
 *
 * The source owns title, course, description, due, url and points, and may flip `done` to
 * true. Everything the student controls (estMin, notes, steps, pinned, rewarded, a `done`
 * they ticked themselves) is left alone, and a task they deleted stays deleted.
 *
 * An update bumps `updatedAt` by one tick rather than to "now": that is enough for other
 * devices to pick it up, while an edit made on a device that has not synced yet still wins
 * the per-task merge. The next import then lays the source's fields back over that edit,
 * so both survive.
 */
export function applyImport(state: SaveState, items: ImportedTask[], now: number): { added: number; updated: number } {
  const byId = new Map<string, Task>();
  for (const t of state.tasks) byId.set(t.id, t);
  let added = 0;
  let updated = 0;

  for (const item of new Map(items.map((i) => [i.id, i])).values()) {
    const existing = byId.get(item.id);

    if (!existing) {
      if (isStale(item, now)) continue;
      const task: Task = {
        id: item.id,
        source: item.source,
        externalId: item.externalId,
        title: item.title,
        done: item.doneAtSource,
        createdAt: now,
        updatedAt: now,
      };
      if (item.course !== undefined) task.course = item.course;
      if (item.description !== undefined) task.description = item.description;
      if (item.due != null) task.due = item.due;
      if (item.url !== undefined) task.url = item.url;
      if (item.points !== undefined) task.points = item.points;
      if (item.kind !== undefined) task.kind = item.kind;
      if (item.doneAtSource) task.doneAt = now;
      state.tasks.push(task);
      byId.set(task.id, task);
      added += 1;
      continue;
    }

    if (existing.deleted) {
      // keep the tombstone alive for as long as the source still lists the item
      if (now - existing.updatedAt > TOMBSTONE_REFRESH_MS) existing.updatedAt = now;
      continue;
    }

    let changed = false;
    if (existing.title !== item.title) {
      existing.title = item.title;
      changed = true;
    }
    if (item.course !== undefined && existing.course !== item.course) {
      existing.course = item.course;
      changed = true;
    }
    if (item.description !== undefined && existing.description !== item.description) {
      existing.description = item.description;
      changed = true;
    }
    if (item.url !== undefined && existing.url !== item.url) {
      existing.url = item.url;
      changed = true;
    }
    if (item.points !== undefined && existing.points !== item.points) {
      existing.points = item.points;
      changed = true;
    }
    if (item.due === null) {
      if (existing.due != null) {
        delete existing.due;
        changed = true;
      }
    } else if (item.due !== undefined && existing.due !== item.due) {
      existing.due = item.due;
      changed = true;
    }
    if (item.doneAtSource && !existing.done) {
      existing.done = true;
      existing.doneAt = now;
      changed = true;
    }
    if (changed) {
      existing.updatedAt += 1;
      updated += 1;
    }
  }

  return { added, updated };
}
