// The Anthropic client and the request settings every call shares.
import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.ts';

/**
 * AI is on only when a key or token is configured explicitly. The SDK could also pick up
 * credentials from a login profile on disk, but a server should not start spending on
 * whatever account happens to be signed in on the machine.
 */
export function createAnthropic(config: Config): Anthropic | null {
  if (config.ai.apiKey) return new Anthropic({ apiKey: config.ai.apiKey });
  if (config.ai.authToken) return new Anthropic({ authToken: config.ai.authToken });
  return null;
}

/**
 * Model, thinking and refusal-fallback settings, identical on every request path.
 *
 * `fallbacks: "default"` asks the API to re-run a request that a safety classifier declined
 * on the model Anthropic recommends for that refusal category, inside the same call. It is
 * a beta parameter, hence the header and the `client.beta.messages` namespace.
 */
export function baseParams(config: Config): {
  model: string;
  thinking: { type: 'adaptive' };
  betas?: Anthropic.Beta.AnthropicBeta[];
  fallbacks?: 'default';
} {
  const params = { model: config.ai.model, thinking: { type: 'adaptive' as const } };
  return config.ai.fallbacks ? { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : params;
}

/**
 * One log line per model call: token counts, never content. The cache numbers are the only
 * way to see that prompt caching still works after someone edits a prompt, and a
 * `fallback_message` iteration is how a response served by a fallback model shows up.
 */
export function usageLine(route: string, message: Anthropic.Beta.BetaMessage): string {
  const u = message.usage;
  const fallback = (u.iterations ?? []).some((i) => i.type === 'fallback_message');
  return (
    `${route}: model=${message.model} stop=${message.stop_reason ?? 'none'} in=${u.input_tokens}` +
    ` cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}` +
    (fallback ? ' served_by_fallback=yes' : '')
  );
}

/** A sentence for the student when a model call fails. Details go to the log, not the bubble. */
export function describeAiError(err: unknown): { message: string; log: string } {
  if (err instanceof Anthropic.RateLimitError) {
    return { message: 'Lots of students are asking me things right now. Give me a minute and try again.', log: 'rate limited (429)' };
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { message: 'My thinking cap is not set up properly on this server. Ask whoever runs it to check the AI key.', log: `credentials rejected (${err.status})` };
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return { message: 'Something about that tripped me up. Try saying it another way.', log: `request rejected (${err.status})` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { message: 'I lost my connection for a second. Try that again?', log: 'connection error' };
  }
  if (err instanceof Anthropic.APIError) {
    return { message: 'I lost my train of thought. Try that again?', log: `API error (${err.status ?? 'no status'})` };
  }
  return { message: 'I lost my train of thought. Try that again?', log: err instanceof Error ? err.name : 'unknown error' };
}
