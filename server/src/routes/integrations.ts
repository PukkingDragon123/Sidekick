// School sources: Google Classroom and Microsoft Teams (OAuth), and iCal feeds.
import type { Hono, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { IntegrationsRes, OAuthStartRes } from '../../../shared/src/index.ts';
import { errorKind, type Ctx } from '../context.ts';
import { newId, pkcePair, randomToken, safeEqual, sha256Hex } from '../crypto.ts';
import { HttpError, apiError, readJson, type AppEnv } from '../http.ts';
import {
  ProviderError, buildAuthUrl, exchangeCode, idTokenClaims, providerConfig, redirectUri,
  type OAuthProvider, type OAuthTokens,
} from '../integrations/oauth.ts';
import { MAX_INTEGRATIONS, addIcsFeed, integrationInfo, syncAccount } from '../integrations/sync.ts';

const OAUTH_STATE_TTL_MS = 10 * 60_000;

const icsBody = z.object({ url: z.string().trim().min(8).max(2000), label: z.string().trim().max(80).optional() });

interface PendingOAuth {
  verifier: string;
  returnUrl: string;
  /** sha256 of the value in the browser-binding cookie */
  binder: string;
}

const bindingCookie = (provider: OAuthProvider): string => `sk_oauth_${provider}`;

const isOAuthProvider = (p: string): p is OAuthProvider => p === 'google' || p === 'microsoft';

export function integrationRoutes(app: Hono<AppEnv>, ctx: Ctx, auth: MiddlewareHandler<AppEnv>): void {
  const { db, config, box } = ctx;
  const home = `${config.publicUrl}/`;
  const allowedReturnOrigins = new Set([new URL(config.publicUrl).origin, ...config.corsOrigins]);

  /** Where the browser may be sent after the provider's consent page: only our own app. */
  function safeReturn(input: string | undefined): string {
    if (!input) return home;
    try {
      const url = new URL(input);
      return allowedReturnOrigins.has(url.origin) ? url.toString() : home;
    } catch {
      return home;
    }
  }

  function backToApp(returnUrl: string, provider: string, status: 'ok' | 'error', reason?: string): string {
    const url = new URL(returnUrl);
    url.searchParams.set('integration', provider);
    url.searchParams.set('status', status);
    if (reason) url.searchParams.set('reason', reason);
    return url.toString();
  }

  app.get('/api/integrations', auth, (c) => {
    const res: IntegrationsRes = {
      configured: { google: config.google != null, microsoft: config.microsoft != null },
      items: db.integrations(c.get('device').accountId).map(integrationInfo),
    };
    return c.json(res);
  });

  app.get('/api/integrations/:provider/start', auth, (c) => {
    const provider = c.req.param('provider');
    if (!isOAuthProvider(provider)) return apiError(c, 404, 'Unknown provider', 'not_found');
    const settings = providerConfig(config, provider);
    if (!settings) return apiError(c, 503, `${provider === 'google' ? 'Google Classroom' : 'Microsoft Teams'} is not set up on this server`, 'not_configured');

    const { verifier, challenge } = pkcePair();
    const state = randomToken(24);
    // `state` ties the callback to this account. The cookie ties it to this browser as well:
    // without it, someone could start a flow for their own account and get another person to
    // press "Allow", attaching that person's school data to the wrong account.
    const binder = randomToken(24);
    setCookie(c, bindingCookie(provider), binder, {
      path: `/api/integrations/${provider}/callback`,
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.publicUrl.startsWith('https://'),
      maxAge: OAUTH_STATE_TTL_MS / 1000,
    });
    const pending: PendingOAuth = { verifier, returnUrl: safeReturn(c.req.query('return')), binder: sha256Hex(binder) };
    db.saveOAuthState(
      { state, accountId: c.get('device').accountId, provider, secret: box.sealJson(pending), expiresAt: ctx.now() + OAUTH_STATE_TTL_MS },
      ctx.now(),
    );
    const res: OAuthStartRes = { url: buildAuthUrl(settings, redirectUri(config, provider), state, challenge) };
    return c.json(res);
  });

  // The provider sends the browser here. No bearer token: the single-use `state` value is
  // what ties the request to the account that started it.
  app.get('/api/integrations/:provider/callback', async (c) => {
    const provider = c.req.param('provider');
    if (!isOAuthProvider(provider)) return apiError(c, 404, 'Unknown provider', 'not_found');
    const stateParam = c.req.query('state');
    const row = stateParam ? db.consumeOAuthState(stateParam, ctx.now()) : null;
    if (!row || row.provider !== provider) return c.redirect(backToApp(home, provider, 'error', 'expired'));

    let pending: PendingOAuth;
    try {
      pending = box.openJson<PendingOAuth>(row.secret);
    } catch {
      return c.redirect(backToApp(home, provider, 'error', 'expired'));
    }
    const presented = getCookie(c, bindingCookie(provider));
    deleteCookie(c, bindingCookie(provider), { path: `/api/integrations/${provider}/callback` });
    if (config.oauthBrowserBinding && !(presented && safeEqual(sha256Hex(presented), pending.binder))) {
      return c.redirect(backToApp(pending.returnUrl, provider, 'error', 'browser_mismatch'));
    }
    const code = c.req.query('code');
    if (c.req.query('error') || !code) return c.redirect(backToApp(pending.returnUrl, provider, 'error', 'denied'));
    const settings = providerConfig(config, provider);
    if (!settings) return c.redirect(backToApp(pending.returnUrl, provider, 'error', 'not_configured'));

    try {
      const { tokens, idToken } = await exchangeCode(ctx.fetch, settings, {
        code,
        verifier: pending.verifier,
        redirect: redirectUri(config, provider),
        now: ctx.now(),
      });
      const who = await identify(provider, tokens, idTokenClaims(idToken));
      const key = (who.id ?? who.email ?? 'default').toLowerCase();
      const existing = db.integrationByKey(row.accountId, provider, key);
      if (!existing && db.countIntegrations(row.accountId) >= MAX_INTEGRATIONS) {
        return c.redirect(backToApp(pending.returnUrl, provider, 'error', 'too_many'));
      }
      const stored: OAuthTokens = { ...tokens };
      if (who.id) stored.userId = who.id;
      // Google only repeats the refresh token when consent is shown again: keep the one we have
      if (!stored.refreshToken && existing) {
        try {
          const previous = box.openJson<OAuthTokens>(existing.secret).refreshToken;
          if (previous) stored.refreshToken = previous;
        } catch {
          // unreadable old secret: the new tokens stand on their own
        }
      }
      db.upsertIntegration({
        id: newId('int'), accountId: row.accountId, provider, key,
        label: who.email ?? settings.name, secret: box.sealJson(stored), now: ctx.now(),
      });
      return c.redirect(backToApp(pending.returnUrl, provider, 'ok'));
    } catch (err) {
      if (!(err instanceof ProviderError)) ctx.log.error(`oauth: ${provider} callback failed (${errorKind(err)})`);
      return c.redirect(backToApp(pending.returnUrl, provider, 'error', 'exchange_failed'));
    }
  });

  /** The signed-in user's e-mail (the label shown in the app) and stable id at the provider. */
  async function identify(
    provider: OAuthProvider,
    tokens: OAuthTokens,
    claims: Record<string, unknown>,
  ): Promise<{ email: string | null; id: string | null }> {
    const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
    let email = text(claims.email) ?? (provider === 'microsoft' ? text(claims.preferred_username) : null);
    let id = provider === 'microsoft' ? text(claims.oid) : text(claims.sub);
    if (email && id) return { email, id };
    // the ID token did not say: ask the provider's "who am I" endpoint
    const url =
      provider === 'google'
        ? 'https://openidconnect.googleapis.com/v1/userinfo'
        : 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName';
    try {
      const res = await ctx.fetch(url, {
        headers: { authorization: `Bearer ${tokens.accessToken}`, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const me = (await res.json()) as Record<string, unknown>;
        email ??= text(me.email) ?? text(me.mail) ?? text(me.userPrincipalName);
        id ??= text(me.sub) ?? text(me.id);
      }
    } catch {
      // a label is nice to have, not worth failing the connection for
    }
    return { email, id };
  }

  app.post('/api/integrations/ics', auth, async (c) => {
    const device = c.get('device');
    const body = await readJson(c, icsBody);
    return c.json(await addIcsFeed(ctx, device.accountId, body, device.id));
  });

  app.post('/api/integrations/sync', auth, async (c) => {
    const device = c.get('device');
    return c.json(await syncAccount(ctx, device.accountId, device.id));
  });

  app.delete('/api/integrations/:id', auth, (c) => {
    // tasks that were imported stay: they carry the student's notes and progress
    if (!db.deleteIntegration(c.req.param('id'), c.get('device').accountId)) {
      throw new HttpError(404, 'That source is not connected', 'not_found');
    }
    return c.json({ ok: true });
  });
}
