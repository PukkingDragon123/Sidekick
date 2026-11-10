// The once-a-minute job: due reminders, "due soon" nudges, the daily briefing, and
// (optionally) background re-sync of school sources. Exported so tests can drive it with
// their own clock.
import {
  dueLabel, estimateMinutes, fmtMinutes, rankTasks, touch,
  type SaveState, type Task,
} from '../../shared/src/index.ts';
import { sidekickName } from './ai/prompt.ts';
import { errorKind, type Ctx } from './context.ts';
import { syncAccount } from './integrations/sync.ts';
import { notifyAccount, type Notice } from './push.ts';
import { formatLocal, formatLocalTime, localDateKey, localParts, safeTz } from './tz.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A reminder this late (the server was down) is marked done without bothering anyone. */
const REMINDER_MAX_LATE_MS = 12 * HOUR;
/** The daily briefing goes out at `dailyAt` or, if that minute was missed, up to this much later. */
const DAILY_WINDOW_MIN = 120;
const MARK_TTL_MS = 60 * DAY;
const AUTO_SYNC_BATCH = 5;

const lastAutoSync = new WeakMap<Ctx, Map<string, number>>();

const short = (text: string, max = 60): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Every message is signed, so the student knows which of their animals is talking. */
const signed = (text: string, name: string): string => `${text.trim()} — ${name}`;

const quote = (t: Task): string => `"${short(t.title)}"`;

function listTitles(tasks: Task[]): string {
  const shown = tasks.slice(0, 2).map(quote).join(', ');
  const rest = tasks.length - 2;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

function dueSoonNotice(tasks: Task[], tier: '2h' | '24h', now: number, tz: string, name: string): Notice {
  const sorted = [...tasks].sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
  if (sorted.length === 1) {
    const t = sorted[0];
    const due = t.due ?? now;
    return tier === '2h'
      ? {
          title: 'Almost due',
          body: signed(`${quote(t)} is due at ${formatLocalTime(due, tz)}. Quick sprint now?`, name),
          taskId: t.id,
          tag: `due:${t.id}`,
        }
      : {
          title: 'Due soon',
          body: signed(`${quote(t)} is ${dueLabel(t, now)} (${formatLocal(due, tz)}). A small start now makes it easy.`, name),
          taskId: t.id,
          tag: `due:${t.id}`,
        };
  }
  return tier === '2h'
    ? { title: 'Almost due', body: signed(`${sorted.length} things are due within 2 hours: ${listTitles(sorted)}.`, name), tag: 'due:2h' }
    : { title: 'Due soon', body: signed(`${sorted.length} things are due in the next day: ${listTitles(sorted)}.`, name), tag: 'due:24h' };
}

export function dailyNotice(state: SaveState, now: number, tz: string, name: string): Notice {
  const open = state.tasks.filter((t) => !t.done && !t.deleted);
  const today = localDateKey(now, tz);
  const dueToday = open.filter((t) => t.due != null && t.due >= now && localDateKey(t.due, tz) === today);
  const overdue = open.filter((t) => t.due != null && t.due < now);
  const first = rankTasks(open, now)[0];
  let text: string;
  if (!first) {
    text = 'Nothing on your list today. Enjoy it.';
  } else if (!dueToday.length && !overdue.length) {
    text = `Nothing due today. Next up: ${quote(first)} (${dueLabel(first, now)}).`;
  } else {
    const counts = [dueToday.length ? `${dueToday.length} due today` : '', overdue.length ? `${overdue.length} overdue` : ''].filter(Boolean);
    const total = [...dueToday, ...overdue].reduce((n, t) => n + estimateMinutes(t), 0);
    text = `${counts.join(' and ')}, about ${fmtMinutes(total)} of work. Start with ${quote(first)}.`;
  }
  return { title: "Today's plan", body: signed(text, name), tag: 'daily' };
}

async function tickAccount(ctx: Ctx, accountId: string, now: number): Promise<void> {
  const state = ctx.states.get(accountId);
  if (!state) return;
  const tz = safeTz(state.settings.tz);
  const name = sidekickName(state);
  const notices: Notice[] = [];

  // 1. Reminders the student (or the sidekick, on their behalf) set.
  const dueReminders = state.reminders.filter((r) => !r.fired && r.at <= now);
  if (dueReminders.length) {
    for (const r of dueReminders) {
      // the mark outlives a client overwriting the reminders section with a stale copy
      const first = ctx.db.markOnce(accountId, `reminder:${r.id}:${r.at}`, now);
      if (!first || r.at < now - REMINDER_MAX_LATE_MS) continue;
      const about = r.taskId ? state.tasks.find((t) => t.id === r.taskId && !t.deleted) : undefined;
      notices.push({ title: 'Reminder', body: signed(short(r.text, 200), name), tag: `reminder:${r.id}`, ...(about ? { taskId: about.id } : {}) });
    }
    ctx.states.update(accountId, (s) => {
      for (const r of s.reminders) if (!r.fired && r.at <= now) r.fired = true;
      touch(s, 'reminders');
    });
  }

  // 2. Open work that is about to be due: once at a day out, once at two hours out.
  if (state.settings.notifyDueSoon) {
    const within2h: Task[] = [];
    const within24h: Task[] = [];
    for (const t of state.tasks) {
      if (t.done || t.deleted || t.due == null) continue;
      const left = t.due - now;
      if (left <= 0 || left > DAY) continue;
      // the deadline is part of the key: move it and the nudges are owed again
      const tier = left <= 2 * HOUR ? '2h' : '24h';
      if (!ctx.db.markOnce(accountId, `due${tier}:${t.id}:${t.due}`, now)) continue;
      // no need to tell them about something they typed in a moment ago
      const justAdded = t.source === 'manual' && now - t.createdAt < (tier === '2h' ? 10 : 30) * MINUTE;
      if (justAdded) continue;
      (tier === '2h' ? within2h : within24h).push(t);
    }
    if (within2h.length) notices.push(dueSoonNotice(within2h, '2h', now, tz, name));
    if (within24h.length) notices.push(dueSoonNotice(within24h, '24h', now, tz, name));
  }

  // 3. The daily briefing, at the student's chosen local time.
  if (state.settings.notifyDaily) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(state.settings.dailyAt.trim());
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) {
      const local = localParts(now, tz);
      const minuteOfDay = local.hour * 60 + local.minute;
      const target = Number(m[1]) * 60 + Number(m[2]);
      if (minuteOfDay >= target && minuteOfDay < target + DAILY_WINDOW_MIN && ctx.db.markOnce(accountId, `daily:${localDateKey(now, tz)}`, now)) {
        notices.push(dailyNotice(state, now, tz, name));
      }
    }
  }

  for (const notice of notices) await notifyAccount(ctx, accountId, notice);
}

