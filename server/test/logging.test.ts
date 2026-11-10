// What ends up in the server log: enough to operate it (usage, refusals, failures by kind),
// and never a credential, a feed link or anything a student or a model wrote.
import { afterEach, describe, expect, test } from 'vitest';
import { errorKind } from '../src/context.ts';
import { ProviderError } from '../src/integrations/oauth.ts';
import { SsrfError } from '../src/integrations/ssrf.ts';
import { boot, closeAll, cookiesFrom, fakeAnthropic, fakeFetch, json, makeState, makeSubscription, makeTask, T0 } from './helpers.ts';

afterEach(closeAll);

describe('errorKind', () => {
  test('names the class and the machine code, never the message', () => {
    const network = Object.assign(new Error('connect ECONNREFUSED https://canvas.example.edu/feeds/user_SECRET.ics'), { code: 'ECONNREFUSED' });
    expect(errorKind(network)).toBe('Error ECONNREFUSED');
    const wrapped = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND secret-host'), { code: 'ENOTFOUND' }) });
    expect(errorKind(wrapped)).toBe('TypeError ENOTFOUND');
    expect(errorKind(new Error('token=abc123'))).toBe('Error');
    expect(errorKind(new ProviderError('Google sign-in has expired'))).toBe('ProviderError');
    expect(errorKind(new SsrfError('nope'))).toBe('SsrfError blocked_url');
    expect(errorKind(Object.assign(new Error('x'), { code: 'https://evil.example/?token=1' }))).toBe('Error');
    expect(errorKind('a string')).toBe('unknown error');
  });
});

