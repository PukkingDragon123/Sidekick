// Storage on the built-in node:sqlite. Everything the server remembers goes through this file.
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { DeviceKind, Provider } from '../../shared/src/index.ts';

// Loaded through process.getBuiltinModule so bundlers that do not know the
// prefix-only `node:sqlite` builtin (Vite, and therefore Vitest) leave it alone.
const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  state TEXT,
  state_at INTEGER,
  host_device TEXT
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_account ON devices(account_id);
CREATE TABLE IF NOT EXISTS pair_codes (
  code TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  secret TEXT NOT NULL,
  last_sync INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, provider, key)
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  secret TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id TEXT,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_account ON push_subs(account_id);
CREATE TABLE IF NOT EXISTS notify_marks (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (account_id, key)
);
CREATE TABLE IF NOT EXISTS ai_usage (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (account_id, day)
);
CREATE TABLE IF NOT EXISTS premium (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plus INTEGER NOT NULL,
  until INTEGER,
  stripe_customer TEXT,
  stripe_subscription TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS premium_customer ON premium(stripe_customer);
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

export interface DeviceRow {
  id: string;
  accountId: string;
  name: string;
  kind: DeviceKind;
  createdAt: number;
  lastSeen: number;
}

export interface IntegrationRow {
  id: string;
  accountId: string;
  provider: Provider;
  label: string;
  /** sealed JSON, see SecretBox */
  secret: string;
  lastSync: number | null;
  error: string | null;
  createdAt: number;
}

export interface OAuthStateRow {
  state: string;
  accountId: string;
  provider: 'google' | 'microsoft';
  secret: string;
  expiresAt: number;
}

export interface PushSubRow {
  endpoint: string;
  accountId: string;
  deviceId: string | null;
  p256dh: string;
  auth: string;
}

export interface PremiumRow {
  accountId: string;
  plus: boolean;
  until: number | null;
  stripeCustomer: string | null;
  stripeSubscription: string | null;
}

type Row = Record<string, unknown>;
type Param = string | number | bigint | null | Uint8Array;

const device = (r: Row): DeviceRow => ({
  id: r.id as string,
  accountId: r.account_id as string,
  name: r.name as string,
  kind: r.kind as DeviceKind,
  createdAt: r.created_at as number,
  lastSeen: r.last_seen as number,
});

const integration = (r: Row): IntegrationRow => ({
  id: r.id as string,
  accountId: r.account_id as string,
  provider: r.provider as Provider,
  label: r.label as string,
  secret: r.secret as string,
  lastSync: (r.last_sync as number | null) ?? null,
  error: (r.error as string | null) ?? null,
  createdAt: r.created_at as number,
});

const premium = (r: Row): PremiumRow => ({
  accountId: r.account_id as string,
  plus: r.plus === 1,
  until: (r.until as number | null) ?? null,
  stripeCustomer: (r.stripe_customer as string | null) ?? null,
  stripeSubscription: (r.stripe_subscription as string | null) ?? null,
});

export class Db {
  readonly raw: DatabaseSync;
  readonly #statements = new Map<string, StatementSync>();

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new sqlite.DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.raw.exec(SCHEMA);
  }

  close(): void {
    this.#statements.clear();
    this.raw.close();
  }

  #stmt(sql: string): StatementSync {
    let s = this.#statements.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.#statements.set(sql, s);
    }
    return s;
  }

  #get(sql: string, ...params: Param[]): Row | undefined {
    return this.#stmt(sql).get(...params) as Row | undefined;
  }

  #all(sql: string, ...params: Param[]): Row[] {
    return this.#stmt(sql).all(...params) as Row[];
  }

  #run(sql: string, ...params: Param[]): number {
    return Number(this.#stmt(sql).run(...params).changes);
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- accounts & devices -------------------------------------------------

  createAccount(id: string, now: number): void {
    this.#run('INSERT INTO accounts (id, created_at) VALUES (?, ?)', id, now);
  }

  accountExists(id: string): boolean {
    return this.#get('SELECT 1 AS x FROM accounts WHERE id = ?', id) != null;
  }

  createDevice(d: { id: string; accountId: string; name: string; kind: DeviceKind; tokenHash: string; now: number }): void {
    this.#run(
      'INSERT INTO devices (id, account_id, name, kind, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)',
      d.id, d.accountId, d.name, d.kind, d.tokenHash, d.now, d.now,
    );
  }

  deviceByTokenHash(tokenHash: string): DeviceRow | null {
    const r = this.#get('SELECT * FROM devices WHERE token_hash = ?', tokenHash);
    return r ? device(r) : null;
  }

  devices(accountId: string): DeviceRow[] {
    return this.#all('SELECT * FROM devices WHERE account_id = ? ORDER BY created_at, id', accountId).map(device);
  }

  touchDevice(id: string, now: number): void {
    this.#run('UPDATE devices SET last_seen = ? WHERE id = ?', now, id);
  }

  host(accountId: string): string | null {
    return (this.#get('SELECT host_device FROM accounts WHERE id = ?', accountId)?.host_device as string | null) ?? null;
  }

  setHost(accountId: string, deviceId: string | null): void {
    this.#run('UPDATE accounts SET host_device = ? WHERE id = ?', deviceId, accountId);
  }

  // ---- pair codes ---------------------------------------------------------

  createPairCode(code: string, accountId: string, expiresAt: number, now: number): void {
    this.#run('DELETE FROM pair_codes WHERE account_id = ? OR expires_at <= ?', accountId, now);
    this.#run('INSERT INTO pair_codes (code, account_id, expires_at) VALUES (?, ?, ?)', code, accountId, expiresAt);
  }

  pairCodeExists(code: string): boolean {
    return this.#get('SELECT 1 AS x FROM pair_codes WHERE code = ?', code) != null;
  }

  /** Single use: the code is deleted whether or not it was still valid. */
  consumePairCode(code: string, now: number): string | null {
    const r = this.#get('DELETE FROM pair_codes WHERE code = ? RETURNING account_id, expires_at', code);
    if (!r || (r.expires_at as number) <= now) return null;
    return r.account_id as string;
  }

  // ---- state --------------------------------------------------------------

  stateJson(accountId: string): string | null {
    return (this.#get('SELECT state FROM accounts WHERE id = ?', accountId)?.state as string | null) ?? null;
  }

  saveStateJson(accountId: string, json: string, now: number): void {
    this.#run('UPDATE accounts SET state = ?, state_at = ? WHERE id = ?', json, now, accountId);
  }

  accountsWithState(): string[] {
    return this.#all('SELECT id FROM accounts WHERE state IS NOT NULL ORDER BY id').map((r) => r.id as string);
  }

  // ---- integrations -------------------------------------------------------

  integrations(accountId: string): IntegrationRow[] {
    return this.#all('SELECT * FROM integrations WHERE account_id = ? ORDER BY created_at, id', accountId).map(integration);
  }

  integration(id: string): IntegrationRow | null {
    const r = this.#get('SELECT * FROM integrations WHERE id = ?', id);
    return r ? integration(r) : null;
  }

  integrationByKey(accountId: string, provider: Provider, key: string): IntegrationRow | null {
    const r = this.#get('SELECT * FROM integrations WHERE account_id = ? AND provider = ? AND key = ?', accountId, provider, key);
    return r ? integration(r) : null;
  }

  /**
   * `key` identifies the thing connected (the provider's user, or the feed), so connecting
   * it a second time replaces the stored credentials instead of adding a duplicate.
   */
  upsertIntegration(row: { id: string; accountId: string; provider: Provider; key: string; label: string; secret: string; now: number }): string {
    const existing = this.integrationByKey(row.accountId, row.provider, row.key);
    if (existing) {
      this.#run('UPDATE integrations SET label = ?, secret = ?, error = NULL WHERE id = ?', row.label, row.secret, existing.id);
      return existing.id;
    }
    this.#run(
      'INSERT INTO integrations (id, account_id, provider, key, label, secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      row.id, row.accountId, row.provider, row.key, row.label, row.secret, row.now,
    );
    return row.id;
  }

  countIntegrations(accountId: string): number {
    return (this.#get('SELECT COUNT(*) AS n FROM integrations WHERE account_id = ?', accountId)?.n as number) ?? 0;
  }

  setIntegrationSecret(id: string, secret: string): void {
    this.#run('UPDATE integrations SET secret = ? WHERE id = ?', secret, id);
  }

  setIntegrationResult(id: string, lastSync: number | null, error: string | null): void {
    if (lastSync == null) this.#run('UPDATE integrations SET error = ? WHERE id = ?', error, id);
    else this.#run('UPDATE integrations SET last_sync = ?, error = ? WHERE id = ?', lastSync, error, id);
  }

  deleteIntegration(id: string, accountId: string): boolean {
    return this.#run('DELETE FROM integrations WHERE id = ? AND account_id = ?', id, accountId) > 0;
  }

  /** Accounts with a connected source that has not synced since `before`, oldest first. */
  accountsDueForSync(before: number, limit: number): string[] {
    return this.#all(
      `SELECT account_id, MIN(COALESCE(last_sync, 0)) AS oldest FROM integrations
       GROUP BY account_id HAVING oldest < ? ORDER BY oldest LIMIT ?`,
      before, limit,
    ).map((r) => r.account_id as string);
  }

  // ---- OAuth round trips --------------------------------------------------

  saveOAuthState(row: OAuthStateRow, now: number): void {
    this.#run('DELETE FROM oauth_states WHERE expires_at <= ?', now);
    this.#run(
      'INSERT INTO oauth_states (state, account_id, provider, secret, expires_at) VALUES (?, ?, ?, ?, ?)',
      row.state, row.accountId, row.provider, row.secret, row.expiresAt,
    );
  }

  /** Single use, like pair codes. */
  consumeOAuthState(state: string, now: number): OAuthStateRow | null {
    const r = this.#get('DELETE FROM oauth_states WHERE state = ? RETURNING *', state);
    if (!r || (r.expires_at as number) <= now) return null;
    return {
      state: r.state as string,
      accountId: r.account_id as string,
      provider: r.provider as 'google' | 'microsoft',
      secret: r.secret as string,
      expiresAt: r.expires_at as number,
    };
  }

  // ---- push ---------------------------------------------------------------

  savePushSub(row: PushSubRow, now: number): void {
    this.#run(
      `INSERT INTO push_subs (endpoint, account_id, device_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET account_id = excluded.account_id, device_id = excluded.device_id,
         p256dh = excluded.p256dh, auth = excluded.auth`,
      row.endpoint, row.accountId, row.deviceId, row.p256dh, row.auth, now,
    );
  }

  pushSubs(accountId: string): PushSubRow[] {
    return this.#all('SELECT * FROM push_subs WHERE account_id = ? ORDER BY created_at, endpoint', accountId).map((r) => ({
      endpoint: r.endpoint as string,
      accountId: r.account_id as string,
      deviceId: (r.device_id as string | null) ?? null,
      p256dh: r.p256dh as string,
      auth: r.auth as string,
    }));
  }

  deletePushSub(endpoint: string): void {
    this.#run('DELETE FROM push_subs WHERE endpoint = ?', endpoint);
  }

  // ---- notification dedupe ------------------------------------------------

  /** True the first time a key is seen for an account, false ever after. */
  markOnce(accountId: string, key: string, now: number): boolean {
    return this.#run('INSERT OR IGNORE INTO notify_marks (account_id, key, at) VALUES (?, ?, ?)', accountId, key, now) > 0;
  }

  hasMark(accountId: string, key: string): boolean {
    return this.#get('SELECT 1 AS x FROM notify_marks WHERE account_id = ? AND key = ?', accountId, key) != null;
  }

  pruneMarks(before: number): void {
    this.#run('DELETE FROM notify_marks WHERE at < ?', before);
  }

  // ---- AI usage -----------------------------------------------------------

  aiUsage(accountId: string, day: string): number {
    return (this.#get('SELECT n FROM ai_usage WHERE account_id = ? AND day = ?', accountId, day)?.n as number | undefined) ?? 0;
  }

  addAiUsage(accountId: string, day: string, delta: number): void {
    this.#run(
      `INSERT INTO ai_usage (account_id, day, n) VALUES (?, ?, MAX(0, ?))
       ON CONFLICT(account_id, day) DO UPDATE SET n = MAX(0, n + ?)`,
      accountId, day, delta, delta,
    );
  }

  pruneAiUsage(beforeDay: string): void {
    this.#run('DELETE FROM ai_usage WHERE day < ?', beforeDay);
  }

  // ---- premium ------------------------------------------------------------

  premium(accountId: string): PremiumRow | null {
    const r = this.#get('SELECT * FROM premium WHERE account_id = ?', accountId);
    return r ? premium(r) : null;
  }

  premiumByCustomer(customer: string): PremiumRow | null {
    const r = this.#get('SELECT * FROM premium WHERE stripe_customer = ?', customer);
    return r ? premium(r) : null;
  }

  setPremium(row: PremiumRow, now: number): void {
    this.#run(
      `INSERT INTO premium (account_id, plus, until, stripe_customer, stripe_subscription, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET plus = excluded.plus, until = excluded.until,
         stripe_customer = COALESCE(excluded.stripe_customer, premium.stripe_customer),
         stripe_subscription = COALESCE(excluded.stripe_subscription, premium.stripe_subscription),
         updated_at = excluded.updated_at`,
      row.accountId, row.plus ? 1 : 0, row.until, row.stripeCustomer, row.stripeSubscription, now,
    );
  }

  // ---- key/value ----------------------------------------------------------

  kv(key: string): string | null {
    return (this.#get('SELECT v FROM kv WHERE k = ?', key)?.v as string | undefined) ?? null;
  }

  setKv(key: string, value: string): void {
    this.#run('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', key, value);
  }
}
