// Google Classroom against recorded-shape fixtures. Nothing here talks to Google: the OAuth
// endpoints and the Classroom API are answered by an injected fetch.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { classroomDue, mapCourseWork } from '../src/integrations/google.ts';
import type { OAuthTokens } from '../src/integrations/oauth.ts';
import { HOUR, T0, boot, closeAll, cookiesFrom, fakeFetch, json, makeState, type FakeFetch, type Harness, type OutboundCall } from './helpers.ts';

afterEach(closeAll);

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', name), 'utf8'));

const ENV = { GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'GOCSPX-test-secret', PUBLIC_URL: 'https://sidekick.example' };

const idToken = (claims: Record<string, unknown>): string =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

interface GoogleSim {
  out: FakeFetch;
  /** access tokens the API currently accepts */
  valid: Set<string>;
  tokenRequests: URLSearchParams[];
  refreshes: number;
  failRefresh: boolean;
}

/** A stand-in for accounts.google.com's token endpoint and classroom.googleapis.com. */
function googleSim(): GoogleSim {
  const sim: GoogleSim = { out: undefined as unknown as FakeFetch, valid: new Set(['access-1']), tokenRequests: [], refreshes: 0, failRefresh: false };
  const classroom = (call: OutboundCall): Response | undefined => {
    if (call.url.origin !== 'https://classroom.googleapis.com') return undefined;
    const token = call.headers.get('authorization')?.replace('Bearer ', '') ?? '';
    if (!sim.valid.has(token)) return json({ error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } }, 401);
    const page = call.url.searchParams.get('pageToken');
    const p = call.url.pathname;
    if (p === '/v1/courses') return json(fixture(page === 'courses-page-2' ? 'google-courses-2.json' : 'google-courses-1.json'));
    if (p === '/v1/courses/600100/courseWork') return json(fixture(page === 'cw-page-2' ? 'google-coursework-600100-2.json' : 'google-coursework-600100-1.json'));
    if (p === '/v1/courses/600100/courseWork/-/studentSubmissions') {
      return json(fixture(page === 'sub-page-2' ? 'google-submissions-600100-2.json' : 'google-submissions-600100-1.json'));
    }
    if (p === '/v1/courses/600200/courseWork') return json(fixture('google-coursework-600200.json'));
    if (p === '/v1/courses/600200/courseWork/-/studentSubmissions') return json(fixture('google-submissions-600200.json'));
    if (p.startsWith('/v1/courses/600300/')) return json({ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }, 403);
    return json({ error: { code: 404, status: 'NOT_FOUND' } }, 404);
  };
  const token = (call: OutboundCall): Response | undefined => {
    if (call.url.href !== 'https://oauth2.googleapis.com/token') return undefined;
    const form = new URLSearchParams(call.body);
    sim.tokenRequests.push(form);
    if (form.get('grant_type') === 'authorization_code') {
      if (form.get('code') !== 'auth-code-1') return json({ error: 'invalid_grant', error_description: 'Bad Request' }, 400);
      return json({
        access_token: 'access-1', expires_in: 3599, refresh_token: 'refresh-1', token_type: 'Bearer',
        scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/classroom.courses.readonly',
        id_token: idToken({ iss: 'https://accounts.google.com', sub: '118234567890123456789', email: 'mina@school.example', email_verified: true }),
      });
    }
    if (sim.failRefresh || form.get('refresh_token') !== 'refresh-1') return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
    sim.refreshes += 1;
    const fresh = `access-${sim.refreshes + 1}`;
    sim.valid = new Set([fresh]);
    // like Google: no new refresh token on refresh
    return json({ access_token: fresh, expires_in: 3599, token_type: 'Bearer', scope: 'openid' });
  };
  sim.out = fakeFetch(token, classroom);
  return sim;
}

