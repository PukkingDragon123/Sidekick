import { afterEach, describe, expect, test } from 'vitest';
import { touch } from '../../shared/src/index.ts';
import { DAY, MIN, T0, boot, closeAll, makeState, makeTask } from './helpers.ts';

afterEach(closeAll);

describe('health', () => {
  test('reports optional capabilities as off when nothing is configured', async () => {
    const h = await boot();
    const res = await h.api('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: '0.1.0', ai: false, google: false, microsoft: false, push: true, billing: false });
  });

  test('a base URL without a key does not switch AI on', async () => {
    const h = await boot({ env: { ANTHROPIC_BASE_URL: 'https://gateway.example/api' }, anthropic: undefined });
    expect((await h.api('GET', '/api/health')).body.ai).toBe(false);
  });

  test('capabilities follow the environment', async () => {
    const h = await boot({
      anthropic: undefined,
      env: {
        ANTHROPIC_API_KEY: 'sk-test', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', MS_CLIENT_ID: 'm', MS_CLIENT_SECRET: 's',
        STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'price', STRIPE_WEBHOOK_SECRET: 'whsec',
      },
    });
    expect((await h.api('GET', '/api/health')).body).toMatchObject({ ai: true, google: true, microsoft: true, billing: true });
  });
});

describe('auth', () => {
  test('register creates an account with one device; the token works and is not stored', async () => {
    const h = await boot();
    const a = await h.register('Mina phone', 'mobile');
    expect(a.accountId).toMatch(/^acc_/);
    expect(a.deviceId).toMatch(/^dev_/);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect((await h.api('GET', '/api/state', { token: a.token })).status).toBe(200);

    const stored = h.server.ctx.db.raw.prepare('SELECT token_hash FROM devices').all() as { token_hash: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0].token_hash).not.toContain(a.token);
  });

  test('requests without a valid token are refused with the ApiError shape', async () => {
    const h = await boot();
    for (const token of [undefined, 'nope', 'x'.repeat(43)]) {
      const res = await h.api('GET', '/api/state', { token });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: expect.any(String), code: 'unauthorized' });
    }
  });

  test('a pair code is six characters, lasts ten minutes and joins a second device', async () => {
    const h = await boot();
    const a = await h.register();
    const code = await h.api('POST', '/api/auth/pair-code', { token: a.token });
    expect(code.status).toBe(200);
    expect(code.body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(code.body.expiresAt).toBe(T0 + 10 * MIN);

    // typed in lower case with a space: still accepted
    const typed = `${code.body.code.slice(0, 3).toLowerCase()} ${code.body.code.slice(3).toLowerCase()}`;
    const b = await h.api('POST', '/api/auth/link', { body: { code: typed, deviceName: 'Laptop', kind: 'desktop' } });
    expect(b.status).toBe(200);
    expect(b.body.accountId).toBe(a.accountId);
    expect(b.body.deviceId).not.toBe(a.deviceId);
    expect(b.body.token).not.toBe(a.token);
  });

  test('a pair code works once', async () => {
    const h = await boot();
    const a = await h.register();
    const { body } = await h.api('POST', '/api/auth/pair-code', { token: a.token });
    const link = () => h.api('POST', '/api/auth/link', { body: { code: body.code, deviceName: 'Tablet', kind: 'tablet' } });
    expect((await link()).status).toBe(200);
    const again = await link();
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('bad_code');
  });

  test('a pair code expires, and asking for a new one cancels the old one', async () => {
    const h = await boot();
    const a = await h.register();
    const first = (await h.api('POST', '/api/auth/pair-code', { token: a.token })).body.code as string;
    const second = (await h.api('POST', '/api/auth/pair-code', { token: a.token })).body.code as string;
    const link = (code: string) => h.api('POST', '/api/auth/link', { body: { code, deviceName: 'Tablet', kind: 'tablet' } });
    expect((await link(first)).status).toBe(400);

    h.clock.now += 10 * MIN + 1;
    expect((await link(second)).status).toBe(400);
    expect((await link('ZZZZZZ')).status).toBe(400);
  });

  test('bodies are validated', async () => {
    const h = await boot();
    const bad = await h.api('POST', '/api/auth/register', { body: { deviceName: '', kind: 'toaster' } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_body');
    expect(typeof bad.body.error).toBe('string');

    const notJson = await h.api('POST', '/api/auth/register', { raw: '{nope', headers: { 'content-type': 'application/json' } });
    expect(notJson.status).toBe(400);
    expect(notJson.body.code).toBe('invalid_json');
  });

  test('public auth routes are rate limited per IP, each on its own budget', async () => {
    const h = await boot({ config: { authRateMax: 3 } });
    for (let i = 0; i < 3; i++) await h.register();
    const blocked = await h.api('POST', '/api/auth/register', { body: { deviceName: 'One more', kind: 'web' } });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);

    // guessing codes is counted separately from signing up
    expect((await h.api('POST', '/api/auth/link', { body: { code: 'AAAAAA', deviceName: 'x', kind: 'web' } })).status).toBe(400);

    h.clock.now += 10 * MIN + 1;
    await h.register();
  });

  test('oversized bodies are rejected', async () => {
    const h = await boot();
    const res = await h.api('POST', '/api/auth/register', { body: { deviceName: 'x'.repeat(70_000), kind: 'web' } });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('too_large');
  });

  test('unknown API routes answer 404 as JSON', async () => {
    const h = await boot();
    const res = await h.api('GET', '/api/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

describe('CORS', () => {
  test('only listed origins are allowed', async () => {
    const h = await boot({ env: { CORS_ORIGINS: 'https://app.example, http://localhost:5173' } });
    const allowed = await h.api('GET', '/api/health', { headers: { origin: 'https://app.example' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const other = await h.api('GET', '/api/health', { headers: { origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();

    const preflight = await h.api('OPTIONS', '/api/state', {
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(preflight.headers.get('access-control-allow-headers')).toMatch(/authorization/i);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');
  });

  test('the dev default allows the Vite origin', async () => {
    const h = await boot();
    const res = await h.api('GET', '/api/health', { headers: { origin: 'http://localhost:5173' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});

describe('state sync', () => {
  test('nothing is stored until a device sends its save', async () => {
    const h = await boot();
    const a = await h.register();
    expect(await h.getState(a.token)).toBeNull();
  });

  test('round trip: one device saves, a linked device reads the same save', async () => {
    const h = await boot();
    const a = await h.register();
    const state = makeState({ tasks: [makeTask({ id: 't1', title: 'Read chapter 4' })] });
    const stored = await h.putState(a.token, state);
    expect(stored).toEqual(state);

    const b = await h.link(a.token);
    expect(await h.getState(b.token)).toEqual(state);
  });

  test('sections are last-write-wins by stamp; tasks merge per task', async () => {
    const h = await boot();
    const a = await h.register();
    const b = await h.link(a.token);

    const base = makeState({
      tasks: [makeTask({ id: 't1', title: 'Essay', updatedAt: T0 - 5000 }), makeTask({ id: 't2', title: 'Worksheet', updatedAt: T0 - 5000 })],
      stamps: { settings: T0 - 5000, owner: T0 - 5000 },
    });
    await h.putState(a.token, base);

    // Device B: newer settings, an older owner section, an edit to t1 and a brand-new task.
    const fromB = structuredClone(base);
    fromB.settings.dailyAt = '06:45';
    fromB.stamps.settings = T0 - 1000;
    fromB.owner.name = 'Stale name';
    fromB.stamps.owner = T0 - 9000;
    fromB.tasks[0] = { ...fromB.tasks[0], notes: 'thesis: rivers', updatedAt: T0 - 1000 };
    fromB.tasks.push(makeTask({ id: 't3', title: 'Lab report', updatedAt: T0 - 1000 }));
    // Device A, meanwhile and not yet seen by B: finished t2.
    const fromA = structuredClone(base);
    fromA.tasks[1] = { ...fromA.tasks[1], done: true, doneAt: T0 - 500, updatedAt: T0 - 500 };
    await h.putState(a.token, fromA);

    const merged = await h.putState(b.token, fromB);
    expect(merged.settings.dailyAt).toBe('06:45');
    expect(merged.stamps.settings).toBe(T0 - 1000);
    expect(merged.owner.name).toBe('Mina');
    expect(merged.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(merged.tasks.find((t) => t.id === 't1')?.notes).toBe('thesis: rivers');
    expect(merged.tasks.find((t) => t.id === 't2')?.done).toBe(true);
    expect(await h.getState(a.token)).toEqual(merged);
  });

  test('a deletion survives as a tombstone and old tombstones are dropped', async () => {
    const h = await boot();
    const a = await h.register();
    const base = makeState({ tasks: [makeTask({ id: 't1', title: 'Essay', updatedAt: T0 - 5000 })] });
    await h.putState(a.token, base);
    const deleted = structuredClone(base);
    deleted.tasks[0] = { ...deleted.tasks[0], deleted: true, updatedAt: T0 - 100 };
    expect((await h.putState(a.token, deleted)).tasks[0].deleted).toBe(true);
    // a device that still has the live copy cannot bring it back
    expect((await h.putState(a.token, base)).tasks[0].deleted).toBe(true);

    h.clock.now += 31 * DAY;
    expect((await h.putState(a.token, base)).tasks).toEqual([]);
  });

  test('premium is server-authoritative', async () => {
    const h = await boot();
    const a = await h.register();
    const cheeky = makeState({ premium: { plus: true, until: T0 + 365 * DAY } });
    expect((await h.putState(a.token, cheeky)).premium).toEqual({ plus: false });

    h.server.ctx.db.setPremium({ accountId: a.accountId, plus: true, until: T0 + 30 * DAY, stripeCustomer: null, stripeSubscription: null }, T0);
    expect((await h.getState(a.token))?.premium).toEqual({ plus: true, until: T0 + 30 * DAY });
    expect((await h.putState(a.token, makeState({ premium: { plus: false } }))).premium).toEqual({ plus: true, until: T0 + 30 * DAY });

    // lapsed (beyond the grace period): back to free
    h.clock.now = T0 + 34 * DAY;
    expect((await h.getState(a.token))?.premium).toEqual({ plus: false });
  });

  test('unknown extra fields survive, malformed saves are refused, chat is capped at 60', async () => {
    const h = await boot();
    const a = await h.register();

    const future = makeState() as ReturnType<typeof makeState> & { somethingNew: number };
    future.somethingNew = 7;
    (future.settings as unknown as Record<string, unknown>).haptics = true;
    const stored = (await h.putState(a.token, future)) as typeof future;
    expect(stored.somethingNew).toBe(7);
    expect((stored.settings as unknown as Record<string, unknown>).haptics).toBe(true);

    const broken = { ...makeState(), tasks: [{ id: 't', title: 'no timestamps' }] };
    const res = await h.api('PUT', '/api/state', { token: a.token, body: { state: broken } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_body');
    expect(res.body.error).toMatch(/tasks/);

    const chatty = makeState({
      chat: Array.from({ length: 75 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'sidekick' : 'user', text: `line ${i}`, at: T0 + i }) as const),
    });
    touch(chatty, 'chat');
    const capped = await h.putState(a.token, chatty);
    expect(capped.chat).toHaveLength(60);
    expect(capped.chat[0].id).toBe('m15');
    expect(capped.chat.at(-1)?.id).toBe('m74');
  });

  test('timestamps from a clock that runs ahead are pulled back', async () => {
    const h = await boot();
    const a = await h.register();
    const ahead = makeState({
      tasks: [makeTask({ id: 't1', title: 'From the future', updatedAt: T0 + 400 * DAY })],
      stamps: { settings: T0 + 400 * DAY },
    });
    const stored = await h.putState(a.token, ahead);
    expect(stored.stamps.settings).toBe(T0 + 5 * MIN);
    expect(stored.tasks[0].updatedAt).toBe(T0 + 5 * MIN);
  });
});
