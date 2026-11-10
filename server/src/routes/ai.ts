// Talking to the sidekick, and asking it for a plan.
import type { Hono, MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { ChatEvent } from '../../../shared/src/index.ts';
import { runChat } from '../ai/chat.ts';
import { makePlan } from '../ai/plan.ts';
import { errorKind, type Ctx } from '../context.ts';
import { readJson, type AppEnv } from '../http.ts';

const when = { now: z.number().finite().nonnegative(), tz: z.string().trim().min(1).max(64) };
const chatBody = z.object({ text: z.string().trim().min(1).max(4000), ...when });
const planBody = z.object(when);

export function aiRoutes(app: Hono<AppEnv>, ctx: Ctx, auth: MiddlewareHandler<AppEnv>): void {
  // text/event-stream; every `data:` line is one ChatEvent as JSON. Problems after the
  // stream has started (no AI, daily limit, model failure) arrive as an `error` event.
  app.post('/api/ai/chat', auth, async (c) => {
    const device = c.get('device');
    const body = await readJson(c, chatBody);
    // reverse proxies (nginx) buffer responses unless told not to, which would hold the stream back
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      // stop paying for a reply nobody is listening to
      const gone = new AbortController();
      stream.onAbort(() => gone.abort());
      const emit = async (event: ChatEvent): Promise<void> => {
        if (!stream.aborted && !stream.closed) await stream.writeSSE({ data: JSON.stringify(event) });
      };
      try {
        await runChat(
          ctx,
          { accountId: device.accountId, deviceId: device.id, text: body.text, now: body.now, tz: body.tz, signal: gone.signal },
          emit,
        );
      } catch (err) {
        ctx.log.error(`chat: unexpected failure (${errorKind(err)})`);
        await emit({ type: 'error', code: 'failed', message: 'I lost my train of thought. Try that again?' });
      }
    });
  });

  app.post('/api/ai/plan', auth, async (c) => {
    const device = c.get('device');
    const body = await readJson(c, planBody);
    return c.json(await makePlan(ctx, { accountId: device.accountId, deviceId: device.id, now: body.now, tz: body.tz }));
  });
}
