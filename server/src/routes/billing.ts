// Sidekick Plus checkout and the Stripe webhook that makes it real.
import type { Hono, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { CheckoutRes } from '../../../shared/src/index.ts';
import { createCheckout, handleStripeEvent, verifyStripeSignature } from '../billing.ts';
import type { Ctx } from '../context.ts';
import { HttpError, apiError, readBody, type AppEnv } from '../http.ts';

const checkoutBody = z.object({ return: z.string().max(2000).optional() });

export function billingRoutes(app: Hono<AppEnv>, ctx: Ctx, auth: MiddlewareHandler<AppEnv>): void {
  const { config } = ctx;
  const home = `${config.publicUrl}/`;
  const allowedReturnOrigins = new Set([new URL(config.publicUrl).origin, ...config.corsOrigins]);

  app.post('/api/billing/checkout', auth, async (c) => {
    if (!config.stripe) return apiError(c, 503, 'Sidekick Plus is not available on this server', 'no_billing');
    // the body is optional: {} or nothing at all both mean "come back to the app's front page"
    const raw = await readBody(c);
    let wanted: string | undefined;
    if (raw.trim()) {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new HttpError(400, 'Request body must be JSON', 'invalid_json');
      }
      const parsed = checkoutBody.safeParse(json);
      if (!parsed.success) throw new HttpError(400, 'Invalid request body', 'invalid_body');
      wanted = parsed.data.return;
    }
    let returnUrl = home;
    if (wanted) {
      try {
        const url = new URL(wanted);
        if (allowedReturnOrigins.has(url.origin)) returnUrl = url.toString();
      } catch {
        // not a URL: fall back to the front page
      }
    }
    const res: CheckoutRes = { url: await createCheckout(ctx, c.get('device').accountId, returnUrl) };
    return c.json(res);
  });

  // Called by Stripe, not by a client: authenticated by the signature over the raw body.
  app.post('/api/billing/webhook', async (c) => {
    if (!config.stripe) return apiError(c, 503, 'Billing is not configured', 'no_billing');
    const raw = await readBody(c);
    if (!verifyStripeSignature(raw, c.req.header('stripe-signature'), config.stripe.webhookSecret, ctx.now())) {
      return apiError(c, 400, 'Invalid signature', 'bad_signature');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return apiError(c, 400, 'Request body must be JSON', 'invalid_json');
    }
    handleStripeEvent(ctx, payload);
    return c.json({ received: true });
  });
}
