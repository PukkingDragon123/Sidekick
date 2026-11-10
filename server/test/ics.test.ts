import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { guessKind } from '../../shared/src/index.ts';
import { icsToTasks, parseContentLine, parseIcs, resolveTzid, unescapeText, unfold } from '../src/integrations/ics.ts';
import { DAY, T0 } from './helpers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');

describe('content lines', () => {
  test('folded lines are joined, whether they continue with a space or a tab', () => {
    expect(unfold('SUMMARY:Read chap\r\n ter 4\r\nDESCRIPTION:one\r\n\ttwo\r\n')).toEqual(['SUMMARY:Read chapter 4', 'DESCRIPTION:onetwo']);
    // bare LF feeds and a byte-order mark are tolerated
    expect(unfold('﻿BEGIN:VCALENDAR\nSUMMARY:a\n b\n')).toEqual(['BEGIN:VCALENDAR', 'SUMMARY:ab']);
  });

  test('parameters may be quoted and contain colons, semicolons and commas', () => {
    expect(parseContentLine('DTSTART;TZID="Eastern Standard Time";VALUE=DATE-TIME:20261118T090000')).toEqual({
      name: 'DTSTART',
      params: { TZID: 'Eastern Standard Time', VALUE: 'DATE-TIME' },
      value: '20261118T090000',
    });
    expect(parseContentLine('ATTENDEE;CN="Lee, Sam: Mr; Sr";ROLE=CHAIR:mailto:sam@example.edu')).toEqual({
      name: 'ATTENDEE',
      params: { CN: 'Lee, Sam: Mr; Sr', ROLE: 'CHAIR' },
      value: 'mailto:sam@example.edu',
    });
    expect(parseContentLine('summary:lower case names are fine')?.name).toBe('SUMMARY');
    expect(parseContentLine('no colon here')).toBeNull();
  });

  test('escaped text is unescaped', () => {
    expect(unescapeText('Bring: pens\\, paper\\; glue\\nand a ruler\\\\compass\\N!')).toBe('Bring: pens, paper; glue\nand a ruler\\compass\n!');
  });

  test('time zone ids as feeds really write them', () => {
    expect(resolveTzid('Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveTzid('"Eastern Standard Time"')).toBe('America/New_York');
    expect(resolveTzid('SE Asia Standard Time')).toBe('Asia/Bangkok');
    expect(resolveTzid('/freeassociation.sourceforge.net/Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveTzid('/mozilla.org/20050126_1/America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(resolveTzid('Mars/Olympus_Mons')).toBeNull();
    expect(resolveTzid(null)).toBeNull();
  });
});

describe('a Canvas feed', () => {
  const calendar = parseIcs(fixture('canvas.ics'));
  const tasks = icsToTasks(calendar, { feedId: 'feed1', tz: 'Asia/Bangkok', now: T0 });
  const byUid = (uid: string) => tasks.find((t) => t.id === `ics:feed1:${uid}`);

  test('calendar properties', () => {
    expect(calendar.name).toBe('Mina Suzuki Calendar (Canvas)');
    expect(calendar.timezone).toBe('America/Chicago');
    expect(calendar.items).toHaveLength(6);
  });

  test('old and cancelled items are left out', () => {
    expect(tasks.map((t) => t.externalId).sort()).toEqual([
      'feed1:event-assignment-481516',
      'feed1:event-assignment-481600',
      'feed1:event-assignment-481800',
      'feed1:event-calendar-event-9911',
    ]);
  });

  test('a UTC assignment: folded description and URL, course from the [bracket]', () => {
    const t = byUid('event-assignment-481516');
    expect(t).toMatchObject({
      source: 'ics',
      title: 'Reading Response 3: The Giver',
      course: 'ENG 9 - Period 2',
      due: Date.UTC(2026, 10, 13, 5, 59, 0),
      url: 'https://canvas.example.edu/calendar?include_contexts=course_1201&month=11&year=2026#assignment_481516',
      kind: 'reading',
      doneAtSource: false,
    });
    expect(t?.description).toBe(
      'Write a 600-word response to chapters 4, 5 and 6.\n\nUse at least two quotes; cite page numbers. Rubric: https://canvas.example.edu/courses/1201/assignments/481516',
    );
  });

  test('an all-day item is due at the end of that day in the calendar zone', () => {
    // 23:59 on 16 Nov in Chicago (UTC-6 in winter)
    expect(byUid('event-assignment-481600')).toMatchObject({ title: 'Unit 3 Quiz', course: 'ALG1-04', kind: 'quiz', due: Date.UTC(2026, 10, 17, 5, 59, 0) });
  });

  test('TZID times convert from their zone; alarm text does not leak into the event', () => {
    const t = byUid('event-calendar-event-9911');
    // 15:30 in New York (UTC-5 in winter)
    expect(t).toMatchObject({ title: 'Science fair project check-in', course: 'SCI 9', due: Date.UTC(2026, 10, 12, 20, 30, 0) });
    expect(t?.description).toBeUndefined();
  });

  test('floating times use the calendar zone, and non-web links are dropped', () => {
    const t = byUid('event-assignment-481800');
    // 17:00 in Chicago
    expect(t).toMatchObject({ title: 'Poster draft', course: 'ART 1', due: Date.UTC(2026, 10, 20, 23, 0, 0) });
    expect(t?.url).toBeUndefined();
  });
});

describe('a Moodle feed', () => {
  const calendar = parseIcs(fixture('moodle.ics'));
  const tasks = icsToTasks(calendar, { feedId: 'feed2', tz: 'Asia/Bangkok', now: T0 });
  const byUid = (uid: string) => tasks.find((t) => t.id === `ics:feed2:${uid}`);

  test('events and to-dos are both read; time zone definitions are skipped', () => {
    expect(calendar.items.map((i) => i.type)).toEqual(['VEVENT', 'VEVENT', 'VEVENT', 'VTODO', 'VTODO', 'VTODO']);
    expect(tasks).toHaveLength(6);
  });

  test('"is due" is trimmed, the course comes from CATEGORIES, escapes and tab folding are handled', () => {
    const t = byUid('48213@moodle.school.example');
    expect(t).toMatchObject({ title: 'Lab report: Titration', course: 'CHEM-10B', due: Date.UTC(2026, 10, 12, 16, 59, 0) });
    expect(t?.description).toBe('Upload your report as a single PDF.\n\nInclude:\n- data table\n- error analysis; show your working\n- "sources", at least 2');
    expect(t?.kind).toBe(guessKind({ title: 'Lab report: Titration', description: t?.description }));
  });

  test('prefixed TZIDs and HTML descriptions', () => {
    const t = byUid('48377@moodle.school.example');
    // 08:15 in Berlin (UTC+1 in winter)
    expect(t).toMatchObject({ title: 'Kapitel 5 Vokabeltest closes', course: 'DE-9', due: Date.UTC(2026, 10, 17, 7, 15, 0) });
    expect(t?.description).toBe('Der Test umfasst Kapitel 5.\n- 30 Minuten\n- ein Versuch');
  });

  test('Windows zone names from Outlook exports', () => {
    // 09:00 Eastern
    expect(byUid('040000008200E00074C5B7101A82E00800000000A0B1')).toMatchObject({ title: 'History essay conference', kind: 'essay', due: Date.UTC(2026, 10, 18, 14, 0, 0) });
  });

  test('VTODO: DUE with a zone, all-day DUE in the student zone, completion, and no date at all', () => {
    expect(byUid('todo-771@moodle.school.example')).toMatchObject({
      title: 'Finish vocabulary deck',
      due: Date.UTC(2026, 10, 14, 17, 0, 0),
      doneAtSource: false,
      sourceCreatedAt: Date.UTC(2026, 10, 5, 7, 0, 0),
    });
    // all-day and no calendar zone: end of 15 Nov in Bangkok (UTC+7)
    expect(byUid('todo-772@moodle.school.example')).toMatchObject({ title: 'Return library book', due: Date.UTC(2026, 10, 15, 16, 59, 0), doneAtSource: true });
    expect(byUid('todo-773@moodle.school.example')).toMatchObject({ title: 'Ask about the science fair', due: null, doneAtSource: false });
  });
});

describe('edge cases', () => {
  const wrap = (body: string): string => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;

  test('something that is not a calendar is refused', () => {
    expect(() => parseIcs('<!doctype html><title>Sign in</title>')).toThrow(/iCalendar/);
    expect(() => parseIcs('')).toThrow();
  });

  test('items older than 14 days are skipped, 13 days is still in', () => {
    const at = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const ics = wrap(
      `BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Too old\r\nDTSTART:${at(T0 - 15 * DAY)}\r\nEND:VEVENT\r\n` +
        `BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Recent\r\nDTSTART:${at(T0 - 13 * DAY)}\r\nEND:VEVENT\r\n`,
    );
    expect(icsToTasks(parseIcs(ics), { feedId: 'f', tz: 'UTC', now: T0 }).map((t) => t.title)).toEqual(['Recent']);
  });

  test('overridden instances of a repeating event get their own id; absurd UIDs are hashed', () => {
    const long = 'x'.repeat(300);
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:series-1\r\nSUMMARY:Study group\r\nDTSTART:20261112T100000Z\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:series-1\r\nRECURRENCE-ID:20261119T100000Z\r\nSUMMARY:Study group (moved)\r\nDTSTART:20261119T120000Z\r\nEND:VEVENT\r\n' +
        `BEGIN:VEVENT\r\nUID:${long}\r\nSUMMARY:Long id\r\nDTSTART:20261112T100000Z\r\nEND:VEVENT\r\n` +
        'BEGIN:VEVENT\r\nSUMMARY:No uid at all\r\nDTSTART:20261112T100000Z\r\nEND:VEVENT\r\n',
    );
    const ids = icsToTasks(parseIcs(ics), { feedId: 'f', tz: 'UTC', now: T0 }).map((t) => t.id);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe('ics:f:series-1');
    expect(ids[1]).toBe('ics:f:series-1:20261119T100000Z');
    expect(ids[2]).toMatch(/^ics:f:h[0-9a-f]{32}$/);
  });

  test('a feed built to be slow to read is not', () => {
    const nasty =
      `BEGIN:VEVENT\r\nUID:n1\r\nSUMMARY:${' '.repeat(200_000)}[\r\nDESCRIPTION:${'<a '.repeat(200_000)}\r\nDTSTART:20261112T100000Z\r\nEND:VEVENT\r\n` +
      `BEGIN:VEVENT\r\nUID:n2\r\nSUMMARY:${'[x] '.repeat(50_000)}\r\nDTSTART:20261112T100000Z\r\nEND:VEVENT\r\n`;
    const started = performance.now();
    const tasks = icsToTasks(parseIcs(wrap(nasty)), { feedId: 'f', tz: 'UTC', now: T0 });
    // quadratic behaviour here would take minutes; the margin is for slow machines
    expect(performance.now() - started).toBeLessThan(3000);
    // the first has nothing left for a title once trimmed, the second is cut to a sane length
    expect(tasks.map((t) => t.id)).toEqual(['ics:f:n2']);
    expect(tasks[0].title.length).toBeLessThanOrEqual(300);
  });

  test('a wall-clock time in a daylight-saving zone lands on the right instant on both sides of the change', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:summer\r\nSUMMARY:Summer\r\nDTSTART;TZID=Europe/Berlin:20270615T090000\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:winter\r\nSUMMARY:Winter\r\nDTSTART;TZID=Europe/Berlin:20270115T090000\r\nEND:VEVENT\r\n',
    );
    const [summer, winter] = icsToTasks(parseIcs(ics), { feedId: 'f', tz: 'UTC', now: T0 });
    expect(summer.due).toBe(Date.UTC(2027, 5, 15, 7, 0, 0));
    expect(winter.due).toBe(Date.UTC(2027, 0, 15, 8, 0, 0));
  });
});
