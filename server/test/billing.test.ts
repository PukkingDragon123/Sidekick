// Sidekick Plus: Stripe Checkout through the REST API and the signed webhook. Stripe itself
// is an injected fetch; the signature scheme is the documented one (t=<unix>,v1=HMAC-SHA256
// of "<t>.<raw body>" under the endpoint's signing secret).
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import type { SaveState } from '../../shared/src/index.ts';
import { verifyStripeSignature } from '../src/billing.ts';
import { DAY, T0, boot, closeAll, fakeFetch, json, makeState, type Harness } from './helpers.ts';

afterEach(closeAll);

const ENV = { STRIPE_SECRET_KEY: 'sk_test_51abc', STRIPE_PRICE_ID: 'price_1Plus', STRIPE_WEBHOOK_SECRET: 'whsec_test_secret', PUBLIC_URL: 'https://sidekick.example' };

const sign = (body: string, secret = ENV.STRIPE_WEBHOOK_SECRET, at = T0): string => {
  const t = Math.floor(at / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
};

async function webhook(h: Harness, event: unknown, header?: string): Promise<{ status: number; body: any }> {
  const raw = JSON.stringify(event);
  return h.api('POST', '/api/billing/webhook', { raw, headers: { 'content-type': 'application/json', 'stripe-signature': header ?? sign(raw) } });
}

const stripe = () =>
  fakeFetch((call) =>
    call.url.href === 'https://api.stripe.com/v1/checkout/sessions'
      ? json({ id: 'cs_test_a1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_test_a1', mode: 'subscription' })
      : undefined,
  );

describe('signature check', () => {
  const body = '{"id":"evt_1","type":"checkout.session.completed"}';

  test('accepts a correct, recent signature', () => {
    expect(verifyStripeSignature(body, sign(body), ENV.STRIPE_WEBHOOK_SECRET, T0)).toBe(true);
    // extra schemes and a second v1 (secret being rolled) are fine
    const other = sign(body, 'whsec_old_secret').split(',')[1];
    expect(verifyStripeSignature(body, `${sign(body)},v0=deadbeef,${other}`, ENV.STRIPE_WEBHOOK_SECRET, T0)).toBe(true);
    expect(verifyStripeSignature(body, ` ${sign(body).replace(',', ' , ')} `, ENV.STRIPE_WEBHOOK_SECRET, T0)).toBe(true);
  });

  test('rejects a wrong secret, a changed body, a stale or future timestamp, and malformed headers', () => {
    expect(verifyStripeSignature(body, sign(body, 'whsec_other'), ENV.STRIPE_WEBHOOK_SECRET, T0)).toBe(false);
    expect(verifyStripeSignature(`${body} `, sign(body), ENV.STRIPE_WEBHOOK_SECRET, T0)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, ENV.STRIPE_WEBHOOK_SECRET, T0 - 6 * 60_000), ENV.STRIPE_WEBHOOK_SECRET, T0)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, ENV.STRIPE_WEBHOOK_SECRET, T0 + 6 * 60_000), ENV.STRIPE_WEBHOOK_SECRET, T0)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, ENV.STRIPE_WEBHOOK_SECRET, T0 - 4 * 60_000), ENV.STRIPE_WEBHOOK_SECRET, T0)).toBe(true);
    // re-using a valid signature with a different timestamp does not work: t is part of what is signed
    const [, v1] = sign(body).split(',');
    expect(verifyStripeSignature(body, `t=${Math.floor(T0 / 1000) + 1},${v1}`, ENV.STRIPE_WEBHOOK_SECRET, T0)).toBe(false);
    for (const header of [undefined, '', 'v1=abc', 't=123', 't=abc,v1=abc', 'garbage', `t=${Math.floor(T0 / 1000)},v0=abc`]) {
      expect(verifyStripeSignature(body, header, ENV.STRIPE_WEBHOOK_SECRET, T0)).toBe(false);
    }
  });
});

