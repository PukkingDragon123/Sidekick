// iCalendar (RFC 5545) reader for LMS and calendar feeds: Canvas, Moodle, Schoology,
// Google/Outlook exports. Reads VEVENT and VTODO; ignores alarms, free/busy and journals.
import { createHash } from 'node:crypto';
import { guessKind } from '../../../shared/src/index.ts';
import { isValidTz, zonedToUtc } from '../tz.ts';
import { STALE_AFTER_MS, cleanText, htmlToText, safeHttpUrl, type ImportedTask } from './importer.ts';

export type IcsDate =
  | { kind: 'utc'; ms: number }
  /** wall-clock time, in `tzid` when given, otherwise "floating" (the reader's own zone) */
  | { kind: 'local'; tzid: string | null; year: number; month: number; day: number; hour: number; minute: number; second: number }
  /** all-day */
  | { kind: 'date'; year: number; month: number; day: number };

export interface IcsItem {
  type: 'VEVENT' | 'VTODO';
  uid: string;
  recurrenceId: string | null;
  summary: string;
  description: string | null;
  url: string | null;
  location: string | null;
  categories: string[];
  start: IcsDate | null;
  end: IcsDate | null;
  due: IcsDate | null;
  status: string | null;
  completed: boolean;
  created: number | null;
}

export interface IcsCalendar {
  name: string | null;
  /** X-WR-TIMEZONE: the zone floating times in this calendar are meant in */
  timezone: string | null;
  items: IcsItem[];
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Undo line folding: a CRLF followed by one space or tab continues the previous line. */
export function unfold(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.length > 0);
}

/** `NAME;PARAM=value;PARAM="quoted:value":content` */
export function parseContentLine(line: string): ContentLine | null {
  let i = 0;
  while (i < line.length && line[i] !== ';' && line[i] !== ':') i++;
  if (i === 0 || i >= line.length) return null;
  const name = line.slice(0, i).toUpperCase();
  const params: Record<string, string> = {};
  while (line[i] === ';') {
    i++;
    const eq = line.indexOf('=', i);
    if (eq === -1) return null;
    const key = line.slice(i, eq).toUpperCase();
    i = eq + 1;
    let value = '';
    // a parameter value is a comma-separated list of quoted or bare strings
    for (;;) {
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1);
        if (close === -1) return null;
        value += line.slice(i + 1, close);
        i = close + 1;
      } else {
        const start = i;
        while (i < line.length && line[i] !== ';' && line[i] !== ':' && line[i] !== ',') i++;
        value += line.slice(start, i);
      }
      if (line[i] !== ',') break;
      value += ',';
      i++;
    }
    params[key] = value;
  }
  if (line[i] !== ':') return null;
  return { name, params, value: line.slice(i + 1) };
}

/** TEXT values escape `\n`, `\,`, `\;` and `\\`. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function splitList(value: string): string[] {
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length) {
      current += ch + value[++i];
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out.map((s) => unescapeText(s).trim()).filter(Boolean);
}

// Outlook and Teams exports name zones the Windows way.
const WINDOWS_ZONES: Record<string, string> = {
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Helsinki',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Egypt Standard Time': 'Africa/Cairo',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Arab Standard Time': 'Asia/Riyadh',
  'Arabian Standard Time': 'Asia/Dubai',
  'Iran Standard Time': 'Asia/Tehran',
  'Pakistan Standard Time': 'Asia/Karachi',
  'West Asia Standard Time': 'Asia/Tashkent',
  'India Standard Time': 'Asia/Kolkata',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Myanmar Standard Time': 'Asia/Yangon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Taipei Standard Time': 'Asia/Taipei',
  'W. Australia Standard Time': 'Australia/Perth',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Tasmania Standard Time': 'Australia/Hobart',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'Central America Standard Time': 'America/Guatemala',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'SA Pacific Standard Time': 'America/Bogota',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
};

/** An IANA zone for a TZID as feeds actually write them, or null. */
export function resolveTzid(tzid: string | null | undefined): string | null {
  if (!tzid) return null;
  const raw = tzid.trim().replace(/^"|"$/g, '');
  if (isValidTz(raw)) return raw;
  if (WINDOWS_ZONES[raw]) return WINDOWS_ZONES[raw];
  // "/freeassociation.sourceforge.net/Europe/Berlin", "/mozilla.org/20050126_1/America/New_York"
  const parts = raw.split('/').filter(Boolean);
  for (const take of [3, 2]) {
    if (parts.length >= take) {
      const candidate = parts.slice(-take).join('/');
      if (isValidTz(candidate)) return candidate;
    }
  }
  return null;
}

function parseDate(line: ContentLine): IcsDate | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(line.value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (m[4] == null) return { kind: 'date', year, month, day };
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;
  if (hour > 23 || minute > 59 || second > 60) return null;
  if (m[7]) return { kind: 'utc', ms: Date.UTC(year, month - 1, day, hour, minute, second) };
  return { kind: 'local', tzid: line.params.TZID ?? null, year, month, day, hour, minute, second };
}

function parseStamp(line: ContentLine): number | null {
  const d = parseDate(line);
  return d?.kind === 'utc' ? d.ms : null;
}