async function autoSync(ctx: Ctx, now: number): Promise<void> {
  const every = ctx.config.autoSyncMinutes * MINUTE;
  if (every <= 0) return;
  let attempts = lastAutoSync.get(ctx);
  if (!attempts) lastAutoSync.set(ctx, (attempts = new Map()));
  // a source that keeps failing never advances last_sync; the attempt log keeps it from being retried every minute
  const due = ctx.db
    .accountsDueForSync(now - every, 50)
    .filter((id) => (attempts.get(id) ?? -Infinity) <= now - every)
    .slice(0, AUTO_SYNC_BATCH);
  for (const accountId of due) {
    attempts.set(accountId, now);
    try {
      await syncAccount(ctx, accountId);
    } catch (err) {
      ctx.log.warn(`auto-sync: skipped an account (${errorKind(err)})`);
    }
  }
}

/** One pass over every account. Safe to call at any time and as often as you like. */
export async function tick(ctx: Ctx, now: number = ctx.now()): Promise<void> {
  for (const accountId of ctx.db.accountsWithState()) {
    try {
      await tickAccount(ctx, accountId, now);
    } catch (err) {
      ctx.log.error(`scheduler: account pass failed (${errorKind(err)})`);
    }
  }
  await autoSync(ctx, now);
  if (Math.floor(now / MINUTE) % 60 === 0) {
    ctx.db.pruneMarks(now - MARK_TTL_MS);
    ctx.db.pruneAiUsage(new Date(now - 7 * DAY).toISOString().slice(0, 10));
  }
}