describe('when billing is not configured', () => {
  test('health says so and both routes answer 503', async () => {
    const h = await boot({ env: { STRIPE_SECRET_KEY: 'sk_test_only_one_of_three' } });
    const a = await h.register();
    expect((await h.api('GET', '/api/health')).body.billing).toBe(false);
    const checkout = await h.api('POST', '/api/billing/checkout', { token: a.token });
    expect(checkout.status).toBe(503);
    expect(checkout.body.code).toBe('no_billing');
    expect((await h.api('POST', '/api/billing/webhook', { raw: '{}' })).status).toBe(503);
  });
});

describe('checkout', () => {
  test('creates a subscription Checkout Session over the REST API and returns its URL', async () => {
    const out = stripe();
    const h = await boot({ env: ENV, fetch: out.fetch });
    const a = await h.register();
    expect((await h.api('GET', '/api/health')).body.billing).toBe(true);
    expect((await h.api('POST', '/api/billing/checkout')).status).toBe(401);

    const res = await h.api('POST', '/api/billing/checkout', { token: a.token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_a1' });

    const [call] = out.calls;
    expect(call.method).toBe('POST');
    expect(call.headers.get('authorization')).toBe('Bearer sk_test_51abc');
    expect(call.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(call.body);
    expect(Object.fromEntries(form)).toEqual({
      mode: 'subscription',
      'line_items[0][price]': 'price_1Plus',
      'line_items[0][quantity]': '1',
      success_url: 'https://sidekick.example/?plus=success',
      cancel_url: 'https://sidekick.example/?plus=cancelled',
      client_reference_id: a.accountId,
      'metadata[account_id]': a.accountId,
      'subscription_data[metadata][account_id]': a.accountId,
    });
  });

  test('the return URL may point into the app, and nowhere else', async () => {
    const out = stripe();
    const h = await boot({ env: { ...ENV, CORS_ORIGINS: 'https://app.sidekick.example' }, fetch: out.fetch });
    const a = await h.register();
    await h.api('POST', '/api/billing/checkout', { token: a.token, body: { return: 'https://app.sidekick.example/shop?tab=plus' } });
    await h.api('POST', '/api/billing/checkout', { token: a.token, body: { return: 'https://evil.example/thanks' } });
    await h.api('POST', '/api/billing/checkout', { token: a.token, body: {} });
    const successUrls = out.calls.map((c) => new URLSearchParams(c.body).get('success_url'));
    expect(successUrls).toEqual([
      'https://app.sidekick.example/shop?tab=plus&plus=success',
      'https://sidekick.example/?plus=success',
      'https://sidekick.example/?plus=success',
    ]);
  });

  test('a Stripe failure is a 502 that says nothing about keys', async () => {
    const out = fakeFetch(() => json({ error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such price: price_1Plus; key sk_test_51abc' } }, 400));
    const h = await boot({ env: ENV, fetch: out.fetch });
    const a = await h.register();
    const res = await h.api('POST', '/api/billing/checkout', { token: a.token });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('billing_failed');
    expect(JSON.stringify(res.body)).not.toMatch(/sk_test|price_/);
  });
});

describe('webhook', () => {
  async function account(): Promise<{ h: Harness; token: string; accountId: string }> {
    const h = await boot({ env: ENV, fetch: stripe().fetch });
    const a = await h.register();
    await h.putState(a.token, makeState());
    return { h, token: a.token, accountId: a.accountId };
  }
  const premiumOf = async (h: Harness, token: string) => ((await h.getState(token)) as SaveState).premium;

  const completed = (accountId: string) => ({
    id: 'evt_1', object: 'event', type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_a1', object: 'checkout.session', mode: 'subscription', client_reference_id: accountId, customer: 'cus_Mina1', subscription: 'sub_Plus1', payment_status: 'paid', metadata: { account_id: accountId } } },
  });
  const subscription = (type: string, over: Record<string, unknown> = {}) => ({
    id: 'evt_2', object: 'event', type,
    data: { object: { id: 'sub_Plus1', object: 'subscription', customer: 'cus_Mina1', status: 'active', current_period_end: Math.floor((T0 + 30 * DAY) / 1000), metadata: {}, ...over } },
  });

  test('an unsigned or wrongly signed event is rejected and changes nothing', async () => {
    const { h, token, accountId } = await account();
    const event = completed(accountId);
    const raw = JSON.stringify(event);
    for (const header of ['', 'nonsense', sign(raw, 'whsec_someone_else'), sign(`${raw}x`), sign(raw, ENV.STRIPE_WEBHOOK_SECRET, T0 - 10 * 60_000)]) {
      const res = await webhook(h, event, header);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('bad_signature');
    }
    expect(await premiumOf(h, token)).toEqual({ plus: false });
  });

  test('checkout.session.completed turns Plus on, and every device hears about it', async () => {
    const { h, token, accountId } = await account();
    const ws = await h.ws(token);
    const res = await webhook(h, completed(accountId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(await premiumOf(h, token)).toEqual({ plus: true });
    expect((await ws.take('state')).state.premium).toEqual({ plus: true });
    expect(h.server.ctx.db.premium(accountId)).toMatchObject({ plus: true, stripeCustomer: 'cus_Mina1', stripeSubscription: 'sub_Plus1' });
  });

  test('subscription updates carry the period end; cancelling or lapsing turns Plus off', async () => {
    const { h, token, accountId } = await account();
    await webhook(h, completed(accountId));

    // found through the customer id even without metadata
    await webhook(h, subscription('customer.subscription.updated'));
    expect(await premiumOf(h, token)).toEqual({ plus: true, until: T0 + 30 * DAY });

    await webhook(h, subscription('customer.subscription.updated', { status: 'past_due' }));
    expect(await premiumOf(h, token)).toEqual({ plus: false });
    await webhook(h, subscription('customer.subscription.updated', { status: 'trialing' }));
    expect((await premiumOf(h, token)).plus).toBe(true);

    await webhook(h, subscription('customer.subscription.deleted', { status: 'canceled' }));
    expect(await premiumOf(h, token)).toEqual({ plus: false });
  });

  test('newer API versions put the period end on the subscription item; metadata alone identifies the account', async () => {
    const { h, token, accountId } = await account();
    const event = subscription('customer.subscription.created', {
      customer: { id: 'cus_Object', object: 'customer' },
      current_period_end: undefined,
      items: { object: 'list', data: [{ id: 'si_1', current_period_end: Math.floor((T0 + 7 * DAY) / 1000) }] },
      metadata: { account_id: accountId },
    });
    expect((await webhook(h, event)).status).toBe(200);
    expect(await premiumOf(h, token)).toEqual({ plus: true, until: T0 + 7 * DAY });
    expect(h.server.ctx.db.premium(accountId)?.stripeCustomer).toBe('cus_Object');
  });

  test('an old subscription winding down does not switch off a newer one', async () => {
    const { h, token, accountId } = await account();
    await webhook(h, completed(accountId));
    await webhook(h, subscription('customer.subscription.updated'));
    await webhook(h, subscription('customer.subscription.deleted', { id: 'sub_Old0', status: 'canceled' }));
    expect((await premiumOf(h, token)).plus).toBe(true);
  });

  test('events about nobody we know, or of other types, are acknowledged and ignored', async () => {
    const { h, token } = await account();
    for (const event of [
      completed('acc_does_not_exist'),
      subscription('customer.subscription.updated', { customer: 'cus_stranger' }),
      { id: 'evt_9', type: 'invoice.paid', data: { object: { id: 'in_1' } } },
      { ...completed('x'), data: { object: { mode: 'payment', client_reference_id: 'x' } } },
    ]) {
      expect((await webhook(h, event)).status).toBe(200);
    }
    expect(await premiumOf(h, token)).toEqual({ plus: false });
    const garbage = '{"type": 5}';
    expect((await h.api('POST', '/api/billing/webhook', { raw: garbage, headers: { 'stripe-signature': sign(garbage) } })).status).toBe(400);
  });

  test('a returning customer is recognised at the next checkout', async () => {
    const out = stripe();
    const h = await boot({ env: ENV, fetch: out.fetch });
    const a = await h.register();
    await webhook(h, completed(a.accountId));
    await h.api('POST', '/api/billing/checkout', { token: a.token });
    expect(new URLSearchParams(out.calls[0].body).get('customer')).toBe('cus_Mina1');
  });
});