export function parseIcs(text: string): IcsCalendar {
  const calendar: IcsCalendar = { name: null, timezone: null, items: [] };
  const stack: string[] = [];
  let item: IcsItem | null = null;
  let sawCalendar = false;

  for (const raw of unfold(text)) {
    const line = parseContentLine(raw);
    if (!line) continue;

    if (line.name === 'BEGIN') {
      const component = line.value.trim().toUpperCase();
      stack.push(component);
      if (component === 'VCALENDAR') sawCalendar = true;
      if ((component === 'VEVENT' || component === 'VTODO') && !item) {
        item = {
          type: component, uid: '', recurrenceId: null, summary: '', description: null, url: null, location: null,
          categories: [], start: null, end: null, due: null, status: null, completed: false, created: null,
        };
      }
      continue;
    }
    if (line.name === 'END') {
      const component = line.value.trim().toUpperCase();
      const at = stack.lastIndexOf(component);
      if (at !== -1) stack.length = at;
      if (item && component === item.type) {
        if (item.uid) calendar.items.push(item);
        item = null;
      }
      continue;
    }

    const inside = stack[stack.length - 1];
    if (inside === 'VCALENDAR') {
      if (line.name === 'X-WR-CALNAME') calendar.name = unescapeText(line.value).trim() || null;
      else if (line.name === 'X-WR-TIMEZONE') calendar.timezone = resolveTzid(line.value);
      continue;
    }
    // properties of nested components (VALARM has its own SUMMARY and DESCRIPTION) are not ours
    if (!item || inside !== item.type) continue;

    switch (line.name) {
      case 'UID': item.uid = line.value.trim(); break;
      case 'RECURRENCE-ID': item.recurrenceId = line.value.trim(); break;
      case 'SUMMARY': item.summary = unescapeText(line.value); break;
      case 'DESCRIPTION': item.description = unescapeText(line.value); break;
      case 'LOCATION': item.location = unescapeText(line.value); break;
      case 'URL': item.url = line.value.trim(); break;
      case 'CATEGORIES': item.categories.push(...splitList(line.value)); break;
      case 'DTSTART': item.start = parseDate(line); break;
      case 'DTEND': item.end = parseDate(line); break;
      case 'DUE': item.due = parseDate(line); break;
      case 'STATUS': item.status = line.value.trim().toUpperCase(); break;
      case 'COMPLETED': item.completed = true; break;
      case 'PERCENT-COMPLETE': if (Number(line.value) >= 100) item.completed = true; break;
      case 'CREATED': item.created = parseStamp(line); break;
      default: break;
    }
  }

  if (!sawCalendar) throw new Error('Not an iCalendar feed');
  for (const it of calendar.items) if (it.status === 'COMPLETED') it.completed = true;
  return calendar;
}

/** Epoch ms for a parsed date. All-day dates mean "by the end of that day". */
export function icsDateToMs(date: IcsDate, fallbackTz: string): number {
  if (date.kind === 'utc') return date.ms;
  if (date.kind === 'date') return zonedToUtc(date.year, date.month, date.day, 23, 59, 0, fallbackTz);
  const tz = resolveTzid(date.tzid) ?? fallbackTz;
  return zonedToUtc(date.year, date.month, date.day, date.hour, date.minute, date.second, tz);
}

/** Canvas writes "Essay draft [ENG 101]"; Moodle writes "Essay draft is due" with the course in CATEGORIES. */
function titleAndCourse(item: IcsItem): { title: string; course: string | undefined } {
  let title = item.summary.slice(0, 1000).replace(/\s+/g, ' ').trim();
  let course: string | undefined;
  const bracket = /^(.+?)\s*\[([^\[\]]{1,120})\]$/.exec(title);
  if (bracket) {
    title = bracket[1].trim();
    course = bracket[2].trim();
  }
  if (!course && item.categories.length) course = item.categories[0];
  title = title.replace(/\s+is due$/i, '').trim();
  return { title, course: cleanText(course, 200) };
}

/** UIDs are used verbatim in task ids unless they are absurdly long. */
function compactUid(uid: string): string {
  return uid.length <= 120 ? uid : `h${createHash('sha256').update(uid).digest('hex').slice(0, 32)}`;
}

export function icsToTasks(calendar: IcsCalendar, opts: { feedId: string; tz: string; now: number }): ImportedTask[] {
  const zone = calendar.timezone ?? opts.tz;
  const out: ImportedTask[] = [];
  for (const item of calendar.items.slice(0, 5000)) {
    if (item.status === 'CANCELLED') continue;
    const when = item.type === 'VTODO' ? item.due ?? item.start : item.start;
    if (item.type === 'VEVENT' && !when) continue;
    const due = when ? icsDateToMs(when, zone) : null;
    if (due != null && due < opts.now - STALE_AFTER_MS) continue;

    const { title, course } = titleAndCourse(item);
    if (!title) continue;
    const rawDescription = item.description && /<[a-z][^<>]*>/i.test(item.description) ? htmlToText(item.description) : item.description;
    const description = cleanText(rawDescription, 2000);
    const externalId = compactUid(item.recurrenceId ? `${item.uid}:${item.recurrenceId}` : item.uid);
    const task: ImportedTask = {
      id: `ics:${opts.feedId}:${externalId}`,
      source: 'ics',
      externalId: `${opts.feedId}:${externalId}`,
      title: cleanText(title, 300) ?? title,
      due,
      kind: guessKind({ title, description }),
      doneAtSource: item.completed,
    };
    if (course) task.course = course;
    if (description) task.description = description;
    const url = safeHttpUrl(item.url);
    if (url) task.url = url;
    if (item.created != null) task.sourceCreatedAt = item.created;
    out.push(task);
  }
  return out;
}
