// Sidekick Plus through Stripe Checkout, talking to the REST API directly (no SDK).
//   POST https://api.stripe.com/v1/checkout/sessions   (form-encoded, Bearer secret key)
//   webhook: Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<raw body>">
import { z } from 'zod';
import { errorKind, type Ctx } from './context.ts';
import { hmacSha256Hex, safeEqual } from './crypto.ts';
import { HttpError } from './http.ts';

const STRIPE_API = 'https://api.stripe.com/v1';
/** Stripe's own libraries reject events older than five minutes; so do we. */
const SIGNATURE_TOLERANCE_S = 300;

export async function createCheckout(ctx: Ctx, accountId: string, returnUrl: string): Promise<string> {
  const stripe = ctx.config.stripe;
  if (!stripe) throw new HttpError(503, 'Sidekick Plus is not available on this server', 'no_billing');
  const back = new URL(returnUrl);
  const withResult = (result: string): string => {
    const u = new URL(back);
    u.searchParams.set('plus', result);
    return u.toString();
  };
  const form = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': stripe.priceId,
    'line_items[0][quantity]': '1',
    success_url: withResult('success'),
    cancel_url: withResult('cancelled'),
    // how the webhook finds the account again, on the session and on the subscription it creates
    client_reference_id: accountId,
    'metadata[account_id]': accountId,
    'subscription_data[metadata][account_id]': accountId,
  });
  const customer = ctx.db.premium(accountId)?.stripeCustomer;
  if (customer) form.set('customer', customer);

  let res: Response;
  try {
    res = await ctx.fetch(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${stripe.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    ctx.log.error(`billing: could not reach Stripe (${errorKind(err)})`);
    throw new HttpError(502, 'The payment page could not be opened. Try again in a moment.', 'billing_failed');
  }
  const body = (await res.json().catch(() => ({}))) as { url?: unknown; error?: { type?: unknown; code?: unknown } };
  if (!res.ok || typeof body.url !== 'string') {
    ctx.log.error(`billing: Stripe refused the checkout session (${res.status} ${String(body.error?.code ?? body.error?.type ?? '')})`);
    throw new HttpError(502, 'The payment page could not be opened. Try again in a moment.', 'billing_failed');
  }
  return body.url;
}

/** True when the header carries a valid v1 signature of this exact body, made recently. */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowMs: number): boolean {
  if (!header) return false;
  let timestamp = '';
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') candidates.push(value);
  }
  if (!/^\d+$/.test(timestamp) || !candidates.length) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_S) return false;
  const expected = hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  // several v1 entries appear while a signing secret is being rolled
  return candidates.some((c) => safeEqual(c, expected));
}

const id = z.string().min(1).max(255);
const idOrObject = z.union([id, z.object({ id }).passthrough().transform((o) => o.id)]);

const eventSchema = z
  .object({
    type: z.string(),
    data: z.object({ object: z.record(z.unknown()) }),
  })
  .passthrough();

const sessionSchema = z
  .object({
    mode: z.string().nullish(),
    client_reference_id: z.string().nullish(),
    customer: idOrObject.nullish(),
    subscription: idOrObject.nullish(),
    metadata: z.record(z.string()).nullish(),
  })
  .passthrough();

const subscriptionSchema = z
  .object({
    id,
    customer: idOrObject.nullish(),
    status: z.string(),
    // moved onto the subscription items in newer API versions
    current_period_end: z.number().nullish(),
    items: z.object({ data: z.array(z.object({ current_period_end: z.number().nullish() }).passthrough()) }).passthrough().nullish(),
    metadata: z.record(z.string()).nullish(),
  })
  .passthrough();

const ACTIVE = new Set(['active', 'trialing']);

/** Apply a verified webhook event. Unknown event types are acknowledged and ignored. */
export function handleStripeEvent(ctx: Ctx, payload: unknown): void {
  const event = eventSchema.safeParse(payload);
  if (!event.success) throw new HttpError(400, 'Unreadable event', 'invalid_body');
  const { type } = event.data;
  const object = event.data.data.object;
  const now = ctx.now();

  if (type === 'checkout.session.completed') {
    const session = sessionSchema.safeParse(object);
    if (!session.success) return;
    const accountId = session.data.client_reference_id ?? session.data.metadata?.account_id;
    if (session.data.mode !== 'subscription' || !accountId || !ctx.db.accountExists(accountId)) return;
    ctx.db.setPremium(
      {
        accountId,
        plus: true,
        // the subscription event that follows carries the period end
        until: null,
        stripeCustomer: session.data.customer ?? null,
        stripeSubscription: session.data.subscription ?? null,
      },
      now,
    );
    ctx.states.republish(accountId);
    return;
  }

  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted' || type === 'customer.subscription.created') {
    const sub = subscriptionSchema.safeParse(object);
    if (!sub.success) return;
    const customer = sub.data.customer ?? null;
    const accountId = sub.data.metadata?.account_id ?? (customer ? ctx.db.premiumByCustomer(customer)?.accountId : undefined);
    if (!accountId || !ctx.db.accountExists(accountId)) return;
    const known = ctx.db.premium(accountId);
    const plus = type !== 'customer.subscription.deleted' && ACTIVE.has(sub.data.status);
    // an old subscription winding down must not switch off a newer one
    if (!plus && known?.stripeSubscription && known.stripeSubscription !== sub.data.id) return;
    const periodEnd = sub.data.current_period_end ?? sub.data.items?.data[0]?.current_period_end ?? null;
    ctx.db.setPremium(
      { accountId, plus, until: periodEnd != null ? periodEnd * 1000 : null, stripeCustomer: customer, stripeSubscription: sub.data.id },
      now,
    );
    ctx.states.republish(accountId);
  }
}
