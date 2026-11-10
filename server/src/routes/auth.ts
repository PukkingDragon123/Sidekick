// Accounts and devices. There are no passwords: a device holds a random token, and a
// second device joins an account by typing a short-lived pair code shown on the first.
import type { Hono, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { AuthRes, PairCodeRes } from '../../../shared/src/index.ts';
import type { Ctx } from '../context.ts';
import { newId, normalizePairCode, pairCode, randomToken, sha256Hex } from '../crypto.ts';
import { HttpError, limitByIp, rateLimiter, readJson, type AppEnv } from '../http.ts';

const PAIR_CODE_TTL_MS = 10 * 60_000;

const deviceFields = {
  deviceName: z.string().trim().min(1).max(60),
  kind: z.enum(['mobile', 'tablet', 'desktop', 'web']),
};
const registerBody = z.object(deviceFields);
const linkBody = z.object({ code: z.string().trim().min(1).max(32), ...deviceFields });

export function authRoutes(app: Hono<AppEnv>, ctx: Ctx, auth: MiddlewareHandler<AppEnv>): void {
  const { db, config } = ctx;
  // one budget per route, so code guessing cannot be hidden behind signups or the reverse
  const check = rateLimiter(config.authRateMax, config.authRateWindowMs, ctx.now);

  function addDevice(accountId: string, name: string, kind: z.infer<typeof registerBody>['kind']): AuthRes {
    const token = randomToken();
    const deviceId = newId('dev');
    // only the hash is stored: a copy of the database does not let anyone sign in
    db.createDevice({ id: deviceId, accountId, name, kind, tokenHash: sha256Hex(token), now: ctx.now() });
    return { accountId, deviceId, token };
  }

  app.post('/api/auth/register', limitByIp(check, 'register', config.trustProxy), async (c) => {
    const body = await readJson(c, registerBody);
    const res = db.transaction(() => {
      const accountId = newId('acc');
      db.createAccount(accountId, ctx.now());
      return addDevice(accountId, body.deviceName, body.kind);
    });
    return c.json(res);
  });

  app.post('/api/auth/pair-code', auth, (c) => {
    const device = c.get('device');
    const expiresAt = ctx.now() + PAIR_CODE_TTL_MS;
    let code = pairCode();
    while (db.pairCodeExists(code)) code = pairCode();
    // asking again replaces the previous code, so only the one on screen works
    db.createPairCode(code, device.accountId, expiresAt, ctx.now());
    const res: PairCodeRes = { code, expiresAt };
    return c.json(res);
  });

  app.post('/api/auth/link', limitByIp(check, 'link', config.trustProxy), async (c) => {
    const body = await readJson(c, linkBody);
    const res = db.transaction(() => {
      const accountId = db.consumePairCode(normalizePairCode(body.code), ctx.now());
      if (!accountId) return null;
      return addDevice(accountId, body.deviceName, body.kind);
    });
    if (!res) throw new HttpError(400, 'That code is wrong or has expired. Ask for a new one on your other device.', 'bad_code');
    return c.json(res);
  });
}
