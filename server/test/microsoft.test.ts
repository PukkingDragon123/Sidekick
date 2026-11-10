// Microsoft Teams for Education (Microsoft Graph) against recorded-shape fixtures.
// graph.microsoft.com is never contacted: an injected fetch answers for it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { mapAssignment, type EduAssignment } from '../src/integrations/microsoft.ts';
import type { OAuthTokens } from '../src/integrations/oauth.ts';
import { HOUR, T0, boot, closeAll, cookiesFrom, fakeFetch, json, makeState, type FakeFetch, type Harness, type OutboundCall } from './helpers.ts';

afterEach(closeAll);

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = <T = unknown>(name: string): T => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', name), 'utf8')) as T;

const ENV = { MS_CLIENT_ID: '5b1c7f0e-aaaa-bbbb-cccc-1234567890ab', MS_CLIENT_SECRET: 'ms~test~secret', PUBLIC_URL: 'https://sidekick.example' };
const ME = 'f4a9c7d2-6a1b-4c3e-8f5d-0b9e2a7c1d34';
const CHEM = '11014090-835f-4aa5-ac8f-a0ab6c9f1b10';
const HIST = '2c1b7f4e-0d6a-4f0e-9b52-7c9f6b9d2a41';
const GRAPH = 'https://graph.microsoft.com/v1.0';

const idToken = (claims: Record<string, unknown>): string =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

interface GraphSim {
  out: FakeFetch;
  valid: Set<string>;
  tokenRequests: { url: string; form: URLSearchParams }[];
  refreshToken: string;
  classesStatus: number;
}

function graphSim(): GraphSim {
  const sim: GraphSim = { out: undefined as unknown as FakeFetch, valid: new Set(['ms-access-1']), tokenRequests: [], refreshToken: 'ms-refresh-1', classesStatus: 200 };
  const token = (call: OutboundCall): Response | undefined => {
    if (call.url.hostname !== 'login.microsoftonline.com') return undefined;
    const form = new URLSearchParams(call.body);
    sim.tokenRequests.push({ url: call.url.href, form });
    if (form.get('grant_type') === 'authorization_code') {
      return json({
        token_type: 'Bearer', scope: 'EduAssignments.ReadBasic EduRoster.ReadBasic User.Read openid email', expires_in: 3600,
        access_token: 'ms-access-1', refresh_token: 'ms-refresh-1',
        id_token: idToken({ oid: ME, preferred_username: 'mina@school.example', name: 'Mina Suzuki', tid: 'tenant-1' }),
      });
    }
    if (form.get('refresh_token') !== sim.refreshToken) {
      return json({ error: 'invalid_grant', error_description: 'AADSTS70000: The refresh token has expired.' }, 400);
    }
    // like Microsoft: every refresh hands out a new refresh token and retires the old one
    const n = sim.tokenRequests.filter((r) => r.form.get('grant_type') === 'refresh_token').length + 1;
    sim.refreshToken = `ms-refresh-${n}`;
    sim.valid = new Set([`ms-access-${n}`]);
    return json({ token_type: 'Bearer', expires_in: 3600, access_token: `ms-access-${n}`, refresh_token: sim.refreshToken });
  };
  const graph = (call: OutboundCall): Response | undefined => {
    if (call.url.origin !== 'https://graph.microsoft.com') return undefined;
    const bearer = call.headers.get('authorization')?.replace('Bearer ', '') ?? '';
    if (!sim.valid.has(bearer)) return json({ error: { code: 'InvalidAuthenticationToken', message: 'Access token has expired.' } }, 401);
    const p = call.url.pathname;
    if (p === '/v1.0/education/me/classes') {
      return sim.classesStatus === 200 ? json(fixture('graph-classes.json')) : json({ error: { code: 'Forbidden', message: 'Missing scope' } }, sim.classesStatus);
    }
    if (p === '/v1.0/education/me/assignments') {
      return json(fixture(call.url.searchParams.get('$skiptoken') === 'page-two' ? 'graph-assignments-2.json' : 'graph-assignments-1.json'));
    }
    if (p === `/v1.0/education/classes/${HIST}/assignments/6b2e1d3f-8e4c-4f7a-9b0c-1d2e3f4a5b6c/submissions`) return json(fixture('graph-submissions-reflection.json'));
    return json({ error: { code: 'NotFound' } }, 404);
  };
  sim.out = fakeFetch(token, graph, (call) => (call.url.hostname === 'evil.example' ? new Response('gotcha') : undefined));
  return sim;
}

async function connect(h: Harness, token: string): Promise<URL> {
  const start = await h.api('GET', '/api/integrations/microsoft/start', { token });
  const authUrl = new URL(start.body.url as string);
  const callback = await h.api('GET', `/api/integrations/microsoft/callback?code=ms-code&state=${authUrl.searchParams.get('state')}`, {
    headers: { cookie: cookiesFrom(start.headers) },
  });
  expect(callback.headers.get('location')).toBe('https://sidekick.example/?integration=microsoft&status=ok');
  return authUrl;
}

