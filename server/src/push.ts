// Web Push: VAPID keys, and delivery of a notification to every device an account subscribed.
import webpush from 'web-push';
import type { Config } from './config.ts';
import type { SecretBox } from './crypto.ts';
import { errorKind, type Ctx } from './context.ts';
import type { Db } from './db.ts';

/** What the service worker receives as `event.data.json()`. */
export interface Notice {
  title: string;
  body: string;
  taskId?: string;
  /** notifications with the same tag replace each other on the device */
  tag?: string;
}

/** Keys from the environment, or a pair generated once and kept in the database. */
export function loadVapid(config: Config, db: Db, box: SecretBox): { publicKey: string; privateKey: string } {
  if (config.vapid) return config.vapid;
  const publicKey = db.kv('vapid_public');
  const sealed = db.kv('vapid_private');
  if (publicKey && sealed) {
    try {
      return { publicKey, privateKey: box.open(sealed) };
    } catch {
      // sealed under a different SIDEKICK_SECRET: start over with a fresh pair
    }
  }
  const fresh = webpush.generateVAPIDKeys();
  db.setKv('vapid_public', fresh.publicKey);
  db.setKv('vapid_private', box.seal(fresh.privateKey));
  return fresh;
}

/** Push to every subscription of the account. Subscriptions the push service has dropped are removed. */
export async function sendPush(ctx: Ctx, accountId: string, notice: Notice): Promise<{ sent: number; removed: number }> {
  const subs = ctx.db.pushSubs(accountId);
  if (!subs.length) return { sent: 0, removed: 0 };
  const payload = JSON.stringify(notice);
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const details = webpush.generateRequestDetails(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          {
            vapidDetails: { subject: ctx.config.vapidSubject, publicKey: ctx.vapid.publicKey, privateKey: ctx.vapid.privateKey },
            TTL: 12 * 3600,
            urgency: 'normal',
            contentEncoding: 'aes128gcm',
          },
        );
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(details.headers)) headers[k] = String(v);
        const res = await ctx.publicFetch(details.endpoint, {
          method: 'POST',
          headers,
          body: details.body ?? undefined,
          maxBytes: 64 * 1024,
          timeoutMs: 10_000,
        });
        if (res.status === 404 || res.status === 410) {
          ctx.db.deletePushSub(sub.endpoint);
          removed += 1;
        } else if (res.status >= 200 && res.status < 300) {
          sent += 1;
        } else {
          ctx.log.warn(`push: endpoint answered ${res.status}`);
        }
      } catch (err) {
        ctx.log.warn(`push: delivery failed (${errorKind(err)})`);
      }
    }),
  );
  return { sent, removed };
}

/** Tell the account something: a WebSocket `notify` for open clients and a push for the rest. */
export async function notifyAccount(ctx: Ctx, accountId: string, notice: Notice): Promise<{ sent: number; removed: number }> {
  ctx.hub.notify(accountId, notice);
  return sendPush(ctx, accountId, notice);
}
