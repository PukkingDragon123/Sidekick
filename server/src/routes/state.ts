// The account save: fetch it, or merge a device's copy into it.
import type { Hono, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { SaveState, StateRes } from '../../../shared/src/index.ts';
import type { Ctx } from '../context.ts';
import { readJson, type AppEnv } from '../http.ts';
import { saveStateSchema } from '../state.ts';

const putBody = z.object({ state: saveStateSchema });

export function stateRoutes(app: Hono<AppEnv>, ctx: Ctx, auth: MiddlewareHandler<AppEnv>): void {
  app.get('/api/state', auth, (c) => {
    const res: StateRes = { state: ctx.states.get(c.get('device').accountId) };
    return c.json(res);
  });

  app.put('/api/state', auth, async (c) => {
    const device = c.get('device');
    const body = await readJson(c, putBody);
    // mergeState(serverCopy, incoming); premium is then overwritten from the server's own record.
    // Other devices of the account are told over their sockets; this one gets the result here.
    const res: StateRes = { state: ctx.states.put(device.accountId, body.state as unknown as SaveState, device.id) };
    return c.json(res);
  });
}
