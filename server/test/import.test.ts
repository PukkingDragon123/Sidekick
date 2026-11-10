import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { mergeState, type SaveState, type Task } from '../../shared/src/index.ts';
import { applyImport, cleanText, htmlToText, isStale, safeHttpUrl, type ImportedTask } from '../src/integrations/importer.ts';
import { DAY, HOUR, T0, boot, closeAll, fakeFetch, makeState, makeTask, type FakeFetch } from './helpers.ts';

afterEach(closeAll);

const here = path.dirname(fileURLToPath(import.meta.url));
const ics = (name: string): string => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');

const item = (over: Partial<ImportedTask> = {}): ImportedTask => ({
  id: 'google:c1:w1',
  source: 'google',
  externalId: 'c1:w1',
  title: 'Essay: The Giver',
  course: 'English 9',
  description: 'Five paragraphs.',
  due: T0 + 3 * DAY,
  url: 'https://classroom.google.com/c/c1/a/w1/details',
  points: 100,
  kind: 'essay',
  doneAtSource: false,
  ...over,
});

describe('applyImport', () => {
  test('a new item becomes a task; importing it again changes nothing', () => {
    const state = makeState();
    expect(applyImport(state, [item()], T0)).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(state.tasks).toEqual([
      {
        id: 'google:c1:w1', source: 'google', externalId: 'c1:w1', title: 'Essay: The Giver', course: 'English 9',
        description: 'Five paragraphs.', due: T0 + 3 * DAY, url: 'https://classroom.google.com/c/c1/a/w1/details',
        points: 100, kind: 'essay', done: false, createdAt: T0, updatedAt: T0,
      },
    ]);
    const before = structuredClone(state.tasks);
    expect(applyImport(state, [item()], T0 + HOUR)).toEqual({ added: 0, updated: 0, skipped: 0 });
    expect(state.tasks).toEqual(before);
  });

  test("a re-import updates what the source owns and leaves the student's own edits alone", () => {
    const state = makeState();
    applyImport(state, [item()], T0);
    // the student works on it in the app
    Object.assign(state.tasks[0], {
      estMin: 75,
      notes: 'thesis: memory makes choice possible',
      steps: [{ text: 'outline', done: true }, { text: 'draft', done: false }],
      pinned: true,
      kind: 'project',
      updatedAt: T0 + HOUR,
    } satisfies Partial<Task>);

    // the teacher renames it, moves the deadline and changes the points
    const changed = item({
      title: 'Essay: The Giver (final)', course: 'English 9 Honors', description: 'Six paragraphs now.',
      due: T0 + 5 * DAY, url: 'https://classroom.google.com/c/c1/a/w1/details?v=2', points: 120, kind: 'essay',
    });
    expect(applyImport(state, [changed], T0 + 2 * HOUR)).toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(state.tasks[0]).toEqual({
      id: 'google:c1:w1', source: 'google', externalId: 'c1:w1',
      // from the source
      title: 'Essay: The Giver (final)', course: 'English 9 Honors', description: 'Six paragraphs now.',
      due: T0 + 5 * DAY, url: 'https://classroom.google.com/c/c1/a/w1/details?v=2', points: 120,
      // the student's
      estMin: 75, notes: 'thesis: memory makes choice possible',
      steps: [{ text: 'outline', done: true }, { text: 'draft', done: false }], pinned: true, kind: 'project',
      done: false, createdAt: T0,
      // one tick, not "now": see the next test
      updatedAt: T0 + HOUR + 1,
    });
  });

  test('done flips to true when the source says submitted, and never back', () => {
    const state = makeState();
    applyImport(state, [item()], T0);
    expect(applyImport(state, [item({ doneAtSource: true })], T0 + HOUR)).toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(state.tasks[0]).toMatchObject({ done: true, doneAt: T0 + HOUR });
    expect(state.tasks[0]).not.toHaveProperty('rewarded');

    // teacher hands it back for revision: the task stays done, the reward flag is the game's business
    state.tasks[0].rewarded = true;
    expect(applyImport(state, [item({ doneAtSource: false })], T0 + 2 * HOUR)).toEqual({ added: 0, updated: 0, skipped: 0 });
    expect(state.tasks[0]).toMatchObject({ done: true, doneAt: T0 + HOUR, rewarded: true });
  });

  test('a task the student ticked off themselves stays done although the source disagrees', () => {
    const state = makeState();
    applyImport(state, [item()], T0);
    Object.assign(state.tasks[0], { done: true, doneAt: T0 + HOUR, rewarded: true, updatedAt: T0 + HOUR });
    expect(applyImport(state, [item()], T0 + 2 * HOUR)).toEqual({ added: 0, updated: 0, skipped: 0 });
    expect(state.tasks[0]).toMatchObject({ done: true, doneAt: T0 + HOUR, rewarded: true, updatedAt: T0 + HOUR });
  });

  test('an edit made offline on another device survives an import that happened in between', () => {
    const server = makeState();
    applyImport(server, [item()], T0);
    const device: SaveState = structuredClone(server);

    // the device, offline, adds notes; meanwhile the server imports a new deadline
    Object.assign(device.tasks[0], { notes: 'ask Ms. Ito about sources', updatedAt: T0 + HOUR });
    applyImport(server, [item({ due: T0 + 6 * DAY })], T0 + 2 * HOUR);
    expect(server.tasks[0].due).toBe(T0 + 6 * DAY);

    // the device syncs: its edit is newer than the import's one-tick bump, so it wins the per-task merge
    const merged = mergeState(server, device, T0 + 3 * HOUR);
    expect(merged.tasks[0].notes).toBe('ask Ms. Ito about sources');
    // ...and the next import lays the source's deadline back over it: both edits are there
    expect(applyImport(merged, [item({ due: T0 + 6 * DAY })], T0 + 4 * HOUR)).toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(merged.tasks[0]).toMatchObject({ notes: 'ask Ms. Ito about sources', due: T0 + 6 * DAY });

    // a device with no edits of its own simply receives the imported change
    const idle: SaveState = structuredClone(makeState());
    applyImport(idle, [item()], T0);
    expect(mergeState(merged, idle, T0 + 5 * HOUR).tasks[0].due).toBe(T0 + 6 * DAY);
  });

  test('a deleted task is not resurrected, and its tombstone is kept alive while the source lists it', () => {
    const state = makeState();
    applyImport(state, [item()], T0);
    Object.assign(state.tasks[0], { deleted: true, updatedAt: T0 + HOUR });
    expect(applyImport(state, [item({ title: 'Renamed' })], T0 + DAY)).toEqual({ added: 0, updated: 0, skipped: 0 });
    expect(state.tasks[0]).toMatchObject({ deleted: true, title: 'Essay: The Giver', updatedAt: T0 + HOUR });

    // shared mergeTasks drops tombstones after 30 days; ours is refreshed before that can happen
    applyImport(state, [item()], T0 + 25 * DAY);
    expect(state.tasks[0]).toMatchObject({ deleted: true, updatedAt: T0 + 25 * DAY });
    const later = mergeState(state, structuredClone(state), T0 + 40 * DAY);
    expect(later.tasks).toHaveLength(1);
    expect(applyImport(later, [item()], T0 + 40 * DAY)).toEqual({ added: 0, updated: 0, skipped: 0 });
  });

  test('undefined means "the source did not say": the field is kept; null due means "no deadline now"', () => {
    const state = makeState();
    applyImport(state, [item()], T0);
    const sparse = item({ course: undefined, description: undefined, url: undefined, points: undefined, due: undefined });
    expect(applyImport(state, [sparse], T0 + HOUR)).toEqual({ added: 0, updated: 0, skipped: 0 });
    expect(state.tasks[0]).toMatchObject({ course: 'English 9', description: 'Five paragraphs.', points: 100, due: T0 + 3 * DAY });

    expect(applyImport(state, [item({ due: null })], T0 + 2 * HOUR)).toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(state.tasks[0]).not.toHaveProperty('due');
  });

  test('history is not imported: stale deadlines, undated work already handed in, and long-forgotten undated work', () => {
    expect(isStale(item({ due: T0 - 15 * DAY }), T0)).toBe(true);
    expect(isStale(item({ due: T0 - 13 * DAY }), T0)).toBe(false);
    expect(isStale(item({ due: null, doneAtSource: true }), T0)).toBe(true);
    expect(isStale(item({ due: null, sourceCreatedAt: T0 - 90 * DAY }), T0)).toBe(true);
    expect(isStale(item({ due: null, sourceCreatedAt: T0 - 10 * DAY }), T0)).toBe(false);
    expect(isStale(item({ due: null }), T0)).toBe(false);

    const state = makeState();
    expect(applyImport(state, [item({ due: T0 - 40 * DAY })], T0)).toEqual({ added: 0, updated: 0, skipped: 0 });
    expect(state.tasks).toEqual([]);
    // ...but a task the student already has keeps receiving updates however old it gets
    applyImport(state, [item({ due: T0 - 1 * DAY })], T0);
    expect(applyImport(state, [item({ due: T0 - 1 * DAY, doneAtSource: true })], T0 + 30 * DAY)).toEqual({ added: 0, updated: 1, skipped: 0 });
  });

  test('one source holds at most 300 open tasks: the nearest deadlines get in, the rest waits', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      item({ id: `ics:feedA:e${i}`, source: 'ics', externalId: `feedA:e${i}`, title: `Event ${i}`, due: T0 + (400 - i) * HOUR }),
    );
    const state = makeState();
    expect(applyImport(state, many, T0)).toEqual({ added: 300, updated: 0, skipped: 100 });
    // the 300 kept are the 300 soonest (the feed listed them latest-first)
    const kept = new Set(state.tasks.map((t) => t.id));
    expect(kept.has('ics:feedA:e399')).toBe(true);
    expect(kept.has('ics:feedA:e100')).toBe(true);
    expect(kept.has('ics:feedA:e99')).toBe(false);

    // another feed and another provider have places of their own
    const other = [item({ id: 'ics:feedB:x', source: 'ics', externalId: 'feedB:x' }), item()];
    expect(applyImport(state, other, T0)).toEqual({ added: 2, updated: 0, skipped: 0 });
    // work that is already handed in does not take a place
    expect(applyImport(state, [item({ id: 'ics:feedA:done', source: 'ics', externalId: 'feedA:done', doneAtSource: true })], T0)).toEqual({ added: 1, updated: 0, skipped: 0 });

    // as the student finishes things, the waiting ones move in
    for (const t of state.tasks.slice(0, 40)) Object.assign(t, { done: true, doneAt: T0 + HOUR, updatedAt: T0 + HOUR });
    expect(applyImport(state, many, T0 + 2 * HOUR)).toEqual({ added: 40, updated: 0, skipped: 60 });
  });

  test('manual tasks and other sources are never touched', () => {
    const mine = makeTask({ id: 'm1', title: 'Clean desk', notes: 'before Friday' });
    const state = makeState({ tasks: [mine] });
    applyImport(state, [item(), item({ id: 'ics:f:1', source: 'ics', externalId: 'f:1', title: 'Quiz' })], T0);
    expect(state.tasks).toHaveLength(3);
    expect(state.tasks[0]).toEqual(mine);
  });
});

