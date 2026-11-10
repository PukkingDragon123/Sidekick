// Pulling every connected school source for an account and folding the result into its save.
import type { IntegrationInfo, Provider, SaveState, SyncRes } from '../../../shared/src/index.ts';
import { errorKind, type Ctx } from '../context.ts';
import { newId, sha256Hex } from '../crypto.ts';
import type { IntegrationRow } from '../db.ts';
import { HttpError } from '../http.ts';
import { safeTz } from '../tz.ts';
import { pullGoogle } from './google.ts';
import { icsToTasks, parseIcs, type IcsCalendar } from './ics.ts';
import { applyImport, cleanText, type ImportedTask } from './importer.ts';
import { pullMicrosoft } from './microsoft.ts';
import { ApiSession, ProviderError, providerConfig, type OAuthProvider, type OAuthTokens } from './oauth.ts';
import { FetchLimitError, SsrfError, assertPublicHttpUrl, normalizeFeedUrl } from './ssrf.ts';

export const MAX_INTEGRATIONS = 20;

interface IcsSecret {
  url: string;
  /** stable id derived from the URL, so re-adding a feed finds its old tasks */
  feedId: string;
}

export function integrationInfo(row: IntegrationRow): IntegrationInfo {
  const info: IntegrationInfo = { id: row.id, provider: row.provider, label: row.label };
  if (row.lastSync != null) info.lastSync = row.lastSync;
  if (row.error) info.error = row.error;
  return info;
}

/** A message for the student about a failed pull. Unknown failures are logged, not echoed. */
function userMessage(ctx: Ctx, provider: Provider, err: unknown): string {
  if (err instanceof ProviderError || err instanceof SsrfError || err instanceof FetchLimitError) return err.message;
  ctx.log.warn(`sync: ${provider} failed (${errorKind(err)})`);
  return 'Something went wrong reading this source. Try again later.';
}

