// HTTP plumbing shared by every route: error shape, body validation, auth, rate limiting.
import type { Context, MiddlewareHandler } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import type { z } from 'zod';
import type { ApiError } from '../../shared/src/index.ts';
import { sha256Hex } from './crypto.ts';
import type { Db, DeviceRow } from './db.ts';

export type AppEnv = {
  Bindings: Partial<HttpBindings>;
  Variables: { device: DeviceRow };
};
export type AppContext = Context<AppEnv>;

/** An error that is safe to show to the client as-is. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function apiError(c: Context, status: number, message: string, code?: string): Response {
  const body: ApiError = code ? { error: message, code } : { error: message };
  return c.json(body, status as 400);
}

function describe(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request body';
  const where = issue.path.length ? issue.path.join('.') : 'body';
  return `Invalid ${where}: ${issue.message}`;
}

const KB = 1024;
/** Request body ceilings by path. The save is the only large thing a client sends. */
const BODY_LIMITS: Record<string, number> = {
  '/api/state': 4 * KB * KB,
  '/api/billing/webhook': 512 * KB,
};
const DEFAULT_BODY_LIMIT = 64 * KB;

export function bodyLimitFor(c: Context): number {
  return BODY_LIMITS[new URL(c.req.url).pathname] ?? DEFAULT_BODY_LIMIT;
}

const tooLarge = (): HttpError => new HttpError(413, 'That request is too large', 'too_large');

/**
 * The request body as text, never buffering more than the limit for this route. A declared
 * Content-Length over the limit is refused up front; a body without one (chunked) is cut
 * off as soon as it runs over.
 */
export async function readBody(c: Context): Promise<string> {
  const limit = bodyLimitFor(c);
  if (Number(c.req.header('content-length') ?? 0) > limit) throw tooLarge();
  const body = c.req.raw.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJson<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  const text = await readBody(c);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be JSON', 'invalid_json');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, describe(parsed.error), 'invalid_body');
  return parsed.data as z.infer<T>;
}

export function bearer(c: Context): string | null {
  const header = c.req.header('authorization');
  const m = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return m ? m[1] : null;
}

export function deviceForToken(db: Db, token: string | null | undefined): DeviceRow | null {
  if (!token || token.length < 20 || token.length > 200) return null;
  return db.deviceByTokenHash(sha256Hex(token));
}

export function requireAuth(db: Db, onSeen: (device: DeviceRow) => void): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const device = deviceForToken(db, bearer(c));
    if (!device) return apiError(c, 401, 'Sign in again on this device', 'unauthorized');
    c.set('device', device);
    onSeen(device);
    await next();
  };
}

export function clientIp(c: AppContext, trustProxy: boolean): string {
  if (trustProxy) {
    // the right-most entry is the one our own proxy appended
    const last = c.req.header('x-forwarded-for')?.split(',').pop()?.trim();
    if (last) return last;
  }
  return c.env?.incoming?.socket?.remoteAddress ?? 'local';
}

/** Fixed-window counter. Good enough to blunt code guessing and signup floods on one node. */
export function rateLimiter(max: number, windowMs: number, now: () => number): (key: string) => number {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key) => {
    const t = now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    let entry = hits.get(key);
    if (!entry || entry.reset <= t) {
      entry = { n: 0, reset: t + windowMs };
      hits.set(key, entry);
    }
    entry.n += 1;
    return entry.n > max ? Math.max(1, Math.ceil((entry.reset - t) / 1000)) : 0;
  };
}

export function limitByIp(
  check: (key: string) => number,
  scope: string,
  trustProxy: boolean,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const retryAfter = check(`${scope}:${clientIp(c, trustProxy)}`);
    if (retryAfter > 0) {
      c.header('Retry-After', String(retryAfter));
      return apiError(c, 429, 'Too many attempts. Try again in a few minutes.', 'rate_limited');
    }
    await next();
  };
}
