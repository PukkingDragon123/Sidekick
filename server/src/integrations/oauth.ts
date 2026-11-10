// OAuth 2.0 authorization-code flow with PKCE for the two school providers, plus an
// authorised JSON client that refreshes access tokens when they run out.
import type { Config } from '../config.ts';

export type OAuthProvider = 'google' | 'microsoft';

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt: number;
  scope?: string;
  /** provider's id for the signed-in user, when known */
  userId?: string;
}

export interface ProviderConfig {
  provider: OAuthProvider;
  /** shown in messages to the student */
  name: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  extraAuthParams: Record<string, string>;
}

/** A failure talking to a provider, with a message that is safe to show. */
export class ProviderError extends Error {
  readonly status: number | undefined;
  /** the stored grant is no longer usable: the student has to connect again */
  readonly reconnect: boolean;

  constructor(message: string, opts: { status?: number; reconnect?: boolean } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = opts.status;
    this.reconnect = opts.reconnect ?? false;
  }
}

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
];

export const MICROSOFT_SCOPES = ['offline_access', 'openid', 'email', 'User.Read', 'EduAssignments.ReadBasic', 'EduRoster.ReadBasic'];

export function providerConfig(config: Config, provider: OAuthProvider): ProviderConfig | null {
  if (provider === 'google') {
    if (!config.google) return null;
    return {
      provider,
      name: 'Google Classroom',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      scopes: GOOGLE_SCOPES,
      // offline + consent is what makes Google hand out a refresh token every time
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    };
  }
  if (!config.microsoft) return null;
  const authority = `https://login.microsoftonline.com/${encodeURIComponent(config.microsoft.tenant)}/oauth2/v2.0`;
  return {
    provider,
    name: 'Microsoft Teams',
    authUrl: `${authority}/authorize`,
    tokenUrl: `${authority}/token`,
    clientId: config.microsoft.clientId,
    clientSecret: config.microsoft.clientSecret,
    scopes: MICROSOFT_SCOPES,
    extraAuthParams: { response_mode: 'query', prompt: 'select_account' },
  };
}

export function redirectUri(config: Config, provider: OAuthProvider): string {
  return `${config.publicUrl}/api/integrations/${provider}/callback`;
}

export function buildAuthUrl(p: ProviderConfig, redirect: string, state: string, challenge: string): string {
  const url = new URL(p.authUrl);
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: p.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...p.extraAuthParams,
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  id_token?: unknown;
  error?: unknown;
}

async function tokenRequest(
  fetchImpl: typeof fetch,
  p: ProviderConfig,
  params: Record<string, string>,
  now: number,
): Promise<{ tokens: OAuthTokens; idToken: string | null }> {
  let res: Response;
  try {
    res = await fetchImpl(p.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, ...params }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ProviderError(`Could not reach ${p.name}. Try again in a moment.`);
  }
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || typeof body.access_token !== 'string') {
    // invalid_grant: the code or refresh token was revoked, expired or already used
    const reconnect = body.error === 'invalid_grant' || body.error === 'interaction_required';
    throw new ProviderError(
      reconnect ? `${p.name} sign-in has expired. Connect it again.` : `${p.name} did not accept the sign-in.`,
      { status: res.status, reconnect },
    );
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in) || 3600;
  const tokens: OAuthTokens = { accessToken: body.access_token, expiresAt: now + expiresIn * 1000 };
  if (typeof body.refresh_token === 'string') tokens.refreshToken = body.refresh_token;
  if (typeof body.scope === 'string') tokens.scope = body.scope;
  return { tokens, idToken: typeof body.id_token === 'string' ? body.id_token : null };
}

export function exchangeCode(
  fetchImpl: typeof fetch,
  p: ProviderConfig,
  args: { code: string; verifier: string; redirect: string; now: number },
): Promise<{ tokens: OAuthTokens; idToken: string | null }> {
  return tokenRequest(
    fetchImpl,
    p,
    { grant_type: 'authorization_code', code: args.code, redirect_uri: args.redirect, code_verifier: args.verifier },
    args.now,
  );
}

