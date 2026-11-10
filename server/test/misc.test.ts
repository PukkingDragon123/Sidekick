// Smaller pieces: configuration, encryption at rest, time zones, the static web client,
// body limits on streamed uploads, and persistence across a restart.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { SecretBox, loadSecret, normalizePairCode, pairCode, pkcePair, sha256Hex } from '../src/crypto.ts';
import { formatLocal, formatLocalIso, isValidTz, localDateKey, localParts, parseLocalDateTime, safeTz, zonedToUtc } from '../src/tz.ts';
import { T0, boot, closeAll, fakeFetch, makeState, makeTask } from './helpers.ts';

const temps: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-test-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await closeAll();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('configuration', () => {
  test('defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      port: 8787, publicUrl: 'http://localhost:8787', corsOrigins: ['http://localhost:5173'], trustProxy: false,
      google: null, microsoft: null, stripe: null, vapid: null, autoSyncMinutes: 0, secret: null,
    });
    expect(c.ai).toEqual({
      apiKey: null, authToken: null, model: 'claude-opus-5-5', chatEffort: 'low', planEffort: 'medium',
      freePerDay: 40, plusPerDay: 400, fallbacks: true, eagerToolInput: true,
    });
    expect(c.dbPath.endsWith(path.join('server', 'data', 'sidekick.db'))).toBe(true);
    expect(c.staticDir?.endsWith(path.join('web', 'dist'))).toBe(true);
  });

  test('everything can be set from the environment', () => {
    const c = loadConfig({
      PORT: '9000', PUBLIC_URL: 'https://sidekick.school.example/', CORS_ORIGINS: 'https://a.example, https://b.example/path',
      TRUST_PROXY: 'true', SIDEKICK_SECRET: 'x'.repeat(40), SIDEKICK_DATA_DIR: '/var/lib/sidekick',
      ANTHROPIC_AUTH_TOKEN: 'token', SIDEKICK_MODEL: 'claude-sonnet-5-5', SIDEKICK_CHAT_EFFORT: 'medium', SIDEKICK_PLAN_EFFORT: 'high',
      AI_FREE_PER_DAY: '10', AI_PLUS_PER_DAY: '99', MS_CLIENT_ID: 'id', MS_CLIENT_SECRET: 'secret', MS_TENANT: 'tenant-guid',
      VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:it@school.example', AUTO_SYNC_MINUTES: '45',
    });
    expect(c.port).toBe(9000);
    expect(c.publicUrl).toBe('https://sidekick.school.example');
    expect(c.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(c.trustProxy).toBe(true);
    expect(c.dbPath).toBe(path.join('/var/lib/sidekick', 'sidekick.db'));
    expect(c.ai).toMatchObject({ authToken: 'token', model: 'claude-sonnet-5-5', chatEffort: 'medium', planEffort: 'high', freePerDay: 10, plusPerDay: 99 });
    expect(c.microsoft).toEqual({ clientId: 'id', clientSecret: 'secret', tenant: 'tenant-guid' });
    expect(c.vapid).toEqual({ publicKey: 'pub', privateKey: 'priv' });
    expect(c.vapidSubject).toBe('mailto:it@school.example');
    expect(c.autoSyncMinutes).toBe(45);
  });

  test('half-configured providers stay off, and nonsense is rejected at start-up', () => {
    expect(loadConfig({ GOOGLE_CLIENT_ID: 'only-the-id' }).google).toBeNull();
    expect(loadConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'price' }).stripe).toBeNull();
    expect(() => loadConfig({ SIDEKICK_CHAT_EFFORT: 'extreme' })).toThrow(/SIDEKICK_CHAT_EFFORT/);
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ PUBLIC_URL: 'ftp://nope' })).toThrow(/PUBLIC_URL/);
    expect(() => loadConfig({ CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ SIDEKICK_FALLBACKS: 'maybe' })).toThrow(/SIDEKICK_FALLBACKS/);
    expect(() => loadConfig({ TRUST_PROXY: 'sometimes' })).toThrow(/TRUST_PROXY/);
  });
});

