// Wires storage, the HTTP API, the WebSocket hub and the scheduler together.
// createApp() builds everything without opening a port (tests call app.request or tick
// directly); startServer() additionally listens and starts the once-a-minute job.
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Health } from '../../shared/src/index.ts';
import { createAnthropic } from './ai/client.ts';
import { SERVER_ROOT, loadConfig, type Config, type Env } from './config.ts';
import { consoleLogger, errorKind, type Ctx, type Logger } from './context.ts';
import { SecretBox, loadSecret } from './crypto.ts';
import { Db, type DeviceRow } from './db.ts';
import { HttpError, apiError, bodyLimitFor, deviceForToken, requireAuth, type AppEnv } from './http.ts';
import { Hub } from './hub.ts';
import { createPublicFetch, fetchTransport, type Lookup } from './integrations/ssrf.ts';
import { loadVapid } from './push.ts';
import { aiRoutes } from './routes/ai.ts';
import { authRoutes } from './routes/auth.ts';
import { billingRoutes } from './routes/billing.ts';
import { integrationRoutes } from './routes/integrations.ts';
import { pushRoutes } from './routes/push.ts';
import { stateRoutes } from './routes/state.ts';
import { tick } from './scheduler.ts';
import { StateStore } from './state.ts';
import { serveStatic } from './static.ts';

const KB = 1024;
/** WebSocket close code for a missing or unknown device token. */
export const WS_UNAUTHORIZED = 4401;

export interface AppOptions {
  /** Environment to read configuration from. Defaults to process.env. */
  env?: Env;
  /** Overrides applied on top of the environment (tests: `{ dbPath: ':memory:' }`). */
  config?: Partial<Config>;
  /** Outbound HTTP for Google, Microsoft Graph, Stripe, calendar feeds and push services. */
  fetch?: typeof fetch;
  /** Name resolution for the SSRF guard on calendar feeds and push endpoints. */
  lookup?: Lookup;
  /** An Anthropic client to use, or null for "AI off". Left out: built from the configuration. */
  anthropic?: Anthropic | null;
  /** Clock. Defaults to Date.now. */
  now?: () => number;
  logger?: Logger;
}