export async function refreshTokens(fetchImpl: typeof fetch, p: ProviderConfig, current: OAuthTokens, now: number): Promise<OAuthTokens> {
  if (!current.refreshToken) throw new ProviderError(`${p.name} sign-in has expired. Connect it again.`, { reconnect: true });
  const params: Record<string, string> = { grant_type: 'refresh_token', refresh_token: current.refreshToken };
  if (p.provider === 'microsoft') params.scope = p.scopes.join(' ');
  const { tokens } = await tokenRequest(fetchImpl, p, params, now);
  // Microsoft rotates the refresh token; Google keeps the one it already gave us
  return { ...current, ...tokens, refreshToken: tokens.refreshToken ?? current.refreshToken };
}

/**
 * Claims of an ID token that came straight from the token endpoint over TLS. That channel
 * already authenticates the issuer, so the signature is not checked again here; never use
 * this on a token that arrived any other way.
 */
export function idTokenClaims(idToken: string | null): Record<string, unknown> {
  if (!idToken) return {};
  try {
    const payload = idToken.split('.')[1];
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as unknown;
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** GET requests against a provider API on behalf of one connected account. */
export class ApiSession {
  readonly #fetch: typeof fetch;
  readonly #provider: ProviderConfig;
  readonly #now: () => number;
  readonly #persist: (tokens: OAuthTokens) => void;
  #tokens: OAuthTokens;
  #refreshing: Promise<void> | null = null;

  constructor(opts: {
    fetch: typeof fetch;
    provider: ProviderConfig;
    tokens: OAuthTokens;
    now: () => number;
    /** called with the new tokens after every refresh */
    persist: (tokens: OAuthTokens) => void;
  }) {
    this.#fetch = opts.fetch;
    this.#provider = opts.provider;
    this.#tokens = opts.tokens;
    this.#now = opts.now;
    this.#persist = opts.persist;
  }

  get userId(): string | undefined {
    return this.#tokens.userId;
  }

  async #refresh(): Promise<void> {
    // parallel requests share one refresh: a rotated refresh token can only be spent once
    this.#refreshing ??= (async () => {
      try {
        this.#tokens = await refreshTokens(this.#fetch, this.#provider, this.#tokens, this.#now());
        this.#persist(this.#tokens);
      } finally {
        this.#refreshing = null;
      }
    })();
    await this.#refreshing;
  }

  async json(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    if (this.#tokens.expiresAt - 60_000 <= this.#now()) await this.#refresh();
    let res = await this.#send(url, headers);
    if (res.status === 401) {
      await this.#refresh();
      res = await this.#send(url, headers);
    }
    if (res.status === 401) {
      throw new ProviderError(`${this.#provider.name} sign-in has expired. Connect it again.`, { status: 401, reconnect: true });
    }
    if (!res.ok) {
      const hint =
        res.status === 403 ? ' Your school may need to approve this app first.'
        : res.status === 429 ? ' Too many requests right now; try again in a minute.'
        : '';
      throw new ProviderError(`${this.#provider.name} answered with an error (${res.status}).${hint}`, { status: res.status });
    }
    const body = (await res.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object') throw new ProviderError(`${this.#provider.name} sent something unreadable.`);
    return body as Record<string, unknown>;
  }

  async #send(url: string, headers: Record<string, string>): Promise<Response> {
    try {
      return await this.#fetch(url, {
        headers: { accept: 'application/json', ...headers, authorization: `Bearer ${this.#tokens.accessToken}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ProviderError(`Could not reach ${this.#provider.name}. Try again in a moment.`);
    }
  }
}

/** Run `worker` over `items`, at most `limit` at a time, keeping result order. */
export async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i]);
      }
    }),
  );
  return out;
}