describe('mapping', () => {
  const [lab] = fixture<{ value: EduAssignment[] }>('graph-assignments-1.json').value;

  test('an assignment becomes a task with the documented id, due time, link and points', () => {
    expect(mapAssignment(lab, 'Chemistry 10B', { status: 'working' })).toEqual({
      id: `microsoft:${CHEM}:9018ae7d-8a31-49ee-a0ea-5ada52cdbe5f`,
      source: 'microsoft',
      externalId: `${CHEM}:9018ae7d-8a31-49ee-a0ea-5ada52cdbe5f`,
      title: 'Titration lab report',
      course: 'Chemistry 10B',
      description: 'Write up the titration lab.\n- Data table\n- Error analysis & sources',
      due: Date.parse('2026-11-12T16:59:59.999Z'),
      url: lab.webUrl,
      points: 40,
      kind: 'essay',
      doneAtSource: false,
      sourceCreatedAt: Date.parse('2026-11-03T08:00:00Z'),
    });
  });

  test('submitted, returned and excused count as done; working and reassigned do not', () => {
    for (const status of ['submitted', 'returned', 'excused', 'released']) expect(mapAssignment(lab, undefined, { status })?.doneAtSource).toBe(true);
    for (const status of ['working', 'reassigned', 'unknownFutureValue']) expect(mapAssignment(lab, undefined, { status })?.doneAtSource).toBe(false);
    expect(mapAssignment(lab, undefined, undefined)?.doneAtSource).toBe(false);
    expect(mapAssignment(lab, undefined, undefined)).not.toHaveProperty('course');
    expect(mapAssignment({ ...lab, dueDateTime: undefined }, undefined, undefined)?.due).toBeNull();
    expect(mapAssignment({ ...lab, classId: undefined }, undefined, undefined)).toBeNull();
  });
});

