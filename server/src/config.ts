// Environment -> typed configuration. Nothing here reads process.env directly, so tests
// can build a config from a plain object.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export type Env = Record<string, string | undefined>;

export interface Config {
  port: number;
  host: string;
  /** Public base URL of this server, no trailing slash. Used for OAuth redirects and checkout return URLs. */
  publicUrl: string;
  corsOrigins: string[];
  /** Trust X-Forwarded-For for the client IP (only behind a reverse proxy you control). */
  trustProxy: boolean;
  dataDir: string;
  /** SQLite file path, or ':memory:'. */
  dbPath: string;
  /** Raw secret material for encrypting stored credentials; null = generate/load data/secret.key. */
  secret: string | null;
  /** Built web client to serve, or null to serve the API only. */
  staticDir: string | null;
  authRateMax: number;
  authRateWindowMs: number;
  google: { clientId: string; clientSecret: string } | null;
  microsoft: { clientId: string; clientSecret: string; tenant: string } | null;
  ai: {
    apiKey: string | null;
    authToken: string | null;
    model: string;
    chatEffort: Effort;
    planEffort: Effort;
    freePerDay: number;
    plusPerDay: number;
    /** Server-side refusal fallbacks (`fallbacks: "default"`). */
    fallbacks: boolean;
    /** Send `eager_input_streaming` on tools (off behind a custom ANTHROPIC_BASE_URL unless forced). */
    eagerToolInput: boolean;
  };
  vapid: { publicKey: string; privateKey: string } | null;
  vapidSubject: string;
  stripe: { secretKey: string; priceId: string; webhookSecret: string } | null;
  /** Background re-sync of connected school sources, in minutes. 0 = only when a client asks. */
  autoSyncMinutes: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

function str(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

function int(env: Env, key: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const v = str(env, key);
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const v = str(env, key)?.toLowerCase();
  if (v == null) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new Error(`${key} must be true or false`);
}

function effort(env: Env, key: string, fallback: Effort): Effort {
  const v = str(env, key)?.toLowerCase();
  if (v == null) return fallback;
  if (!(EFFORTS as readonly string[]).includes(v)) throw new Error(`${key} must be one of ${EFFORTS.join(', ')}`);
  return v as Effort;
}

function origin(value: string, key: string): string {
  if (value === 'null') return value;
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${key} contains an invalid origin: ${value}`);
  }
}

export function loadConfig(env: Env = process.env): Config {
  const port = int(env, 'PORT', 8787, 0, 65535);
  const publicUrl = (str(env, 'PUBLIC_URL') ?? `http://localhost:${port || 8787}`).replace(/\/+$/, '');
  try {
    const u = new URL(publicUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
  } catch {
    throw new Error('PUBLIC_URL must be an http(s) URL');
  }
  const dataDir = path.resolve(str(env, 'SIDEKICK_DATA_DIR') ?? path.join(SERVER_ROOT, 'data'));

  const gId = str(env, 'GOOGLE_CLIENT_ID');
  const gSecret = str(env, 'GOOGLE_CLIENT_SECRET');
  const mId = str(env, 'MS_CLIENT_ID');
  const mSecret = str(env, 'MS_CLIENT_SECRET');
  const vPub = str(env, 'VAPID_PUBLIC_KEY');
  const vPriv = str(env, 'VAPID_PRIVATE_KEY');
  const sKey = str(env, 'STRIPE_SECRET_KEY');
  const sPrice = str(env, 'STRIPE_PRICE_ID');
  const sHook = str(env, 'STRIPE_WEBHOOK_SECRET');

  const fallbacks = (str(env, 'SIDEKICK_FALLBACKS') ?? 'default').toLowerCase();
  if (!['default', 'off'].includes(fallbacks)) throw new Error('SIDEKICK_FALLBACKS must be "default" or "off"');

  return {
    port,
    host: str(env, 'HOST') ?? '0.0.0.0',
    publicUrl,
    corsOrigins: (str(env, 'CORS_ORIGINS') ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => origin(s, 'CORS_ORIGINS')),
    trustProxy: bool(env, 'TRUST_PROXY', false),
    dataDir,
    dbPath: str(env, 'SIDEKICK_DB') ?? path.join(dataDir, 'sidekick.db'),
    secret: str(env, 'SIDEKICK_SECRET'),
    staticDir: path.join(REPO_ROOT, 'web', 'dist'),
    authRateMax: int(env, 'AUTH_RATE_MAX', 30, 1),
    authRateWindowMs: 10 * 60_000,
    google: gId && gSecret ? { clientId: gId, clientSecret: gSecret } : null,
    microsoft: mId && mSecret ? { clientId: mId, clientSecret: mSecret, tenant: str(env, 'MS_TENANT') ?? 'organizations' } : null,
    ai: {
      apiKey: str(env, 'ANTHROPIC_API_KEY'),
      authToken: str(env, 'ANTHROPIC_AUTH_TOKEN'),
      model: str(env, 'SIDEKICK_MODEL') ?? 'claude-opus-5-5',
      chatEffort: effort(env, 'SIDEKICK_CHAT_EFFORT', 'low'),
      planEffort: effort(env, 'SIDEKICK_PLAN_EFFORT', 'medium'),
      freePerDay: int(env, 'AI_FREE_PER_DAY', 40, 0),
      plusPerDay: int(env, 'AI_PLUS_PER_DAY', 400, 0),
      fallbacks: fallbacks === 'default',
      // Gateways in front of the API may reject the field, so it is only on by default
      // when requests go straight to the Anthropic API.
      eagerToolInput: bool(env, 'SIDEKICK_EAGER_TOOL_INPUT', !str(env, 'ANTHROPIC_BASE_URL')),
    },
    vapid: vPub && vPriv ? { publicKey: vPub, privateKey: vPriv } : null,
    // Push services want a contact they could reach: a mailto: or an https URL.
    vapidSubject: str(env, 'VAPID_SUBJECT') ?? (publicUrl.startsWith('https://') ? publicUrl : 'mailto:admin@example.com'),
    stripe: sKey && sPrice && sHook ? { secretKey: sKey, priceId: sPrice, webhookSecret: sHook } : null,
    autoSyncMinutes: int(env, 'AUTO_SYNC_MINUTES', 0, 0, 24 * 60),
  };
}