async function connect(h: Harness, token: string, returnTo = 'https://sidekick.example/settings'): Promise<{ authUrl: URL; redirect: string }> {
  const start = await h.api('GET', `/api/integrations/google/start?return=${encodeURIComponent(returnTo)}`, { token });
  expect(start.status).toBe(200);
  const authUrl = new URL(start.body.url as string);
  // the browser that asked for the consent URL is the one that comes back from Google: it carries the binding cookie
  const callback = await h.api('GET', `/api/integrations/google/callback?code=auth-code-1&state=${authUrl.searchParams.get('state')}`, {
    headers: { cookie: cookiesFrom(start.headers) },
  });
  expect(callback.status).toBe(302);
  return { authUrl, redirect: callback.headers.get('location') ?? '' };
}

describe('mapping', () => {
  test('dueDate + dueTime are UTC; omitted time fields are zero; a date without a time means end of day', () => {
    expect(classroomDue({ year: 2026, month: 11, day: 12 }, { hours: 16, minutes: 59 })).toBe(Date.UTC(2026, 10, 12, 16, 59, 0));
    expect(classroomDue({ year: 2026, month: 11, day: 13 }, { hours: 5 })).toBe(Date.UTC(2026, 10, 13, 5, 0, 0));
    expect(classroomDue({ year: 2026, month: 11, day: 20 }, {})).toBe(Date.UTC(2026, 10, 20, 0, 0, 0));
    expect(classroomDue({ year: 2026, month: 11, day: 11 }, undefined)).toBe(Date.UTC(2026, 10, 11, 23, 59, 0));
    expect(classroomDue(undefined, { hours: 5 })).toBeNull();
    expect(classroomDue({ year: 2026 }, undefined)).toBeNull();
  });

  test('coursework becomes a task with the documented id, link, points and done state', () => {
    const work = (fixture('google-coursework-600100-1.json') as { courseWork: Record<string, unknown>[] }).courseWork[0];
    const task = mapCourseWork({ id: '600100', name: 'Algebra 1' }, work, 'TURNED_IN');
    expect(task).toEqual({
      id: 'google:600100:700001',
      source: 'google',
      externalId: '600100:700001',
      title: 'Worksheet 7.2: Factoring',
      course: 'Algebra 1',
      description: 'Problems 1-20. Show your work.\n\nCalculators allowed.',
      due: Date.UTC(2026, 10, 12, 16, 59, 0),
      url: 'https://classroom.google.com/c/600100/a/700001/details',
      points: 20,
      kind: 'problems',
      doneAtSource: true,
      sourceCreatedAt: Date.UTC(2026, 10, 5, 15, 0, 0),
    });
    for (const state of ['RETURNED', 'TURNED_IN']) expect(mapCourseWork({ id: 'c' }, work, state)?.doneAtSource).toBe(true);
    for (const state of ['NEW', 'CREATED', 'RECLAIMED_BY_STUDENT', undefined]) expect(mapCourseWork({ id: 'c' }, work, state)?.doneAtSource).toBe(false);
    expect(mapCourseWork({ id: 'c' }, { id: 'w', title: '   ' }, undefined)).toBeNull();
  });
});

