// Everything a request handler or background job needs, built once in app.ts and passed around.
import type Anthropic from '@anthropic-ai/sdk';
import type { Config } from './config.ts';
import type { SecretBox } from './crypto.ts';
import type { Db } from './db.ts';
import type { Hub } from './hub.ts';
import type { PublicFetch } from './integrations/ssrf.ts';
import type { StateStore } from './state.ts';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export interface Ctx {
  config: Config;
  version: string;
  db: Db;
  box: SecretBox;
  now: () => number;
  /** For fixed, trusted hosts: Google, Microsoft Graph, Stripe. */
  fetch: typeof fetch;
  /** For URLs that came from a user: calendar feeds and push endpoints. SSRF-guarded. */
  publicFetch: PublicFetch;
  hub: Hub;
  states: StateStore;
  /** null when no Anthropic credentials are configured */
  ai: Anthropic | null;
  vapid: { publicKey: string; privateKey: string };
  log: Logger;
  /** in-flight school syncs, so two requests for one account share a run */
  syncing: Map<string, Promise<unknown>>;
}

/**
 * A short label for an error in logs: its class and, when there is one, its machine code
 * (ECONNREFUSED, ENOTFOUND, ...). Never the message: messages of network and provider errors
 * can carry URLs, and feed URLs and query strings are credentials.
 */
export function errorKind(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  const code = (e: unknown): string | null => {
    const c = (e as { code?: unknown } | null | undefined)?.code;
    return typeof c === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(c) ? c : null;
  };
  const found = code(err) ?? code(err.cause);
  return found ? `${err.name} ${found}` : err.name;
}
