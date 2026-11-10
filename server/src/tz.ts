// Time-zone arithmetic on top of Intl, so the server needs no tz database of its own.

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Mon, Tue, ... */
  weekday: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** A usable zone: the given one if valid, otherwise the fallback (UTC by default). */
export function safeTz(tz: unknown, fallback = 'UTC'): string {
  return isValidTz(tz) ? tz : fallback;
}

export function localParts(ms: number, tz: string): LocalParts {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(ms)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: out.weekday ?? '',
  };
}

/** Offset of the zone from UTC at an instant, in ms (positive east of Greenwich). */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of a wall-clock time in a zone. Times inside a DST gap resolve to the instant after it. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, tz: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = wall - tzOffsetMs(wall, tz);
  return wall - tzOffsetMs(first, tz);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number): string => String(n).padStart(2, '0');

/** "Tue 10 Nov 2026, 16:30" */
export function formatLocal(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.weekday} ${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "16:30" */
export function formatLocalTime(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "2026-11-10" */
export function localDateKey(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "2026-11-10T16:30", the shape the AI tools read and write. */
export function formatLocalIso(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parse what a model or a person writes for a moment in time:
 * `2026-11-12T16:30` (wall clock in `tz`), `2026-11-12` (uses `dateOnly` as the time of day),
 * or a full ISO timestamp with `Z` / an offset. Returns null when it is not a real date.
 */
export function parseLocalDateTime(input: string, tz: string, dateOnly: { hour: number; minute: number }): number | null {
  const m = LOCAL_RE.exec(input.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hasTime = m[4] != null;
  const hour = hasTime ? Number(m[4]) : dateOnly.hour;
  const minute = hasTime ? Number(m[5]) : dateOnly.minute;
  const second = m[6] ? Number(m[6]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const zone = m[7];
  if (zone && hasTime) {
    if (zone.toUpperCase() === 'Z') return Date.UTC(year, month - 1, day, hour, minute, second);
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    return Date.UTC(year, month - 1, day, hour, minute, second) - offsetMin * 60_000;
  }
  return zonedToUtc(year, month, day, hour, minute, second, tz);
}