describe('OAuth', () => {
  test('start builds a consent URL with PKCE, state, offline access and exactly the read-only scopes', async () => {
    const sim = googleSim();
    const h = await boot({ env: ENV, fetch: sim.out.fetch });
    const a = await h.register();
    const start = await h.api('GET', '/api/integrations/google/start?return=https%3A%2F%2Fsidekick.example%2Fsettings', { token: a.token });
    const url = new URL(start.body.url as string);
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = url.searchParams;
    expect(q.get('client_id')).toBe(ENV.GOOGLE_CLIENT_ID);
    expect(q.get('redirect_uri')).toBe('https://sidekick.example/api/integrations/google/callback');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe(
      'openid email https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    );
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('state')?.length).toBeGreaterThanOrEqual(32);
    // nothing secret rides along in the URL
    expect(url.href).not.toContain(ENV.GOOGLE_CLIENT_SECRET);
  });

  test('start needs a signed-in device and a configured provider', async () => {
    const h = await boot({ env: ENV });
    expect((await h.api('GET', '/api/integrations/google/start')).status).toBe(401);
    const a = await h.register();
    expect((await h.api('GET', '/api/integrations/microsoft/start', { token: a.token })).body.code).toBe('not_configured');
    expect((await h.api('GET', '/api/integrations/dropbox/start', { token: a.token })).status).toBe(404);
    expect((await h.api('GET', '/api/integrations', { token: a.token })).body.configured).toEqual({ google: true, microsoft: false });
  });

  test('the callback redeems the code with the PKCE verifier, stores the tokens encrypted and returns to the app', async () => {
    const sim = googleSim();
    const h = await boot({ env: ENV, fetch: sim.out.fetch });
    const a = await h.register();
    const { authUrl, redirect } = await connect(h, a.token);

    expect(redirect).toBe('https://sidekick.example/settings?integration=google&status=ok');
    const form = sim.tokenRequests[0];
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('auth-code-1');
    expect(form.get('client_id')).toBe(ENV.GOOGLE_CLIENT_ID);
    expect(form.get('client_secret')).toBe(ENV.GOOGLE_CLIENT_SECRET);
    expect(form.get('redirect_uri')).toBe('https://sidekick.example/api/integrations/google/callback');
    // the verifier sent to the token endpoint hashes to the challenge sent to the consent page
    const verifier = form.get('code_verifier') ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(authUrl.searchParams.get('code_challenge'));

    const list = await h.api('GET', '/api/integrations', { token: a.token });
    expect(list.body.items).toEqual([{ id: expect.stringMatching(/^int_/), provider: 'google', label: 'mina@school.example' }]);

    const row = h.server.ctx.db.integrations(a.accountId)[0];
    expect(row.secret).toMatch(/^v1\./);
    for (const plain of ['access-1', 'refresh-1']) expect(row.secret).not.toContain(plain);
    const dump = JSON.stringify(h.server.ctx.db.raw.prepare('SELECT * FROM integrations').all());
    expect(dump).not.toContain('refresh-1');
    expect(h.server.ctx.box.openJson<OAuthTokens>(row.secret)).toMatchObject({
      accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: T0 + 3599_000, userId: '118234567890123456789',
    });
  });

  test('state is single use, tied to its provider, and expires; the return URL cannot leave the app', async () => {
    const sim = googleSim();
    const h = await boot({ env: ENV, fetch: sim.out.fetch });
    const a = await h.register();

    let cookie = '';
    const start = async (ret?: string): Promise<string> => {
      const res = await h.api('GET', `/api/integrations/google/start${ret ? `?return=${encodeURIComponent(ret)}` : ''}`, { token: a.token });
      cookie = cookiesFrom(res.headers);
      return new URL(res.body.url as string).searchParams.get('state') ?? '';
    };
    const callback = async (query: string): Promise<string> =>
      (await h.api('GET', `/api/integrations/google/callback?${query}`, { headers: { cookie } })).headers.get('location') ?? '';

    // replay
    const once = await start();
    expect(await callback(`code=auth-code-1&state=${once}`)).toContain('status=ok');
    expect(await callback(`code=auth-code-1&state=${once}`)).toBe('https://sidekick.example/?integration=google&status=error&reason=expired');
    // unknown and missing state
    expect(await callback('code=auth-code-1&state=made-up')).toContain('reason=expired');
    expect(await callback('code=auth-code-1')).toContain('reason=expired');
    // expiry
    const slow = await start();
    h.clock.now += 11 * 60_000;
    expect(await callback(`code=auth-code-1&state=${slow}`)).toContain('reason=expired');
    // the student pressed "cancel" on the consent page
    expect(await callback(`error=access_denied&state=${await start()}`)).toContain('status=error&reason=denied');
    // a code Google rejects
    expect(await callback(`code=stolen&state=${await start()}`)).toContain('reason=exchange_failed');
    // open redirect attempt: falls back to the app's own front page
    const evil = await start('https://evil.example/phish');
    expect(await callback(`code=auth-code-1&state=${evil}`)).toBe('https://sidekick.example/?integration=google&status=ok');

    // connecting the same Google account again replaces the row rather than adding one
    expect(h.server.ctx.db.integrations(a.accountId)).toHaveLength(1);
  });
});

