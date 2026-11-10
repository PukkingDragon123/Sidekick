// Small crypto helpers: token hashing, AES-256-GCM sealing of stored credentials, PKCE, HMAC.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Random id for rows that are not secrets (accounts, devices, integrations). */
export const newId = (prefix: string): string => `${prefix}_${randomBytes(9).toString('base64url')}`;

/** No 0/O, 1/I/L: the code is read off one screen and typed on another. */
const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function pairCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
  return out;
}

export function normalizePairCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const hmacSha256Hex = (key: string, payload: string): string => createHmac('sha256', key).update(payload).digest('hex');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** AES-256-GCM box for credentials at rest. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export class SecretBox {
  readonly #key: Buffer;

  constructor(secret: string | Buffer) {
    this.#key = Buffer.from(hkdfSync('sha256', secret, 'sidekick', 'credentials-v1', 32));
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || data == null) throw new Error('Unreadable secret');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }

  sealJson(value: unknown): string {
    return this.seal(JSON.stringify(value));
  }

  openJson<T>(sealed: string): T {
    return JSON.parse(this.open(sealed)) as T;
  }
}

/**
 * Key material for SecretBox: SIDEKICK_SECRET if set, otherwise a random key generated once
 * into `<dataDir>/secret.key`. An in-memory database gets a throwaway key.
 */
export function loadSecret(opts: { secret: string | null; dataDir: string; ephemeral: boolean }): string | Buffer {
  if (opts.secret) return opts.secret;
  if (opts.ephemeral) return randomBytes(32);
  const file = path.join(opts.dataDir, 'secret.key');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // first run: fall through and create it
  }
  fs.mkdirSync(opts.dataDir, { recursive: true });
  const fresh = randomBytes(32).toString('base64url');
  try {
    fs.writeFileSync(file, fresh + '\n', { mode: 0o600, flag: 'wx' });
    return fresh;
  } catch {
    // another process won the race: use what it wrote
    return fs.readFileSync(file, 'utf8').trim();
  }
}