async function fetchCalendar(ctx: Ctx, url: string): Promise<IcsCalendar> {
  const res = await ctx.publicFetch(url, {
    headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5', 'user-agent': `Sidekick/${ctx.version} (calendar import)` },
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 15_000,
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new ProviderError('The calendar link was refused. Copy a fresh link from your school site.', { status: res.status });
  }
  if (res.status < 200 || res.status >= 300) {
    throw new ProviderError(`The calendar feed answered with an error (${res.status}).`, { status: res.status });
  }
  try {
    return parseIcs(res.body.toString('utf8'));
  } catch {
    throw new ProviderError('That link does not point to a calendar feed (.ics).');
  }
}

function oauthSession(ctx: Ctx, row: IntegrationRow, provider: OAuthProvider): ApiSession {
  const config = providerConfig(ctx.config, provider);
  if (!config) throw new ProviderError(`${provider === 'google' ? 'Google Classroom' : 'Microsoft Teams'} is not set up on this server.`);
  let tokens: OAuthTokens;
  try {
    tokens = ctx.box.openJson<OAuthTokens>(row.secret);
  } catch {
    throw new ProviderError(`${config.name} needs to be connected again.`, { reconnect: true });
  }
  return new ApiSession({
    fetch: ctx.fetch,
    provider: config,
    tokens,
    now: ctx.now,
    persist: (fresh) => ctx.db.setIntegrationSecret(row.id, ctx.box.sealJson(fresh)),
  });
}

async function pull(ctx: Ctx, row: IntegrationRow, tz: string): Promise<{ items: ImportedTask[]; warnings: string[] }> {
  if (row.provider === 'google') return pullGoogle(oauthSession(ctx, row, 'google'));
  if (row.provider === 'microsoft') return pullMicrosoft(oauthSession(ctx, row, 'microsoft'), ctx.now());
  let secret: IcsSecret;
  try {
    secret = ctx.box.openJson<IcsSecret>(row.secret);
  } catch {
    throw new ProviderError('This calendar feed needs to be added again.', { reconnect: true });
  }
  const calendar = await fetchCalendar(ctx, secret.url);
  return { items: icsToTasks(calendar, { feedId: secret.feedId, tz, now: ctx.now() }), warnings: [] };
}

async function runSync(ctx: Ctx, accountId: string, exceptDevice: string | undefined): Promise<SyncRes> {
  const before = ctx.states.get(accountId);
  if (!before) throw new HttpError(409, 'Save your game to the server before importing schoolwork', 'no_state');
  const tz = safeTz(before.settings.tz);
  const rows = ctx.db.integrations(accountId);

  const results = await Promise.all(
    rows.map(async (row) => {
      try {
        return { row, ...(await pull(ctx, row, tz)), error: null };
      } catch (err) {
        return { row, items: [] as ImportedTask[], warnings: [] as string[], error: userMessage(ctx, row.provider, err) };
      }
    }),
  );

  const now = ctx.now();
  let added = 0;
  let updated = 0;
  // one synchronous step over the freshest copy: nothing can interleave with the import
  const state = ctx.states.update(
    accountId,
    (s) => {
      for (const r of results) {
        if (r.error) continue;
        const counts = applyImport(s, r.items, now);
        added += counts.added;
        updated += counts.updated;
      }
    },
    exceptDevice,
  );

  const errors: SyncRes['errors'] = [];
  for (const r of results) {
    if (r.error) {
      ctx.db.setIntegrationResult(r.row.id, null, r.error);
      errors.push({ provider: r.row.provider, message: r.error });
    } else {
      ctx.db.setIntegrationResult(r.row.id, now, r.warnings[0] ?? null);
      for (const message of r.warnings) errors.push({ provider: r.row.provider, message });
    }
  }
  return { added, updated, errors, state: state ?? before };
}

/** POST /api/integrations/sync. Concurrent calls for one account share a single run. */
export function syncAccount(ctx: Ctx, accountId: string, exceptDevice?: string): Promise<SyncRes> {
  const running = ctx.syncing.get(accountId) as Promise<SyncRes> | undefined;
  if (running) return running;
  const run = runSync(ctx, accountId, exceptDevice).finally(() => ctx.syncing.delete(accountId));
  ctx.syncing.set(accountId, run);
  return run;
}

/** POST /api/integrations/ics: check the link really is a calendar, store it, import it. */
export async function addIcsFeed(
  ctx: Ctx,
  accountId: string,
  input: { url: string; label?: string },
  exceptDevice?: string,
): Promise<SyncRes & { integration: IntegrationInfo }> {
  const state = ctx.states.get(accountId);
  if (!state) throw new HttpError(409, 'Save your game to the server before importing schoolwork', 'no_state');

  let url: string;
  let calendar: IcsCalendar;
  try {
    url = assertPublicHttpUrl(normalizeFeedUrl(input.url)).href;
    calendar = await fetchCalendar(ctx, url);
  } catch (err) {
    if (err instanceof SsrfError) throw new HttpError(400, err.message, 'blocked_url');
    if (err instanceof FetchLimitError) throw new HttpError(400, err.message, 'feed_unreachable');
    if (err instanceof ProviderError) throw new HttpError(400, err.message, 'feed_error');
    ctx.log.warn(`ics: fetch failed (${errorKind(err)})`);
    throw new HttpError(400, 'Could not reach that calendar link.', 'feed_unreachable');
  }

  const feedId = sha256Hex(url).slice(0, 12);
  const existing = ctx.db.integrationByKey(accountId, 'ics', feedId);
  if (!existing && ctx.db.countIntegrations(accountId) >= MAX_INTEGRATIONS) {
    throw new HttpError(400, 'That is a lot of sources. Remove one before adding another.', 'too_many');
  }
  const label = cleanText(input.label, 80) ?? cleanText(calendar.name, 80) ?? new URL(url).hostname;
  const secret: IcsSecret = { url, feedId };
  const now = ctx.now();
  const id = ctx.db.upsertIntegration({
    id: newId('int'), accountId, provider: 'ics', key: feedId, label, secret: ctx.box.sealJson(secret), now,
  });

  const items = icsToTasks(calendar, { feedId, tz: safeTz(state.settings.tz), now });
  let counts = { added: 0, updated: 0 };
  const next: SaveState | null = ctx.states.update(
    accountId,
    (s) => {
      counts = applyImport(s, items, now);
    },
    exceptDevice,
  );
  ctx.db.setIntegrationResult(id, now, null);
  const row = ctx.db.integration(id);
  if (!row) throw new HttpError(500, 'Could not store the calendar feed');
  return { integration: integrationInfo(row), added: counts.added, updated: counts.updated, errors: [], state: next ?? state };
}
