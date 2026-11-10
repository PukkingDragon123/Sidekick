// The once-a-minute job, driven by hand with a fake clock. Push services are an injected
// fetch; the messages are decrypted with the subscription's own keys to check what a
// device would really receive.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { SPECIES_INFO, type SaveState } from '../../shared/src/index.ts';
import type { Notice } from '../src/push.ts';
import {
  DAY, HOUR, MIN, T0, boot, closeAll, fakeFetch, makeState, makeSubscription, makeTask,
  type FakeFetch, type Harness, type TestSubscription,
} from './helpers.ts';

afterEach(closeAll);

/** Bangkok wall clock (UTC+7, no daylight saving) to epoch ms. */
const local = (y: number, mo: number, d: number, h: number, mi: number): number => Date.UTC(y, mo - 1, d, h - 7, mi);

interface Rig {
  h: Harness;
  out: FakeFetch;
  token: string;
  accountId: string;
  sub: TestSubscription;
  /** status the push service answers with, per endpoint path */
  pushStatus: Record<string, number>;
  /** decrypted push messages delivered so far to the main subscription */
  pushed(): Notice[];
  /** run the scheduler at the current fake time */
  tick(): Promise<void>;
  /** a save with reminders and briefings quiet unless a test turns them on */
  save(over: Partial<SaveState>, settings?: Partial<SaveState['settings']>): Promise<SaveState>;
}

async function rig(env: Record<string, string> = {}): Promise<Rig> {
  const pushStatus: Record<string, number> = {};
  const out = fakeFetch((call) =>
    call.url.hostname === 'push.example.com' ? new Response(null, { status: pushStatus[call.url.pathname] ?? 201 }) : undefined,
  );
  const h = await boot({ fetch: out.fetch, env });
  const a = await h.register('Phone', 'mobile');
  const sub = makeSubscription('https://push.example.com/send/main');
  const subscribed = await h.api('POST', '/api/push/subscribe', { token: a.token, body: { subscription: { ...sub.json, expirationTime: null } } });
  expect(subscribed.body).toEqual({ ok: true });
  return {
    h, out, token: a.token, accountId: a.accountId, sub, pushStatus,
    pushed: () => out.to('https://push.example.com/send/main').map((c) => sub.open(c.bytes) as Notice),
    tick: () => h.server.tick(),
    save: (over, settings = {}) => {
      const base = makeState();
      return h.putState(a.token, { ...base, ...over, settings: { ...base.settings, notifyDueSoon: false, notifyDaily: false, ...settings } });
    },
  };
}

