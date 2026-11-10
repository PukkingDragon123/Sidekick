// Web Push subscriptions.
import type { Hono, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { PushKeyRes } from '../../../shared/src/index.ts';
import { sidekickName } from '../ai/prompt.ts';
import type { Ctx } from '../context.ts';
import { HttpError, readJson, type AppEnv } from '../http.ts';
import { SsrfError, assertPublicHttpUrl } from '../integrations/ssrf.ts';
import { notifyAccount } from '../push.ts';

const base64url = (max: number) => z.string().min(8).max(max).regex(/^[A-Za-z0-9_\-+/]+=*$/);

const subscribeBody = z.object({
  subscription: z
    .object({
      endpoint: z.string().min(12).max(2000),
      keys: z.object({ p256dh: base64url(200), auth: base64url(100) }),
    })
    // browsers add expirationTime; it is of no use here
    .passthrough(),
});

export function pushRoutes(app: Hono<AppEnv>, ctx: Ctx, auth: MiddlewareHandler<AppEnv>): void {
  app.get('/api/push/key', auth, (c) => {
    const res: PushKeyRes = { publicKey: ctx.vapid.publicKey };
    return c.json(res);
  });

  app.post('/api/push/subscribe', auth, async (c) => {
    const device = c.get('device');
    const { subscription } = await readJson(c, subscribeBody);
    // The server will later POST to this URL, so it gets the same scrutiny as a feed link.
    let endpoint: URL;
    try {
      endpoint = assertPublicHttpUrl(subscription.endpoint);
    } catch (err) {
      throw new HttpError(400, err instanceof SsrfError ? err.message : 'Invalid push endpoint', 'invalid_body');
    }
    if (endpoint.protocol !== 'https:') throw new HttpError(400, 'Push endpoints must use https', 'invalid_body');
    ctx.db.savePushSub(
      { endpoint: endpoint.href, accountId: device.accountId, deviceId: device.id, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      ctx.now(),
    );
    return c.json({ ok: true });
  });

  app.post('/api/push/test', auth, async (c) => {
    const { accountId } = c.get('device');
    const state = ctx.states.get(accountId);
    const name = state ? sidekickName(state) : 'Your sidekick';
    const result = await notifyAccount(ctx, accountId, {
      title: 'It works',
      body: `This is what a nudge from me looks like. — ${name}`,
      tag: 'test',
    });
    return c.json({ ok: true, sent: result.sent });
  });
}