describe('OAuth', () => {
  test('the consent URL targets the organizations authority with the education scopes and PKCE', async () => {
    const sim = graphSim();
    const h = await boot({ env: ENV, fetch: sim.out.fetch });
    const a = await h.register();
    const url = await connect(h, a.token);
    expect(`${url.origin}${url.pathname}`).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize');
    expect(url.searchParams.get('scope')).toBe('offline_access openid email User.Read EduAssignments.ReadBasic EduRoster.ReadBasic');
    expect(url.searchParams.get('redirect_uri')).toBe('https://sidekick.example/api/integrations/microsoft/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');

    const exchange = sim.tokenRequests[0];
    expect(exchange.url).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
    expect(exchange.form.get('code')).toBe('ms-code');
    expect(exchange.form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(exchange.form.get('client_secret')).toBe(ENV.MS_CLIENT_SECRET);

    expect((await h.api('GET', '/api/integrations', { token: a.token })).body.items).toEqual([
      { id: expect.stringMatching(/^int_/), provider: 'microsoft', label: 'mina@school.example' },
    ]);
    const row = h.server.ctx.db.integrations(a.accountId)[0];
    expect(row.secret).not.toContain('ms-refresh-1');
    expect(h.server.ctx.box.openJson<OAuthTokens>(row.secret)).toMatchObject({ accessToken: 'ms-access-1', refreshToken: 'ms-refresh-1', userId: ME });
  });

  test('a single-tenant app registration can be targeted with MS_TENANT', async () => {
    const sim = graphSim();
    const h = await boot({ env: { ...ENV, MS_TENANT: 'contoso.onmicrosoft.com' }, fetch: sim.out.fetch });
    const a = await h.register();
    const start = await h.api('GET', '/api/integrations/microsoft/start', { token: a.token });
    expect(start.body.url).toContain('https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize?');
  });
});

describe('sync', () => {
  async function ready(): Promise<{ h: Harness; sim: GraphSim; token: string; accountId: string }> {
    const sim = graphSim();
    const h = await boot({ env: ENV, fetch: sim.out.fetch });
    const a = await h.register();
    await h.putState(a.token, makeState());
    await connect(h, a.token);
    return { h, sim, token: a.token, accountId: a.accountId };
  }

  test('follows @odata.nextLink (on Graph only), reads class names and the student\'s own submission', async () => {
    const { h, sim, token } = await ready();
    const res = await h.api('POST', '/api/integrations/sync', { token });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.added).toBe(6);

    const tasks = Object.fromEntries((res.body.state.tasks as { id: string }[]).map((t) => [t.id.split(':')[2].slice(0, 8), t]));
    expect(Object.keys(tasks).sort()).toEqual(['3c77de7f', '5a1f0c2e', '6b2e1d3f', '8d4a3f5b', '9018ae7d', '9e5b4a6c']);
    expect(tasks['9018ae7d']).toMatchObject({
      id: `microsoft:${CHEM}:9018ae7d-8a31-49ee-a0ea-5ada52cdbe5f`, source: 'microsoft', title: 'Titration lab report', course: 'Chemistry 10B',
      due: Date.parse('2026-11-12T16:59:59.999Z'), points: 40, done: false,
      url: expect.stringContaining('https://teams.microsoft.com/l/entity/'),
    });
    expect(tasks['3c77de7f']).toMatchObject({ title: 'Reading log week 9', course: 'World History', done: true, description: 'Log 20 minutes of reading a day.' });
    expect(tasks['5a1f0c2e']).toMatchObject({ title: 'Group poster: trade routes', done: true });
    // its submissions did not come back expanded, so they were fetched; "reassigned" is not done
    expect(tasks['6b2e1d3f']).toMatchObject({ title: 'Reflection essay', done: false });
    expect(tasks['8d4a3f5b']).toMatchObject({ title: 'Safety quiz', done: true });
    // two submissions in the list: the one addressed to this student decides
    expect(tasks['9e5b4a6c']).toMatchObject({ title: 'Mole calculations worksheet', done: false });
    expect(tasks['9e5b4a6c']).not.toHaveProperty('due');

    const assignmentCalls = sim.out.to(`${GRAPH}/education/me/assignments`);
    expect(assignmentCalls).toHaveLength(2);
    expect(assignmentCalls[0].url.searchParams.get('$expand')).toBe('submissions');
    expect(assignmentCalls[1].url.searchParams.get('$skiptoken')).toBe('page-two');
    expect(assignmentCalls[0].headers.get('prefer')).toBe('include-unknown-enum-members');
    expect(sim.out.to(`${GRAPH}/education/classes/${HIST}/assignments/6b2e1d3f`)).toHaveLength(1);
    // the second page's nextLink pointed off Graph: it was not followed, and no token went there
    expect(sim.out.to('https://evil.example')).toHaveLength(0);
    expect(new Set(sim.out.to('https://graph.microsoft.com').map((c) => c.method))).toEqual(new Set(['GET']));
  });

  test('without roster access the assignments still import, just without class names', async () => {
    const { h, sim, token } = await ready();
    sim.classesStatus = 403;
    const res = await h.api('POST', '/api/integrations/sync', { token });
    expect(res.body.added).toBe(6);
    expect(res.body.errors).toEqual([]);
    expect((res.body.state.tasks as { course?: string }[]).every((t) => t.course === undefined)).toBe(true);

    // once names are available they are filled in, and nothing is duplicated
    sim.classesStatus = 200;
    const again = await h.api('POST', '/api/integrations/sync', { token });
    expect(again.body).toMatchObject({ added: 0, updated: 6 });
    expect((again.body.state.tasks as { course?: string }[]).map((t) => t.course).sort()).toEqual([
      'Chemistry 10B', 'Chemistry 10B', 'Chemistry 10B', 'World History', 'World History', 'World History',
    ]);
  });

  test('refresh rotates the refresh token, and the new one is what gets stored and used next', async () => {
    const { h, sim, token, accountId } = await ready();
    h.clock.now = T0 + 2 * HOUR;
    expect((await h.api('POST', '/api/integrations/sync', { token })).body.added).toBe(6);
    const refresh = sim.tokenRequests.at(-1);
    expect(refresh?.form.get('grant_type')).toBe('refresh_token');
    expect(refresh?.form.get('refresh_token')).toBe('ms-refresh-1');
    expect(refresh?.form.get('scope')).toContain('EduAssignments.ReadBasic');
    const stored = (): OAuthTokens => h.server.ctx.box.openJson<OAuthTokens>(h.server.ctx.db.integrations(accountId)[0].secret);
    expect(stored()).toMatchObject({ accessToken: 'ms-access-2', refreshToken: 'ms-refresh-2', userId: ME });

    h.clock.now = T0 + 4 * HOUR;
    expect((await h.api('POST', '/api/integrations/sync', { token })).body.errors).toEqual([]);
    expect(sim.tokenRequests.at(-1)?.form.get('refresh_token')).toBe('ms-refresh-2');
    expect(stored().refreshToken).toBe('ms-refresh-3');
    // one refresh per sync even though the sync makes several Graph calls in parallel
    expect(sim.tokenRequests.filter((r) => r.form.get('grant_type') === 'refresh_token')).toHaveLength(2);
  });

  test('an expired refresh token asks the student to connect again', async () => {
    const { h, sim, token } = await ready();
    sim.refreshToken = 'something-else';
    h.clock.now = T0 + 2 * HOUR;
    const res = await h.api('POST', '/api/integrations/sync', { token });
    expect(res.body.errors).toEqual([{ provider: 'microsoft', message: 'Microsoft Teams sign-in has expired. Connect it again.' }]);
    expect(res.body.added).toBe(0);
  });
});