describe('text hygiene', () => {
  test('HTML becomes readable text', () => {
    expect(cleanText(htmlToText('<div>Read <b>ch.&nbsp;4</b></div><p>Answer:</p><ul><li>Q1 &amp; Q2</li><li>Q5&#39;s part &lt;b&gt;</li></ul>'), 500)).toBe(
      "Read ch. 4\nAnswer:\n- Q1 & Q2\n- Q5's part <b>",
    );
  });

  test('long text is cut with an ellipsis; empty text disappears', () => {
    expect(cleanText('  a\r\n\r\n\r\n\r\nb  \t c ', 100)).toBe('a\n\nb c');
    expect(cleanText('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(cleanText('   ', 10)).toBeUndefined();
    expect(cleanText(42, 10)).toBeUndefined();
  });

  test('hostile markup costs linear time', () => {
    const started = performance.now();
    expect(htmlToText('<'.repeat(400_000))).toHaveLength(20_000);
    expect(htmlToText(`${'<li '.repeat(100_000)}`)).toContain('<li');
    expect(cleanText(`${' \n'.repeat(300_000)}x`, 100)).toBeUndefined();
    expect(cleanText('y'.repeat(1_000_000), 50)).toHaveLength(50);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test('only web links survive', () => {
    expect(safeHttpUrl('https://teams.microsoft.com/l/entity/x')).toBe('https://teams.microsoft.com/l/entity/x');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'not a url', '', undefined]) expect(safeHttpUrl(bad)).toBeUndefined();
  });
});

describe('iCal feeds through the API', () => {
  const FEED = 'https://canvas.example.edu/feeds/calendars/user_8sKq2secretToken.ics';

  function feedServer(): { body: string; status: number; out: FakeFetch } {
    const sim = { body: ics('canvas.ics'), status: 200, out: undefined as unknown as FakeFetch };
    sim.out = fakeFetch((call) =>
      call.url.hostname === 'canvas.example.edu' ? new Response(sim.body, { status: sim.status, headers: { 'content-type': 'text/calendar' } }) : undefined,
    );
    return sim;
  }

  test('adding a feed checks it, stores the link encrypted and imports its items', async () => {
    const sim = feedServer();
    const h = await boot({ fetch: sim.out.fetch });
    const a = await h.register();
    const b = await h.link(a.token);
    await h.putState(a.token, makeState());
    const wsB = await h.ws(b.token);

    // a webcal:// link, as "subscribe" buttons hand them out
    const res = await h.api('POST', '/api/integrations/ics', { token: a.token, body: { url: FEED.replace('https://', 'webcal://'), label: 'Canvas' } });
    expect(res.status).toBe(200);
    expect(res.body.integration).toEqual({ id: expect.stringMatching(/^int_/), provider: 'ics', label: 'Canvas', lastSync: T0 });
    expect(res.body).toMatchObject({ added: 4, updated: 0, errors: [] });
    const tasks = res.body.state.tasks as Task[];
    expect(tasks.map((t) => t.title).sort()).toEqual(['Poster draft', 'Reading Response 3: The Giver', 'Science fair project check-in', 'Unit 3 Quiz']);
    // id = ics:<feed id>:<UID>, where the feed id is stable for the link
    expect(tasks.find((t) => t.title === 'Unit 3 Quiz')?.id).toMatch(/^ics:[0-9a-f]{12}:event-assignment-481600$/);
    expect(tasks.every((t) => t.source === 'ics' && t.createdAt === T0)).toBe(true);

    // the other device hears about it; the fetch went to https with a calendar Accept header
    expect((await wsB.take('state')).state.tasks).toHaveLength(4);
    expect(sim.out.calls[0].url.href).toBe(FEED);
    expect(sim.out.calls[0].headers.get('accept')).toContain('text/calendar');

    // feed links are bearer secrets: the stored row does not contain it in the clear
    const dump = JSON.stringify(h.server.ctx.db.raw.prepare('SELECT * FROM integrations').all());
    expect(dump).not.toContain('8sKq2secretToken');
    expect(dump).not.toContain('canvas.example.edu');
  });

  test('re-sync and re-adding the same link update in place without touching the student\'s edits', async () => {
    const sim = feedServer();
    const h = await boot({ fetch: sim.out.fetch });
    const a = await h.register();
    await h.putState(a.token, makeState());
    const first = await h.api('POST', '/api/integrations/ics', { token: a.token, body: { url: FEED } });
    // no label given: the calendar's own name is used
    expect(first.body.integration.label).toBe('Mina Suzuki Calendar (Canvas)');

    // the student edits a task and ticks another off, on their device
    const mine = structuredClone(first.body.state as SaveState);
    const quiz = mine.tasks.find((t) => t.title === 'Unit 3 Quiz') as Task;
    Object.assign(quiz, { estMin: 25, notes: 'factoring + FOIL', pinned: true, steps: [{ text: 'redo 7.2', done: false }], updatedAt: T0 + HOUR });
    const poster = mine.tasks.find((t) => t.title === 'Poster draft') as Task;
    Object.assign(poster, { done: true, doneAt: T0 + HOUR, rewarded: true, updatedAt: T0 + HOUR });
    h.clock.now = T0 + HOUR;
    await h.putState(a.token, mine);

    // the teacher renames the quiz and moves it a day
    sim.body = sim.body.replace('SUMMARY:Unit 3 Quiz [ALG1-04]', 'SUMMARY:Unit 3 Quiz (moved) [ALG1-04]').replaceAll('VALUE=DATE:20261116', 'VALUE=DATE:20261117');
    h.clock.now = T0 + 2 * HOUR;
    const sync = await h.api('POST', '/api/integrations/sync', { token: a.token });
    expect(sync.body).toMatchObject({ added: 0, updated: 1, errors: [] });
    const after = (sync.body.state as SaveState).tasks;
    expect(after).toHaveLength(4);
    expect(after.find((t) => t.id === quiz.id)).toMatchObject({
      title: 'Unit 3 Quiz (moved)', due: Date.UTC(2026, 10, 18, 5, 59, 0),
      estMin: 25, notes: 'factoring + FOIL', pinned: true, steps: [{ text: 'redo 7.2', done: false }],
    });
    expect(after.find((t) => t.id === poster.id)).toMatchObject({ done: true, doneAt: T0 + HOUR, rewarded: true, updatedAt: T0 + HOUR });

    // adding the very same link again is an update, not a second feed with duplicate tasks
    const again = await h.api('POST', '/api/integrations/ics', { token: a.token, body: { url: FEED, label: 'School' } });
    expect(again.body).toMatchObject({ added: 0, updated: 0 });
    expect(again.body.integration.id).toBe(first.body.integration.id);
    expect(again.body.integration.label).toBe('School');
    expect((await h.api('GET', '/api/integrations', { token: a.token })).body.items).toHaveLength(1);
    expect(again.body.state.tasks).toHaveLength(4);
  });

  test('links that are not calendars, or that fail, are refused and not stored', async () => {
    const sim = feedServer();
    const h = await boot({ fetch: sim.out.fetch });
    const a = await h.register();
    await h.putState(a.token, makeState());
    const add = () => h.api('POST', '/api/integrations/ics', { token: a.token, body: { url: FEED } });

    sim.body = '<!doctype html><html><body>Please sign in</body></html>';
    expect((await add()).body).toEqual({ error: 'That link does not point to a calendar feed (.ics).', code: 'feed_error' });
    sim.status = 404;
    expect((await add()).body.code).toBe('feed_error');
    sim.status = 500;
    expect((await add()).status).toBe(400);
    expect((await h.api('POST', '/api/integrations/ics', { token: a.token, body: { url: 'nope' } })).body.code).toBe('invalid_body');
    expect((await h.api('GET', '/api/integrations', { token: a.token })).body.items).toEqual([]);
  });

  test('a feed that breaks later is reported per source while the others still sync', async () => {
    const sim = feedServer();
    const moodle = ics('moodle.ics');
    const out = fakeFetch(
      (call) => (call.url.hostname === 'moodle.school.example' ? new Response(moodle) : undefined),
      (call) => sim.out.fetch(call.url.href) as Promise<Response>,
    );
    const h = await boot({ fetch: out.fetch });
    const a = await h.register();
    await h.putState(a.token, makeState());
    expect((await h.api('POST', '/api/integrations/ics', { token: a.token, body: { url: FEED, label: 'Canvas' } })).body.added).toBe(4);
    const second = await h.api('POST', '/api/integrations/ics', { token: a.token, body: { url: 'https://moodle.school.example/calendar/export_execute.php?userid=7&authtoken=abc', label: 'Moodle' } });
    // all six items: the to-do that is already completed has a date, so it comes in as a finished task
    expect(second.body.added).toBe(6);
    expect((second.body.state as SaveState).tasks.find((t) => t.title === 'Return library book')).toMatchObject({ done: true });

    sim.status = 403;
    h.clock.now = T0 + HOUR;
    const sync = await h.api('POST', '/api/integrations/sync', { token: a.token });
    expect(sync.body.errors).toEqual([{ provider: 'ics', message: 'The calendar link was refused. Copy a fresh link from your school site.' }]);
    expect(sync.body.state.tasks).toHaveLength(10);
    const items = (await h.api('GET', '/api/integrations', { token: a.token })).body.items as { label: string; error?: string; lastSync?: number }[];
    expect(items.find((i) => i.label === 'Canvas')).toMatchObject({ error: expect.stringContaining('refused'), lastSync: T0 });
    expect(items.find((i) => i.label === 'Moodle')).toMatchObject({ lastSync: T0 + HOUR });
    expect(items.find((i) => i.label === 'Moodle')).not.toHaveProperty('error');
  });
});