export interface App {
  app: Hono<AppEnv>;
  ctx: Ctx;
  /** One scheduler pass (reminders, nudges, daily briefing) at `now`. */
  tick(now?: number): Promise<void>;
  /** Handle WebSocket upgrades on /ws for this HTTP server. */
  attach(server: Server): void;
  close(): void;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function createApp(opts: AppOptions = {}): App {
  const config: Config = { ...loadConfig(opts.env ?? process.env), ...opts.config };
  const now = opts.now ?? Date.now;
  const log = opts.logger ?? consoleLogger;
  const db = new Db(config.dbPath);
  const box = new SecretBox(loadSecret({ secret: config.secret, dataDir: config.dataDir, ephemeral: config.dbPath === ':memory:' }));
  const hub = new Hub(db, now);
  const states = new StateStore(db, now);
  // every stored change reaches the account's other live devices
  states.onChange((accountId, state, exceptDevice) => hub.sendState(accountId, state, exceptDevice));

  const outbound = opts.fetch;
  const ctx: Ctx = {
    config,
    version: readVersion(),
    db,
    box,
    now,
    fetch: outbound ?? ((input, init) => globalThis.fetch(input, init)),
    publicFetch: createPublicFetch({ lookup: opts.lookup, transport: outbound ? fetchTransport(outbound) : undefined }),
    hub,
    states,
    ai: opts.anthropic !== undefined ? opts.anthropic : createAnthropic(config),
    vapid: loadVapid(config, db, box),
    log,
    syncing: new Map(),
  };

  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof HttpError) return apiError(c, err.status, err.message, err.code);
    if (err instanceof HTTPException) return apiError(c, err.status, err.message || 'Request failed');
    log.error(`http: ${c.req.method} ${new URL(c.req.url).pathname} failed (${errorKind(err)})`);
    return apiError(c, 500, 'Something went wrong on the server', 'internal');
  });

  // Browsers on other origins may call the API only if the origin is listed in CORS_ORIGINS.
  app.use(
    '/api/*',
    cors({
      origin: config.corsOrigins,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      // lets a listed origin receive the OAuth browser-binding cookie when it asks with credentials
      credentials: true,
      maxAge: 600,
    }),
  );

  // Oversized uploads are turned away before anything else looks at them. Bodies without a
  // declared length are capped while they are read (see readBody).
  app.use('/api/*', async (c, next) => {
    if (Number(c.req.header('content-length') ?? 0) > bodyLimitFor(c)) return apiError(c, 413, 'That request is too large', 'too_large');
    await next();
  });

  const auth = requireAuth(db, (device) => hub.seen(device.id));

  app.get('/api/health', (c) => {
    const health: Health = {
      ok: true,
      version: ctx.version,
      ai: ctx.ai != null,
      google: config.google != null,
      microsoft: config.microsoft != null,
      push: true,
      billing: config.stripe != null,
    };
    return c.json(health);
  });

  authRoutes(app, ctx, auth);
  stateRoutes(app, ctx, auth);
  integrationRoutes(app, ctx, auth);
  aiRoutes(app, ctx, auth);
  pushRoutes(app, ctx, auth);
  billingRoutes(app, ctx, auth);

  app.all('/api/*', (c) => apiError(c, 404, 'No such API route', 'not_found'));

  app.all('*', async (c) => {
    const page = await serveStatic(c, config.staticDir);
    return page ?? apiError(c, 404, 'Not found', 'not_found');
  });

  // ---- WebSocket ------------------------------------------------------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * KB });
  function accept(ws: WebSocket, device: DeviceRow): void {
    ws.on('message', (data, isBinary) => {
      if (!isBinary) hub.handle(ws, data.toString());
    });
    ws.on('pong', () => hub.pong(ws));
    ws.on('close', () => hub.disconnect(ws));
    ws.on('error', () => ws.terminate());
    hub.connect(ws, device);
  }
  const heartbeat = setInterval(() => hub.heartbeat(), 30_000);
  heartbeat.unref();

  function attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => {
      let url: URL;
      try {
        url = new URL(req.url ?? '/', 'http://localhost');
      } catch {
        socket.destroy();
        return;
      }
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      const device = deviceForToken(db, url.searchParams.get('token'));
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (!device) {
          // completing the handshake first lets the browser see why it was turned away
          ws.close(WS_UNAUTHORIZED, 'unauthorized');
          return;
        }
        accept(ws, device);
      });
    });
  }

  let closed = false;
  return {
    app,
    ctx,
    tick: (at) => tick(ctx, at ?? now()),
    attach,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      hub.closeAll();
      wss.close();
      db.close();
    },
  };
}

export interface RunningServer extends App {
  port: number;
  /** http://127.0.0.1:<port>, handy for tests */
  url: string;
  server: Server;
  stop(): Promise<void>;
}

export async function startServer(opts: AppOptions & { port?: number; host?: string; scheduler?: boolean } = {}): Promise<RunningServer> {
  const built = createApp(opts);
  const { config, log } = built.ctx;
  const port = opts.port ?? config.port;
  const host = opts.host ?? config.host;

  const server = await new Promise<Server>((resolve, reject) => {
    // overrideGlobalObjects:false keeps the platform's own Request/Response for everything else in the process
    const s = serve({ fetch: built.app.fetch, port, hostname: host, overrideGlobalObjects: false }, () => resolve(s)) as Server;
    s.once('error', reject);
  }).catch((err: unknown) => {
    built.close(); // the port was taken or not allowed: do not leave the database open
    throw err;
  });
  built.attach(server);

  let timer: NodeJS.Timeout | undefined;
  if (opts.scheduler !== false) {
    let running = false;
    timer = setInterval(() => {
      if (running) return; // a slow pass must not pile up behind itself
      running = true;
      built
        .tick()
        .catch((err: unknown) => log.error(`scheduler: pass failed (${errorKind(err)})`))
        .finally(() => {
          running = false;
        });
    }, 60_000);
    timer.unref();
  }

  const actualPort = (server.address() as AddressInfo).port;
  return {
    ...built,
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    server,
    async stop() {
      if (timer) clearInterval(timer);
      // sockets first, then the listener, and the database only once nothing can reach it
      built.ctx.hub.closeAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      built.close();
    },
  };
}