describe('push plumbing', () => {
  test('the VAPID key is served, generated once and kept encrypted', async () => {
    const r = await rig();
    const key = await r.h.api('GET', '/api/push/key', { token: r.token });
    expect(key.body.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect((await r.h.api('GET', '/api/push/key')).status).toBe(401);
    const kv = Object.fromEntries((r.h.server.ctx.db.raw.prepare('SELECT k, v FROM kv').all() as { k: string; v: string }[]).map((x) => [x.k, x.v]));
    expect(kv.vapid_public).toBe(key.body.publicKey);
    expect(kv.vapid_private).toMatch(/^v1\./);
    expect(kv.vapid_private).not.toContain(r.h.server.ctx.vapid.privateKey);
  });

  test('keys from the environment are used as they are', async () => {
    const env = { VAPID_PUBLIC_KEY: 'BPublicKeyFromEnv', VAPID_PRIVATE_KEY: 'private-from-env' };
    const h = await boot({ env });
    const a = await h.register();
    expect((await h.api('GET', '/api/push/key', { token: a.token })).body).toEqual({ publicKey: 'BPublicKeyFromEnv' });
  });

  test('a test push reaches every subscription and open socket, as an encrypted standard web push', async () => {
    const r = await rig();
    await r.save({});
    const ws = await r.h.ws(r.token);
    const res = await r.h.api('POST', '/api/push/test', { token: r.token });
    expect(res.body).toEqual({ ok: true, sent: 1 });

    const [call] = r.out.to('https://push.example.com');
    expect(call.method).toBe('POST');
    expect(call.headers.get('content-encoding')).toBe('aes128gcm');
    expect(call.headers.get('authorization')).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(Number(call.headers.get('ttl'))).toBeGreaterThan(0);
    // the payload is not readable on the wire...
    expect(call.body).not.toContain('nudge');
    // ...and decrypts, with the subscription's keys, to the notice
    expect(r.pushed()).toEqual([{ title: 'It works', body: 'This is what a nudge from me looks like. — Ember', tag: 'test' }]);
    expect(await ws.take('notify')).toEqual({ t: 'notify', title: 'It works', body: 'This is what a nudge from me looks like. — Ember' });
  });

  test('subscriptions the push service has dropped (404/410) are removed; other failures are kept', async () => {
    const r = await rig();
    await r.save({});
    for (const name of ['gone', 'missing', 'flaky']) {
      await r.h.api('POST', '/api/push/subscribe', { token: r.token, body: { subscription: makeSubscription(`https://push.example.com/send/${name}`).json } });
    }
    Object.assign(r.pushStatus, { '/send/gone': 410, '/send/missing': 404, '/send/flaky': 500 });
    expect((await r.h.api('POST', '/api/push/test', { token: r.token })).body.sent).toBe(1);
    expect(r.h.server.ctx.db.pushSubs(r.accountId).map((s) => s.endpoint).sort()).toEqual([
      'https://push.example.com/send/flaky',
      'https://push.example.com/send/main',
    ]);
    // subscribing the same endpoint again updates it instead of duplicating
    await r.h.api('POST', '/api/push/subscribe', { token: r.token, body: { subscription: r.sub.json } });
    expect(r.h.server.ctx.db.pushSubs(r.accountId)).toHaveLength(2);
  });
});

describe('reminders', () => {
  test('a reminder fires once when it is due: push, socket notify, marked fired, state broadcast', async () => {
    const r = await rig();
    await r.save({
      tasks: [makeTask({ id: 'quiz1', title: 'Unit 3 Quiz' })],
      reminders: [
        { id: 'r1', at: T0 + 5 * MIN, text: 'Quiz practice, 20 minutes.', taskId: 'quiz1', createdAt: T0 },
        { id: 'r2', at: T0 + 3 * HOUR, text: 'Pack your bag', createdAt: T0 },
      ],
    });
    const ws = await r.h.ws(r.token);

    await r.tick();
    expect(r.pushed()).toEqual([]);

    r.h.clock.now = T0 + 5 * MIN + 20_000;
    await r.tick();
    expect(r.pushed()).toEqual([{ title: 'Reminder', body: 'Quiz practice, 20 minutes. — Ember', tag: 'reminder:r1', taskId: 'quiz1' }]);
    expect(await ws.take('notify')).toEqual({ t: 'notify', title: 'Reminder', body: 'Quiz practice, 20 minutes. — Ember', taskId: 'quiz1' });
    // the scheduler changed the save, so every socket (there is no "sender" here) gets the new state
    const pushedState = (await ws.take('state')).state;
    expect(pushedState.reminders.map((x) => [x.id, x.fired === true])).toEqual([['r1', true], ['r2', false]]);
    expect(pushedState.stamps.reminders).toBeGreaterThan(0);

    for (let i = 0; i < 3; i++) {
      r.h.clock.now += MIN;
      await r.tick();
    }
    expect(r.pushed()).toHaveLength(1);
  });

  test('a client overwriting the reminders with a stale copy does not make it fire twice', async () => {
    const r = await rig();
    const reminders = [{ id: 'r1', at: T0 + MIN, text: 'Stretch', createdAt: T0 }];
    const state = await r.save({ reminders });
    r.h.clock.now = T0 + 2 * MIN;
    await r.tick();
    expect(r.pushed()).toHaveLength(1);

    // an offline device comes back with the reminder still unfired and a newer stamp
    r.h.clock.now = T0 + 3 * MIN;
    await r.h.putState(r.token, { ...state, reminders, stamps: { ...state.stamps, reminders: Date.now() + 60_000 } });
    r.h.clock.now = T0 + 4 * MIN;
    await r.tick();
    expect(r.pushed()).toHaveLength(1);
    expect(((await r.h.getState(r.token)) as SaveState).reminders[0].fired).toBe(true);
  });

  test('a reminder that is many hours late is retired quietly', async () => {
    const r = await rig();
    await r.save({ reminders: [{ id: 'old', at: T0 - 13 * HOUR, text: 'Yesterday', createdAt: T0 - DAY }] });
    await r.tick();
    expect(r.pushed()).toEqual([]);
    expect(((await r.h.getState(r.token)) as SaveState).reminders[0].fired).toBe(true);
  });

  test('the signature is the active sidekick\'s name', async () => {
    const r = await rig();
    const base = makeState();
    await r.save({
      sidekicks: [...base.sidekicks, { id: 'sk2', name: 'Miso', look: { species: 'cat', ...SPECIES_INFO.cat.look }, outfit: {} }],
      active: 'sk2',
      reminders: [{ id: 'r1', at: T0, text: 'Nap is over.', createdAt: T0 }],
    });
    await r.tick();
    expect(r.pushed()[0].body).toBe('Nap is over. — Miso');
  });
});

describe('due-soon nudges', () => {
  const task = (id: string, title: string, due: number, over = {}) => makeTask({ id, title, due, ...over });

  test('one nudge a day out and one two hours out, each exactly once', async () => {
    const r = await rig();
    const due = T0 + 30 * HOUR;
    await r.save({ tasks: [task('essay1', 'Essay: The Giver', due)] }, { notifyDueSoon: true });

    await r.tick();
    expect(r.pushed()).toEqual([]);

    r.h.clock.now = due - 24 * HOUR + MIN;
    await r.tick();
    await r.tick();
    expect(r.pushed()).toEqual([
      { title: 'Due soon', body: '"Essay: The Giver" is due in 24h (Wed 11 Nov 2026, 22:00). A small start now makes it easy. — Ember', taskId: 'essay1', tag: 'due:essay1' },
    ]);

    r.h.clock.now = due - 10 * HOUR;
    await r.tick();
    expect(r.pushed()).toHaveLength(1);

    r.h.clock.now = due - 2 * HOUR + MIN;
    await r.tick();
    await r.tick();
    expect(r.pushed().at(-1)).toEqual({ title: 'Almost due', body: '"Essay: The Giver" is due at 22:00. Quick sprint now? — Ember', taskId: 'essay1', tag: 'due:essay1' });
    expect(r.pushed()).toHaveLength(2);

    r.h.clock.now = due + HOUR;
    await r.tick();
    expect(r.pushed()).toHaveLength(2);
  });

  test('finished, deleted and undated tasks are left alone; the setting switches nudges off', async () => {
    const r = await rig();
    const soon = T0 + 90 * MIN;
    const tasks = [
      task('done', 'Done already', soon, { done: true }),
      task('deleted', 'Deleted', soon, { deleted: true }),
      makeTask({ id: 'undated', title: 'No deadline' }),
      task('open', 'Still open', soon),
    ];
    await r.save({ tasks }, { notifyDueSoon: false });
    await r.tick();
    expect(r.pushed()).toEqual([]);

    r.h.clock.now += MIN;
    const state = (await r.h.getState(r.token)) as SaveState;
    await r.h.putState(r.token, { ...state, settings: { ...state.settings, notifyDueSoon: true }, stamps: { ...state.stamps, settings: r.h.clock.now } });
    await r.tick();
    expect(r.pushed().map((n) => n.taskId)).toEqual(['open']);
  });

  test('several tasks crossing the line together arrive as one message', async () => {
    const r = await rig();
    await r.save(
      { tasks: [task('a', 'Worksheet 7.2', T0 + 20 * HOUR), task('b', 'Reading log', T0 + 21 * HOUR), task('c', 'Vocabulary list 5', T0 + 22 * HOUR), task('d', 'Lab safety form', T0 + HOUR)] },
      { notifyDueSoon: true },
    );
    await r.tick();
    expect(r.pushed()).toEqual([
      { title: 'Almost due', body: '"Lab safety form" is due at 17:00. Quick sprint now? — Ember', taskId: 'd', tag: 'due:d' },
      { title: 'Due soon', body: '3 things are due in the next day: "Worksheet 7.2", "Reading log" and 1 more. — Ember', tag: 'due:24h' },
    ]);
  });

  test('moving a deadline earns a fresh nudge; a task typed in a moment ago does not get one', async () => {
    const r = await rig();
    const state = await r.save(
      { tasks: [task('a', 'Poster', T0 + 20 * HOUR), task('fresh', 'Just added', T0 + 5 * HOUR, { createdAt: T0 - 2 * MIN, updatedAt: T0 - 2 * MIN })] },
      { notifyDueSoon: true },
    );
    await r.tick();
    expect(r.pushed().map((n) => n.taskId)).toEqual(['a']);

    // the teacher (or the student) moves the poster to a new time inside the window
    r.h.clock.now = T0 + HOUR;
    const moved = structuredClone(state);
    Object.assign(moved.tasks[0], { due: T0 + 23 * HOUR, updatedAt: r.h.clock.now });
    await r.h.putState(r.token, moved);
    await r.tick();
    expect(r.pushed().map((n) => n.taskId)).toEqual(['a', 'a']);
    // the fresh task was skipped for the day-out nudge, but still gets its two-hour one
    r.h.clock.now = T0 + 3 * HOUR + MIN;
    await r.tick();
    expect(r.pushed().at(-1)).toMatchObject({ title: 'Almost due', taskId: 'fresh' });
  });
});

describe('daily briefing', () => {
  // dailyAt 07:30 in Asia/Bangkok
  const briefing = { notifyDaily: true, dailyAt: '07:30', tz: 'Asia/Bangkok' };

  test('goes out at the chosen local time, once per local day', async () => {
    const r = await rig();
    await r.save(
      {
        tasks: [
          makeTask({ id: 'q', title: 'Unit 3 Quiz', due: local(2026, 11, 11, 13, 0), estMin: 30 }),
          makeTask({ id: 's', title: 'Worksheet 7.2', due: local(2026, 11, 11, 23, 59), estMin: 40 }),
          makeTask({ id: 'o', title: 'Map worksheet', due: local(2026, 11, 9, 15, 0), estMin: 20 }),
          makeTask({ id: 'e', title: 'Essay: The Giver', due: local(2026, 11, 14, 23, 59) }),
        ],
      },
      briefing,
    );

    r.h.clock.now = local(2026, 11, 11, 7, 29);
    await r.tick();
    expect(r.pushed()).toEqual([]);

    r.h.clock.now = local(2026, 11, 11, 7, 30);
    await r.tick();
    expect(r.pushed()).toEqual([
      { title: "Today's plan", body: '2 due today and 1 overdue, about 1h 30m of work. Start with "Map worksheet". — Ember', tag: 'daily' },
    ]);

    for (const [hh, mm] of [[7, 31], [8, 45], [12, 0], [23, 59]]) {
      r.h.clock.now = local(2026, 11, 11, hh, mm);
      await r.tick();
    }
    expect(r.pushed()).toHaveLength(1);

    r.h.clock.now = local(2026, 11, 12, 7, 30);
    await r.tick();
    expect(r.pushed()).toHaveLength(2);
  });

  test('a missed minute is caught up within two hours, not later', async () => {
    const r = await rig();
    await r.save({}, briefing);
    r.h.clock.now = local(2026, 11, 11, 9, 29);
    await r.tick();
    expect(r.pushed()).toEqual([{ title: "Today's plan", body: 'Nothing on your list today. Enjoy it. — Ember', tag: 'daily' }]);

    r.h.clock.now = local(2026, 11, 12, 9, 31);
    await r.tick();
    expect(r.pushed()).toHaveLength(1);
  });

  test('the local day and time follow the zone in the settings', async () => {
    const r = await rig();
    await r.save({ tasks: [makeTask({ id: 'e', title: 'Essay: The Giver', due: Date.UTC(2026, 10, 14, 4, 0) })] }, { ...briefing, tz: 'America/New_York', dailyAt: '6:05' });
    // 06:04 and 06:05 in New York (UTC-5 in November)
    r.h.clock.now = Date.UTC(2026, 10, 11, 11, 4);
    await r.tick();
    expect(r.pushed()).toEqual([]);
    r.h.clock.now = Date.UTC(2026, 10, 11, 11, 5);
    await r.tick();
    expect(r.pushed()).toEqual([{ title: "Today's plan", body: 'Nothing due today. Next up: "Essay: The Giver" (due in 3 days). — Ember', tag: 'daily' }]);
  });

  test('switched off, or with a time that makes no sense, nothing is sent', async () => {
    const r = await rig();
    await r.save({}, { ...briefing, notifyDaily: false });
    r.h.clock.now = local(2026, 11, 11, 7, 30);
    await r.tick();
    const state = (await r.h.getState(r.token)) as SaveState;
    await r.h.putState(r.token, { ...state, settings: { ...state.settings, notifyDaily: true, dailyAt: '25:99' }, stamps: { ...state.stamps, settings: r.h.clock.now } });
    await r.tick();
    expect(r.pushed()).toEqual([]);
  });
});

describe('robustness', () => {
  test('accounts without a save, or with nothing to say, are passed over; one account does not affect another', async () => {
    const r = await rig();
    const other = await r.h.register('Someone else');
    const otherSub = makeSubscription('https://push.example.com/send/other');
    await r.h.api('POST', '/api/push/subscribe', { token: other.token, body: { subscription: otherSub.json } });
    await r.h.putState(other.token, makeState({ reminders: [{ id: 'x', at: T0, text: 'Theirs', createdAt: T0 }], settings: { ...makeState().settings, notifyDaily: false, notifyDueSoon: false } }));

    await r.tick(); // r's account has no save at all yet
    expect(r.pushed()).toEqual([]);
    expect(r.out.to('https://push.example.com/send/other').map((c) => otherSub.open(c.bytes))).toEqual([{ title: 'Reminder', body: 'Theirs — Ember', tag: 'reminder:x' }]);
  });

  test('a push service that is down does not stop the reminder from being recorded', async () => {
    const r = await rig();
    r.pushStatus['/send/main'] = 503;
    await r.save({ reminders: [{ id: 'r1', at: T0, text: 'Stretch', createdAt: T0 }] });
    await r.tick();
    expect(((await r.h.getState(r.token)) as SaveState).reminders[0].fired).toBe(true);
    expect(r.h.server.ctx.db.pushSubs(r.accountId)).toHaveLength(1);
  });
});

describe('background sync (AUTO_SYNC_MINUTES)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const feed = fs.readFileSync(path.join(here, 'fixtures', 'canvas.ics'), 'utf8');

  test('re-pulls connected sources on the configured interval, and not more often', async () => {
    const out = fakeFetch((call) => (call.url.hostname === 'canvas.example.edu' ? new Response(feed) : undefined));
    const h = await boot({ fetch: out.fetch, env: { AUTO_SYNC_MINUTES: '30' } });
    const a = await h.register();
    await h.putState(a.token, makeState({ settings: { ...makeState().settings, notifyDaily: false, notifyDueSoon: false } }));
    await h.api('POST', '/api/integrations/ics', { token: a.token, body: { url: 'https://canvas.example.edu/feeds/calendars/user_x.ics' } });
    const ws = await h.ws(a.token);
    const fetches = (): number => out.to('https://canvas.example.edu').length;
    expect(fetches()).toBe(1);

    h.clock.now = T0 + 10 * MIN;
    await h.server.tick();
    expect(fetches()).toBe(1);

    h.clock.now = T0 + 31 * MIN;
    await h.server.tick();
    await h.server.tick();
    expect(fetches()).toBe(2);
    // nothing changed in the feed, so nobody is told
    expect(await ws.quiet('state')).toBe(true);
  });

  test('is off by default', async () => {
    const out = fakeFetch((call) => (call.url.hostname === 'canvas.example.edu' ? new Response(feed) : undefined));
    const h = await boot({ fetch: out.fetch });
    const a = await h.register();
    await h.putState(a.token, makeState({ settings: { ...makeState().settings, notifyDaily: false, notifyDueSoon: false } }));
    await h.api('POST', '/api/integrations/ics', { token: a.token, body: { url: 'https://canvas.example.edu/feeds/calendars/user_x.ics' } });
    h.clock.now = T0 + 3 * DAY;
    await h.server.tick();
    expect(out.to('https://canvas.example.edu')).toHaveLength(1);
  });
});