describe('encryption at rest', () => {
  test('AES-256-GCM round trip; every sealing is different; tampering and wrong keys are detected', () => {
    const box = new SecretBox('a secret from the environment');
    const sealed = box.seal('refresh-token-123');
    expect(sealed).toMatch(/^v1\.[\w-]{16}\.[\w-]{22}\.[\w-]+$/);
    expect(sealed).not.toContain('refresh-token-123');
    expect(box.open(sealed)).toBe('refresh-token-123');
    expect(box.seal('refresh-token-123')).not.toBe(sealed);
    expect(box.openJson<{ a: number }>(box.sealJson({ a: 1 }))).toEqual({ a: 1 });

    const parts = sealed.split('.');
    const flipped = [...parts.slice(0, 3), `${parts[3].slice(0, -2)}${parts[3].endsWith('AA') ? 'BB' : 'AA'}`].join('.');
    expect(() => box.open(flipped)).toThrow();
    expect(() => new SecretBox('another secret').open(sealed)).toThrow();
    expect(() => box.open('v2.x.y.z')).toThrow();
    expect(() => box.open('garbage')).toThrow();
  });

  test('without SIDEKICK_SECRET a key file is generated once and reused', () => {
    const dir = tempDir();
    const first = loadSecret({ secret: null, dataDir: dir, ephemeral: false });
    const file = path.join(dir, 'secret.key');
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(first);
    expect(String(first).length).toBeGreaterThanOrEqual(43);
    expect(fs.statSync(file).mode & 0o077).toBe(0);
    expect(loadSecret({ secret: null, dataDir: dir, ephemeral: false })).toBe(first);
    // the environment wins, and an in-memory database never writes a file
    expect(loadSecret({ secret: 'from-env', dataDir: dir, ephemeral: false })).toBe('from-env');
    const other = tempDir();
    loadSecret({ secret: null, dataDir: other, ephemeral: true });
    expect(fs.existsSync(path.join(other, 'secret.key'))).toBe(false);
  });

  test('pair codes, PKCE and hashes', () => {
    for (let i = 0; i < 200; i++) expect(pairCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(normalizePairCode(' ab-c 23x ')).toBe('ABC23X');
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[\w-]{64}$/);
    expect(challenge).toMatch(/^[\w-]{43}$/);
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('time zones', () => {
  test('wall clock <-> instant, across daylight saving', () => {
    expect(zonedToUtc(2026, 11, 10, 16, 0, 0, 'Asia/Bangkok')).toBe(T0);
    expect(zonedToUtc(2026, 7, 1, 9, 0, 0, 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 13, 0, 0));
    expect(zonedToUtc(2026, 12, 1, 9, 0, 0, 'America/New_York')).toBe(Date.UTC(2026, 11, 1, 14, 0, 0));
    // the night the clocks go back in Berlin (25 Oct 2026): 01:30 is still summer time, 03:30 is winter time
    expect(zonedToUtc(2026, 10, 25, 1, 30, 0, 'Europe/Berlin')).toBe(Date.UTC(2026, 9, 24, 23, 30, 0));
    expect(zonedToUtc(2026, 10, 25, 3, 30, 0, 'Europe/Berlin')).toBe(Date.UTC(2026, 9, 25, 2, 30, 0));
    // half-hour zones
    expect(zonedToUtc(2026, 11, 10, 12, 0, 0, 'Asia/Kolkata')).toBe(Date.UTC(2026, 10, 10, 6, 30, 0));
    expect(localParts(T0, 'Asia/Bangkok')).toEqual({ year: 2026, month: 11, day: 10, hour: 16, minute: 0, second: 0, weekday: 'Tue' });
    expect(localParts(Date.UTC(2026, 10, 10, 17, 0, 0), 'Asia/Bangkok')).toMatchObject({ day: 11, hour: 0 });
    expect(formatLocal(T0, 'Asia/Bangkok')).toBe('Tue 10 Nov 2026, 16:00');
    expect(formatLocalIso(T0, 'America/Los_Angeles')).toBe('2026-11-10T01:00');
    expect(localDateKey(T0, 'Pacific/Auckland')).toBe('2026-11-10');
    expect(localDateKey(T0 + 3 * 3_600_000, 'Pacific/Auckland')).toBe('2026-11-11');
  });

  test('what people and models write for a time', () => {
    const tz = 'Asia/Bangkok';
    const eod = { hour: 23, minute: 59 };
    expect(parseLocalDateTime('2026-11-12T16:30', tz, eod)).toBe(Date.UTC(2026, 10, 12, 9, 30));
    expect(parseLocalDateTime('2026-11-12 16:30:15', tz, eod)).toBe(Date.UTC(2026, 10, 12, 9, 30, 15));
    expect(parseLocalDateTime(' 2026-11-12T7:05 ', tz, eod)).toBe(Date.UTC(2026, 10, 12, 0, 5));
    expect(parseLocalDateTime('2026-11-12', tz, eod)).toBe(Date.UTC(2026, 10, 12, 16, 59));
    // explicit offsets are honoured
    expect(parseLocalDateTime('2026-11-12T16:30Z', tz, eod)).toBe(Date.UTC(2026, 10, 12, 16, 30));
    expect(parseLocalDateTime('2026-11-12T16:30:00+02:00', tz, eod)).toBe(Date.UTC(2026, 10, 12, 14, 30));
    expect(parseLocalDateTime('2026-11-12T16:30-0500', tz, eod)).toBe(Date.UTC(2026, 10, 12, 21, 30));
    for (const bad of ['tomorrow', '2026-13-01', '2026-02-30', '2026-11-12T25:00', '12/11/2026', '']) expect(parseLocalDateTime(bad, tz, eod)).toBeNull();
  });

  test('zone names are checked before use', () => {
    expect(isValidTz('Europe/Berlin')).toBe(true);
    for (const bad of ['Mars/Phobos', '', 7, null, 'x'.repeat(100)]) expect(isValidTz(bad)).toBe(false);
    expect(safeTz('Nope/Nope')).toBe('UTC');
    expect(safeTz('Nope/Nope', 'Asia/Tokyo')).toBe('Asia/Tokyo');
  });
});

describe('the web client', () => {
  function build(): string {
    const dist = tempDir();
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Sidekick</title><div id="app"></div>');
    fs.writeFileSync(path.join(dist, 'assets', 'app-3f9a1c2b.js'), 'console.log("sidekick")');
    fs.writeFileSync(path.join(dist, 'sw.js'), '// service worker');
    fs.writeFileSync(path.join(dist, 'manifest.webmanifest'), '{"name":"Sidekick"}');
    return dist;
  }

  test('files are served with sensible types and caching; app routes fall back to index.html', async () => {
    const h = await boot({ config: { staticDir: build() } });
    const get = async (p: string, method = 'GET') => {
      const res = await fetch(h.url + p, { method });
      return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), text: await res.text() };
    };

    expect(await get('/')).toMatchObject({ status: 200, type: 'text/html; charset=utf-8', cache: 'no-cache' });
    expect((await get('/')).text).toContain('<div id="app">');
    expect(await get('/assets/app-3f9a1c2b.js')).toMatchObject({ status: 200, type: 'text/javascript; charset=utf-8', cache: 'public, max-age=31536000, immutable' });
    expect(await get('/sw.js')).toMatchObject({ status: 200, cache: 'no-cache' });
    expect((await get('/manifest.webmanifest')).type).toBe('application/manifest+json; charset=utf-8');
    // client-side routes
    for (const route of ['/forest', '/tasks/abc', '/settings?integration=google&status=ok']) expect((await get(route)).text).toContain('<div id="app">');
    // a missing file is a 404, not the app shell; the API is never shadowed
    expect((await get('/assets/missing.js')).status).toBe(404);
    expect((await get('/api/health')).type).toContain('application/json');
    expect((await get('/api/nope')).status).toBe(404);
    expect((await get('/', 'HEAD')).text).toBe('');
    expect((await get('/', 'POST')).status).toBe(404);
  });

  test('paths cannot climb out of the build directory', async () => {
    const dist = build();
    fs.writeFileSync(path.join(path.dirname(dist), 'outside-secret.txt'), 'do not serve');
    temps.push(path.join(path.dirname(dist), 'outside-secret.txt'));
    const h = await boot({ config: { staticDir: dist } });
    for (const sneaky of ['/..%2Foutside-secret.txt', '/%2e%2e/outside-secret.txt', '/assets/..%2F..%2Foutside-secret.txt', '/assets/%2e%2e/%2e%2e/outside-secret.txt']) {
      const res = await fetch(h.url + sneaky);
      expect(await res.text()).not.toContain('do not serve');
      expect(res.status).toBe(404);
    }
    // an extension-less path is an app route whatever it spells: it gets the shell, never a file from outside
    const shell = await fetch(`${h.url}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    const text = await shell.text();
    expect(text).toContain('<div id="app">');
    expect(text).not.toContain('root:');
  });

  test('without a build the server is API-only', async () => {
    const h = await boot({ config: { staticDir: path.join(tempDir(), 'no-dist-here') } });
    const res = await h.api('GET', '/');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

describe('body limits', () => {
  test('a streamed upload with no declared length is cut off at the limit', async () => {
    const h = await boot();
    const a = await h.register();
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 40) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const res = await fetch(`${h.url}/api/integrations/ics`, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'That request is too large', code: 'too_large' });
  });

  test('the save may be large, but not unbounded', async () => {
    const h = await boot();
    const a = await h.register();
    const roomy = makeState({ tasks: Array.from({ length: 400 }, (_, i) => makeTask({ id: `t${i}`, title: `Task ${i}`, notes: 'n'.repeat(1500) })) });
    expect((await h.putState(a.token, roomy)).tasks).toHaveLength(400);
    const huge = makeState({ tasks: Array.from({ length: 400 }, (_, i) => makeTask({ id: `t${i}`, title: `Task ${i}`, notes: 'n'.repeat(7000) })) });
    expect((await h.api('PUT', '/api/state', { token: a.token, body: { state: huge } })).status).toBe(413);
  });
});

describe('persistence', () => {
  test('a file database survives a restart: sign-in, save, push key and encrypted feed link', async () => {
    const dir = tempDir();
    const feed = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:Quiz\r\nDTSTART:20261112T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const out = fakeFetch((call) => (call.url.hostname === 'school.example.com' ? new Response(feed) : undefined));
    const config = { dbPath: path.join(dir, 'sidekick.db'), dataDir: dir };

    const first = await boot({ config, fetch: out.fetch });
    const a = await first.register();
    await first.putState(a.token, makeState());
    await first.api('POST', '/api/integrations/ics', { token: a.token, body: { url: 'https://school.example.com/cal.ics', label: 'School' } });
    const key = (await first.api('GET', '/api/push/key', { token: a.token })).body.publicKey as string;
    await first.close();
    expect(fs.existsSync(path.join(dir, 'secret.key'))).toBe(true);

    const second = await boot({ config, fetch: out.fetch });
    expect(((await second.getState(a.token)) as { tasks: unknown[] }).tasks).toHaveLength(1);
    expect((await second.api('GET', '/api/push/key', { token: a.token })).body.publicKey).toBe(key);
    // the stored feed link can still be decrypted with the key file from the first run
    const sync = await second.api('POST', '/api/integrations/sync', { token: a.token });
    expect(sync.body).toMatchObject({ added: 0, updated: 0, errors: [] });
    expect(out.to('https://school.example.com')).toHaveLength(2);
  });
});