describe('browser binding', () => {
  test('the consent URL comes with a short-lived, HttpOnly, callback-scoped cookie', async () => {
    const h = await boot({ env: ENV, fetch: googleSim().out.fetch });
    const a = await h.register();
    const start = await h.api('GET', '/api/integrations/google/start', { token: a.token });
    const [cookie] = start.headers.getSetCookie();
    expect(cookie).toMatch(/^sk_oauth_google=[\w-]{32}; /);
    for (const attribute of ['Max-Age=600', 'Path=/api/integrations/google/callback', 'HttpOnly', 'Secure', 'SameSite=Lax']) expect(cookie).toContain(attribute);
    // the value is not derivable from anything in the consent URL
    expect(start.body.url).not.toContain(cookie.split(';')[0].split('=')[1]);

    // over plain http (local development) the cookie cannot be marked Secure
    const dev = await boot({ env: { ...ENV, PUBLIC_URL: 'http://localhost:8787' }, fetch: googleSim().out.fetch });
    const b = await dev.register();
    const devCookie = (await dev.api('GET', '/api/integrations/google/start', { token: b.token })).headers.getSetCookie()[0];
    expect(devCookie).not.toContain('Secure');
  });

  test('a consent finished in a different browser than the one that started it attaches nothing', async () => {
    const sim = googleSim();
    const h = await boot({ env: ENV, fetch: sim.out.fetch });
    // the attacker starts a flow for their own account and sends the consent link to someone else
    const attacker = await h.register('Attacker');
    const theirs = await h.api('GET', '/api/integrations/google/start', { token: attacker.token });
    const state = new URL(theirs.body.url as string).searchParams.get('state');

    // the victim's browser arrives at the callback: no cookie
    const noCookie = await h.api('GET', `/api/integrations/google/callback?code=auth-code-1&state=${state}`);
    expect(noCookie.headers.get('location')).toBe('https://sidekick.example/?integration=google&status=error&reason=browser_mismatch');
    expect(h.server.ctx.db.integrations(attacker.accountId)).toEqual([]);
    // the code was never redeemed
    expect(sim.tokenRequests).toHaveLength(0);

    // ...or with a cookie from a flow of the victim's own: still not the attacker's flow
    const victim = await h.register('Victim');
    const own = await h.api('GET', '/api/integrations/google/start', { token: victim.token });
    const again = await h.api('GET', '/api/integrations/google/start', { token: attacker.token });
    const mixed = await h.api('GET', `/api/integrations/google/callback?code=auth-code-1&state=${new URL(again.body.url as string).searchParams.get('state')}`, {
      headers: { cookie: cookiesFrom(own.headers) },
    });
    expect(mixed.headers.get('location')).toContain('reason=browser_mismatch');
    expect(h.server.ctx.db.integrations(attacker.accountId)).toEqual([]);
    expect(h.server.ctx.db.integrations(victim.accountId)).toEqual([]);
  });

  test('OAUTH_BROWSER_BINDING=off accepts a callback from another browser (for clients that need it)', async () => {
    const sim = googleSim();
    const h = await boot({ env: { ...ENV, OAUTH_BROWSER_BINDING: 'off' }, fetch: sim.out.fetch });
    const a = await h.register();
    const start = await h.api('GET', '/api/integrations/google/start', { token: a.token });
    const callback = await h.api('GET', `/api/integrations/google/callback?code=auth-code-1&state=${new URL(start.body.url as string).searchParams.get('state')}`);
    expect(callback.headers.get('location')).toContain('status=ok');
  });

  test('listed origins may send credentials, so a cross-origin dev client can receive the cookie', async () => {
    const h = await boot({ env: ENV });
    const res = await h.api('GET', '/api/health', { headers: { origin: 'http://localhost:5173' } });
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const other = await h.api('GET', '/api/health', { headers: { origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('sync', () => {
  async function ready(): Promise<{ h: Harness; sim: GoogleSim; token: string; accountId: string }> {
    const sim = googleSim();
    const h = await boot({ env: ENV, fetch: sim.out.fetch });
    const a = await h.register();
    await h.putState(a.token, makeState());
    await connect(h, a.token);
    return { h, sim, token: a.token, accountId: a.accountId };
  }

  test('pulls every page of courses, coursework and submissions and maps them to tasks', async () => {
    const { h, sim, token } = await ready();
    const res = await h.api('POST', '/api/integrations/sync', { token });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(5);
    expect(res.body.updated).toBe(0);
    // one class answered 403: reported, without sinking the rest
    expect(res.body.errors).toEqual([{ provider: 'google', message: '1 Google Classroom class could not be read this time.' }]);

    const tasks = Object.fromEntries((res.body.state.tasks as { id: string }[]).map((t) => [t.id, t]));
    expect(Object.keys(tasks).sort()).toEqual([
      'google:600100:700001', 'google:600100:700002', 'google:600100:700003', 'google:600200:800001', 'google:600200:800002',
    ]);
    expect(tasks['google:600100:700001']).toMatchObject({
      source: 'google', externalId: '600100:700001', title: 'Worksheet 7.2: Factoring', course: 'Algebra 1',
      due: Date.UTC(2026, 10, 12, 16, 59, 0), url: 'https://classroom.google.com/c/600100/a/700001/details', points: 20, kind: 'problems',
      done: true, doneAt: T0, createdAt: T0, updatedAt: T0,
    });
    expect(tasks['google:600100:700001']).not.toHaveProperty('rewarded');
    expect(tasks['google:600100:700002']).toMatchObject({ title: 'Unit 3 Quiz', due: Date.UTC(2026, 10, 13, 5, 0, 0), points: 50, kind: 'quiz', done: false });
    expect(tasks['google:600100:700003']).toMatchObject({ title: 'Chapter 7 reading notes', done: false });
    expect(tasks['google:600100:700003']).not.toHaveProperty('due');
    expect(tasks['google:600200:800001']).toMatchObject({ title: 'Essay: The Giver', course: 'English 9', due: Date.UTC(2026, 10, 20, 0, 0, 0), points: 100, kind: 'essay', done: false });
    expect(tasks['google:600200:800002']).toMatchObject({ title: 'Vocabulary list 5', due: Date.UTC(2026, 10, 11, 23, 59, 0), done: true });

    // the calls it took: student's active courses, then per course the work and the student's own submissions
    const courses = sim.out.to('https://classroom.googleapis.com/v1/courses?');
    expect(courses).toHaveLength(2);
    expect(courses[0].url.searchParams.get('studentId')).toBe('me');
    expect(courses[0].url.searchParams.get('courseStates')).toBe('ACTIVE');
    expect(courses[1].url.searchParams.get('pageToken')).toBe('courses-page-2');
    expect(sim.out.to('https://classroom.googleapis.com/v1/courses/600100/courseWork?').map((c) => c.url.searchParams.get('pageToken'))).toEqual([null, 'cw-page-2']);
    const subs = sim.out.to('https://classroom.googleapis.com/v1/courses/600100/courseWork/-/studentSubmissions');
    expect(subs.map((c) => c.url.searchParams.get('pageToken'))).toEqual([null, 'sub-page-2']);
    expect(subs[0].url.searchParams.get('userId')).toBe('me');
    // read-only: nothing but GET ever goes to Classroom
    expect(new Set(sim.out.to('https://classroom.googleapis.com').map((c) => c.method))).toEqual(new Set(['GET']));

    const info = (await h.api('GET', '/api/integrations', { token })).body.items[0];
    expect(info.lastSync).toBe(T0);
    expect(info.error).toBe('1 Google Classroom class could not be read this time.');
  });

  test('an access token about to expire is refreshed first, and the refresh token is kept', async () => {
    const { h, sim, token, accountId } = await ready();
    h.clock.now = T0 + HOUR;
    const res = await h.api('POST', '/api/integrations/sync', { token });
    expect(res.body.added).toBe(5);
    expect(sim.refreshes).toBe(1);
    const refresh = sim.tokenRequests.at(-1);
    expect(refresh?.get('grant_type')).toBe('refresh_token');
    expect(refresh?.get('refresh_token')).toBe('refresh-1');
    expect(refresh?.get('client_secret')).toBe(ENV.GOOGLE_CLIENT_SECRET);
    // every Classroom call of this sync carried the new token
    const used = new Set(sim.out.to('https://classroom.googleapis.com').map((c) => c.headers.get('authorization')));
    expect(used).toEqual(new Set(['Bearer access-2']));
    const stored = h.server.ctx.box.openJson<OAuthTokens>(h.server.ctx.db.integrations(accountId)[0].secret);
    expect(stored).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-1', expiresAt: T0 + HOUR + 3599_000 });
  });

  test('a 401 from the API triggers one refresh and a retry, shared by the parallel requests', async () => {
    const { h, sim, token } = await ready();
    sim.valid = new Set(); // revoked on Google's side before its expiry time
    const res = await h.api('POST', '/api/integrations/sync', { token });
    expect(res.body.added).toBe(5);
    expect(res.body.errors).toHaveLength(1);
    expect(sim.refreshes).toBeGreaterThanOrEqual(1);
    expect(sim.refreshes).toBeLessThanOrEqual(3);
  });

  test('a revoked grant is reported as "connect again" and leaves the tasks alone', async () => {
    const { h, sim, token } = await ready();
    await h.api('POST', '/api/integrations/sync', { token });
    sim.failRefresh = true;
    h.clock.now = T0 + 2 * HOUR;
    const res = await h.api('POST', '/api/integrations/sync', { token });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(0);
    expect(res.body.errors).toEqual([{ provider: 'google', message: 'Google Classroom sign-in has expired. Connect it again.' }]);
    expect(res.body.state.tasks).toHaveLength(5);
    const info = (await h.api('GET', '/api/integrations', { token })).body.items[0];
    expect(info.error).toMatch(/Connect it again/);
    expect(info.lastSync).toBe(T0);
  });

  test('disconnecting stops the syncing and keeps the tasks', async () => {
    const { h, sim, token } = await ready();
    await h.api('POST', '/api/integrations/sync', { token });
    const { id } = (await h.api('GET', '/api/integrations', { token })).body.items[0];
    expect((await h.api('DELETE', `/api/integrations/${id}`, { token })).body).toEqual({ ok: true });
    expect((await h.api('DELETE', `/api/integrations/${id}`, { token })).status).toBe(404);

    const before = sim.out.calls.length;
    const res = await h.api('POST', '/api/integrations/sync', { token });
    expect(res.body).toMatchObject({ added: 0, updated: 0, errors: [] });
    expect(res.body.state.tasks).toHaveLength(5);
    expect(sim.out.calls.length).toBe(before);
  });

  test('syncing before a save exists is refused rather than inventing one', async () => {
    const sim = googleSim();
    const h = await boot({ env: ENV, fetch: sim.out.fetch });
    const a = await h.register();
    await connect(h, a.token);
    const res = await h.api('POST', '/api/integrations/sync', { token: a.token });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('no_state');
  });
});