describe('model calls', () => {
  test('each call logs its token usage, including what the prompt cache did', async () => {
    const ai = fakeAnthropic([{ content: [{ type: 'text', text: 'Quiz first.' }], stop_reason: 'end_turn' }]);
    const h = await boot({ anthropic: ai.client });
    const a = await h.register();
    await h.putState(a.token, makeState({ tasks: [makeTask({ id: 'quiz1', title: 'Unit 3 Quiz', notes: 'PRIVATE-NOTE' })] }));
    await h.chat(a.token, 'PRIVATE-QUESTION what first?');
    expect(h.logs).toContain('chat: model=claude-opus-5-5 stop=end_turn in=100 cache_read=0 cache_write=0 out=42');
    expect(h.logs.join('\n')).not.toMatch(/PRIVATE|Quiz first|Unit 3/);
  });

  test('a reply served by a fallback model, and a refusal, are each visible as their own signal', async () => {
    const ai = fakeAnthropic([
      {
        model: 'claude-opus-5',
        content: [{ type: 'fallback', from: 'claude-opus-5-5', to: 'claude-opus-5', category: 'cyber' }, { type: 'text', text: 'Here you go.' }],
        stop_reason: 'end_turn',
        iterations: [{ type: 'message', model: 'claude-opus-5-5' }, { type: 'fallback_message', model: 'claude-opus-5' }],
      },
      { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio', explanation: 'declined' } },
    ]);
    const h = await boot({ anthropic: ai.client });
    const a = await h.register();
    await h.putState(a.token, makeState());
    expect((await h.chat(a.token, 'one')).at(-1)?.type).toBe('done');
    expect(h.logs.at(-1)).toBe('chat: model=claude-opus-5 stop=end_turn in=100 cache_read=0 cache_write=0 out=42 served_by_fallback=yes');
    expect((await h.chat(a.token, 'two')).at(-1)?.type).toBe('error');
    expect(h.logs).toContain('chat: declined (bio)');
  });
});

describe('no secrets in logs', () => {
  const SECRETS = {
    GOOGLE_CLIENT_SECRET: 'GOCSPX-SECRET-CLIENT',
    STRIPE_SECRET_KEY: 'sk_live_SECRETSTRIPE',
    STRIPE_WEBHOOK_SECRET: 'whsec_SECRETHOOK',
    SIDEKICK_SECRET: 'SECRET-AT-REST-KEY-0123456789abcdef',
  };
  const FEED = 'https://canvas.example.edu/feeds/calendars/user_SECRETFEEDTOKEN.ics';

  test('a run full of failures logs kinds and status codes only', async () => {
    const ai = fakeAnthropic([json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key sk-test-not-a-real-key' } }, 401)]);
    let feedMode: 'ok' | 'throw' = 'ok';
    const out = fakeFetch((call) => {
      if (call.url.href === 'https://oauth2.googleapis.com/token') {
        if (new URLSearchParams(call.body).get('grant_type') === 'authorization_code') {
          return json({ access_token: 'ya29.SECRETACCESS', refresh_token: '1//SECRETREFRESH', expires_in: 3600 });
        }
        return json({ error: 'server_error', error_description: 'refresh token 1//SECRETREFRESH could not be used' }, 500);
      }
      if (call.url.hostname === 'openidconnect.googleapis.com') return json({ sub: 'u1', email: 'mina@school.example' });
      if (call.url.hostname === 'classroom.googleapis.com') return json({ error: { message: 'backend exploded for token ya29.SECRETACCESS' } }, 500);
      if (call.url.hostname === 'canvas.example.edu') {
        if (feedMode === 'throw') throw Object.assign(new Error(`connect ECONNRESET ${FEED}`), { code: 'ECONNRESET' });
        return new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
      }
      if (call.url.hostname === 'push.example.com') throw new Error('socket hang up while posting to https://push.example.com/send/SECRETENDPOINT');
      if (call.url.hostname === 'api.stripe.com') return json({ error: { type: 'invalid_request_error', code: 'api_key_expired', message: 'Expired API Key provided: sk_live_SECRETSTRIPE' } }, 401);
      return undefined;
    });
    const h = await boot({
      anthropic: ai.client,
      fetch: out.fetch,
      env: { ...SECRETS, GOOGLE_CLIENT_ID: 'client-id', STRIPE_PRICE_ID: 'price_1', PUBLIC_URL: 'https://sidekick.example' },
    });
    const a = await h.register();
    await h.putState(a.token, makeState({ reminders: [{ id: 'r', at: T0, text: 'PRIVATE-REMINDER', createdAt: T0 }] }));

    // Google: connect, then every API call and the refresh fail
    const start = await h.api('GET', '/api/integrations/google/start', { token: a.token });
    const state = new URL(start.body.url as string).searchParams.get('state');
    await h.api('GET', `/api/integrations/google/callback?code=SECRETCODE&state=${state}`, { headers: { cookie: cookiesFrom(start.headers) } });
    // a feed that works when added and breaks later with the link in the error message
    expect((await h.api('POST', '/api/integrations/ics', { token: a.token, body: { url: FEED } })).status).toBe(200);
    feedMode = 'throw';
    const sync = await h.api('POST', '/api/integrations/sync', { token: a.token });
    expect(sync.body.errors).toHaveLength(2);
    h.clock.now += 2 * 3_600_000;
    await h.api('POST', '/api/integrations/sync', { token: a.token });
    // push to a service that blows up, chat with a rejected key, checkout with a rejected key
    await h.api('POST', '/api/push/subscribe', { token: a.token, body: { subscription: makeSubscription('https://push.example.com/send/SECRETENDPOINT').json } });
    await h.server.tick();
    await h.chat(a.token, 'PRIVATE-QUESTION');
    expect((await h.api('POST', '/api/billing/checkout', { token: a.token })).status).toBe(502);
    // a webhook with a bad signature
    await h.api('POST', '/api/billing/webhook', { raw: '{"type":"x"}', headers: { 'stripe-signature': 't=1,v1=abc' } });

    const log = h.logs.join('\n');
    expect(h.logs.length).toBeGreaterThanOrEqual(4);
    expect(log).not.toMatch(/SECRET|PRIVATE|sk-test|ya29|1\/\/|whsec|GOCSPX|canvas\.example|user_|Bearer|mina@/);
    expect(log).not.toContain(a.token);
    // what is there is still useful
    expect(log).toMatch(/sync: ics failed \(Error ECONNRESET\)/);
    expect(log).toMatch(/push: delivery failed \(Error\)/);
    expect(log).toMatch(/chat: credentials rejected \(401\)/);
    expect(log).toMatch(/billing: Stripe refused the checkout session \(401 api_key_expired\)/);

    // and what the client is told about those failures is equally clean
    const told = JSON.stringify(sync.body.errors);
    expect(told).not.toMatch(/SECRET|ya29|canvas\.example/);
  });
});
