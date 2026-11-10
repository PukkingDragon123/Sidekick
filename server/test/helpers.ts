// Shared test scaffolding: a server on port 0 with an in-memory database, a controllable
// clock, a scripted outbound fetch, a scripted Anthropic API, and small HTTP/WS/SSE clients.
import { createECDH, randomBytes, type ECDH } from 'node:crypto';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { WebSocket } from 'ws';
import { SPECIES_INFO, type AuthRes, type ChatEvent, type SaveState, type Task, type WsClientMsg, type WsServerMsg } from '../../shared/src/index.ts';
import { startServer, type AppOptions, type RunningServer } from '../src/app.ts';
import type { Config } from '../src/config.ts';

/** Tue 10 Nov 2026, 09:00 UTC = 16:00 in Bangkok (the zone of the default test save). */
export const T0 = Date.UTC(2026, 10, 10, 9, 0, 0);
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// ---- outbound HTTP ----------------------------------------------------------

export interface OutboundCall {
  url: URL;
  method: string;
  headers: Headers;
  body: string;
  /** the same body as raw bytes (push messages are binary) */
  bytes: Uint8Array;
}

export type OutboundHandler = (call: OutboundCall) => Response | undefined | Promise<Response | undefined>;

export interface FakeFetch {
  fetch: typeof fetch;
  calls: OutboundCall[];
  /** calls whose URL starts with `prefix` */
  to(prefix: string): OutboundCall[];
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A fetch that answers from `handlers` (first one to return a Response wins) and records every call. */
export function fakeFetch(...handlers: OutboundHandler[]): FakeFetch {
  const calls: OutboundCall[] = [];
  const impl = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const bytes = request.body ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array();
    const call: OutboundCall = {
      url: new URL(request.url),
      method: request.method,
      headers: request.headers,
      body: Buffer.from(bytes).toString('utf8'),
      bytes,
    };
    calls.push(call);
    for (const handler of handlers) {
      const res = await handler(call);
      if (res) return res;
    }
    return new Response(`no fixture for ${call.method} ${call.url.origin}${call.url.pathname}`, { status: 599 });
  };
  return { fetch: impl as typeof fetch, calls, to: (prefix) => calls.filter((c) => c.url.href.startsWith(prefix)) };
}

// ---- the server under test --------------------------------------------------

export interface Harness {
  server: RunningServer;
  url: string;
  clock: { now: number };
  api(method: string, path: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string }): Promise<{ status: number; body: any; headers: Headers }>;
  register(name?: string, kind?: 'mobile' | 'tablet' | 'desktop' | 'web'): Promise<AuthRes>;
  /** a second device on the same account, through a pair code */
  link(token: string, name?: string, kind?: 'mobile' | 'tablet' | 'desktop' | 'web'): Promise<AuthRes>;
  putState(token: string, state: SaveState): Promise<SaveState>;
  getState(token: string): Promise<SaveState | null>;
  /** everything the server logged, at any level */
  logs: string[];
  ws(token: string): Promise<WsClient>;
  chat(token: string, text: string, opts?: { now?: number; tz?: string }): Promise<ChatEvent[]>;
  close(): Promise<void>;
}

export interface BootOptions {
  fetch?: typeof fetch;
  anthropic?: Anthropic | null;
  config?: Partial<Config>;
  env?: Record<string, string | undefined>;
  now?: number;
  lookup?: AppOptions['lookup'];
}

const open: Harness[] = [];

export async function boot(opts: BootOptions = {}): Promise<Harness> {
  const clock = { now: opts.now ?? T0 };
  const logs: string[] = [];
  const server = await startServer({
    // an empty environment: nothing from the machine running the tests leaks in
    env: opts.env ?? {},
    config: { dbPath: ':memory:', staticDir: null, ...opts.config },
    port: 0,
    host: '127.0.0.1',
    scheduler: false,
    fetch: opts.fetch,
    // every hostname resolves to a public address unless a test says otherwise
    lookup: opts.lookup ?? (async () => [{ address: '93.184.216.34', family: 4 }]),
    // AI is off unless a test passes a client; an explicit `anthropic: undefined` lets the
    // server decide from its environment, as it does in production
    anthropic: 'anthropic' in opts ? opts.anthropic : null,
    now: () => clock.now,
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
  });
  const sockets: WsClient[] = [];

  const api: Harness['api'] = async (method, path, o = {}) => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    let body: string | undefined;
    if (o.raw != null) body = o.raw;
    else if (o.body !== undefined) {
      body = JSON.stringify(o.body);
      headers['content-type'] ??= 'application/json';
    }
    const res = await fetch(server.url + path, { method, headers, body, redirect: 'manual' });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON: hand back the text
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };

  const harness: Harness = {
    server,
    url: server.url,
    clock,
    logs,
    api,
    async register(name = 'Phone', kind = 'mobile') {
      const res = await api('POST', '/api/auth/register', { body: { deviceName: name, kind } });
      if (res.status !== 200) throw new Error(`register failed: ${res.status}`);
      return res.body as AuthRes;
    },
    async link(token, name = 'Desktop', kind = 'desktop') {
      const code = await api('POST', '/api/auth/pair-code', { token });
      const res = await api('POST', '/api/auth/link', { body: { code: code.body.code, deviceName: name, kind } });
      if (res.status !== 200) throw new Error(`link failed: ${res.status}`);
      return res.body as AuthRes;
    },
    async putState(token, state) {
      const res = await api('PUT', '/api/state', { token, body: { state } });
      if (res.status !== 200) throw new Error(`PUT /api/state failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.state as SaveState;
    },
    async getState(token) {
      const res = await api('GET', '/api/state', { token });
      return res.body.state as SaveState | null;
    },
    async ws(token) {
      const client = await WsClient.open(`${server.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`);
      sockets.push(client);
      return client;
    },
    async chat(token, text, o = {}) {
      const res = await fetch(`${server.url}/api/ai/chat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text, now: o.now ?? clock.now, tz: o.tz ?? 'Asia/Bangkok' }),
      });
      if (res.status !== 200) throw new Error(`chat failed: ${res.status} ${await res.text()}`);
      if (!res.headers.get('content-type')?.includes('text/event-stream')) throw new Error('chat did not answer with an event stream');
      return parseSse(await res.text());
    },
    async close() {
      for (const s of sockets) s.terminate();
      await server.stop();
    },
  };
  open.push(harness);
  return harness;
}

/** The `name=value` pairs of a response's Set-Cookie headers, ready to send back as a Cookie header. */
export function cookiesFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** afterEach(closeAll): every server a test booted is stopped. */
export async function closeAll(): Promise<void> {
  await Promise.all(open.splice(0).map((h) => h.close()));
}

export function parseSse(text: string): ChatEvent[] {
  return text
    .split(/\n\n+/)
    .map((frame) => frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n'))
    .filter(Boolean)
    .map((data) => JSON.parse(data) as ChatEvent);
}

// ---- WebSocket client -------------------------------------------------------

export class WsClient {
  readonly #ws: WebSocket;
  readonly #queue: WsServerMsg[] = [];
  readonly #waiters: { test: (m: WsServerMsg) => boolean; resolve: (m: WsServerMsg) => void }[] = [];
  closeCode: number | null = null;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as WsServerMsg;
      const waiter = this.#waiters.findIndex((w) => w.test(msg));
      if (waiter !== -1) this.#waiters.splice(waiter, 1)[0].resolve(msg);
      else this.#queue.push(msg);
    });
    ws.on('close', (code) => {
      this.closeCode = code;
    });
  }

  static open(url: string): Promise<WsClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new WsClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  /** The oldest unread message of type `t` (waits for one if needed). Earlier messages of other types stay queued. */
  take<T extends WsServerMsg['t']>(t: T, timeoutMs = 2000): Promise<Extract<WsServerMsg, { t: T }>> {
    const test = (m: WsServerMsg): boolean => m.t === t;
    const at = this.#queue.findIndex(test);
    if (at !== -1) return Promise.resolve(this.#queue.splice(at, 1)[0] as Extract<WsServerMsg, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "${t}" message within ${timeoutMs} ms`)), timeoutMs);
      this.#waiters.push({
        test,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<WsServerMsg, { t: T }>);
        },
      });
    });
  }

  /** Everything received and not yet taken, in arrival order. */
  get unread(): WsServerMsg[] {
    return [...this.#queue];
  }

  /** Resolves true if no message of type `t` shows up within `ms`. */
  async quiet(t: WsServerMsg['t'], ms = 150): Promise<boolean> {
    await new Promise((r) => setTimeout(r, ms));
    return !this.#queue.some((m) => m.t === t);
  }

  send(msg: WsClientMsg | Record<string, unknown> | string): void {
    this.#ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.#ws.readyState === WebSocket.CLOSED) return resolve();
      this.#ws.once('close', () => resolve());
      this.#ws.close();
    });
  }

  closed(): Promise<number> {
    return new Promise((resolve) => {
      if (this.closeCode != null) return resolve(this.closeCode);
      this.#ws.once('close', (code) => resolve(code));
    });
  }

  terminate(): void {
    this.#ws.terminate();
  }
}

// ---- saves ------------------------------------------------------------------

export function makeState(over: Partial<SaveState> = {}): SaveState {
  return {
    v: 1,
    owner: { name: 'Mina', onboarded: true },
    sidekicks: [{ id: 'sk1', name: 'Ember', look: { species: 'fox', ...SPECIES_INFO.fox.look }, outfit: {} }],
    active: 'sk1',
    progress: {
      coins: 120, gems: 3, xp: 40, level: 2, streakDays: 4, streakLast: '2026-11-09',
      tasksDone: 12, focusMin: 90, fed: 5, adsToday: 0, adsDay: '2026-11-10',
    },
    inventory: { apple: 2 },
    wardrobe: [],
    garden: { unlocked: false, items: [] },
    quests: { day: '2026-11-10', daily: [], week: '2026-W46', weekly: [] },
    tasks: [],
    reminders: [],
    plan: null,
    settings: {
      sfx: 0.8, ambience: 0.5, voice: true, notifyDueSoon: true, notifyDaily: true, dailyAt: '07:30',
      quality: 'auto', reduceMotion: false, tz: 'Asia/Bangkok', desktopAuto: true,
    },
    pet: { hunger: 70, joy: 80, energy: 60, at: T0 },
    chat: [],
    premium: { plus: false },
    stamps: {},
    ...over,
  };
}

export function makeTask(over: Partial<Task> & { id: string; title: string }): Task {
  return { source: 'manual', done: false, createdAt: T0 - DAY, updatedAt: T0 - DAY, ...over };
}

export interface TestSubscription {
  /** what the browser would POST to /api/push/subscribe */
  json: { endpoint: string; keys: { p256dh: string; auth: string } };
  /** decrypt a push message body the way the browser's push service worker would receive it */
  open(body: string | Uint8Array): unknown;
}

// web-push's own encryption library, resolved from web-push so it is found wherever web-push is
const ece = createRequire(createRequire(import.meta.url).resolve('web-push'))('http_ece') as {
  decrypt(body: Buffer, params: { version: string; privateKey: ECDH; authSecret: string }): Buffer;
};

/** A push subscription with real key material, as a browser would produce. */
export function makeSubscription(endpoint: string): TestSubscription {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16).toString('base64url');
  return {
    json: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth } },
    open: (body) => JSON.parse(ece.decrypt(Buffer.from(body as Uint8Array), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString('utf8')),
  };
}

// ---- a scripted Anthropic API -----------------------------------------------

export type FakeBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  /** a tool call whose input arrives as this exact string (for malformed JSON) */
  | { type: 'tool_use_raw'; id: string; name: string; json: string }
  | { type: 'fallback'; from: string; to: string; category?: string | null };

export interface FakeMessage {
  content: FakeBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn';
  stop_details?: { type: 'refusal'; category: string | null; explanation: string | null } | null;
  model?: string;
  /** per-attempt usage entries, as the API reports them when a fallback model served the turn */
  iterations?: { type: 'message' | 'fallback_message'; model: string }[];
}

export interface AnthropicRequest {
  body: Record<string, any>;
  headers: Headers;
  url: URL;
}

export interface FakeAnthropic {
  client: Anthropic;
  requests: AnthropicRequest[];
}

const sse = (event: Record<string, unknown>): string => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;

function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

/** The Messages API streaming wire format for one assistant message. */
export function messageStream(message: FakeMessage, index = 0): Response {
  const model = message.model ?? 'claude-opus-5-5';
  const usage = { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let out = sse({
    type: 'message_start',
    message: { id: `msg_test_${index}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage },
  });
  message.content.forEach((block, i) => {
    if (block.type === 'text') {
      out += sse({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
      for (const piece of chunks(block.text, 7)) out += sse({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: piece } });
    } else if (block.type === 'thinking') {
      // thinking text is omitted by default; only the signature streams
      out += sse({ type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '', signature: '' } });
      out += sse({ type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: block.signature ?? `sig_${index}_${i}` } });
    } else if (block.type === 'tool_use' || block.type === 'tool_use_raw') {
      out += sse({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      const raw = block.type === 'tool_use' ? JSON.stringify(block.input) : block.json;
      for (const piece of chunks(raw, 11)) out += sse({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: piece } });
    } else {
      out += sse({
        type: 'content_block_start',
        index: i,
        content_block: { type: 'fallback', from: { model: block.from }, to: { model: block.to }, trigger: { type: 'refusal', category: block.category ?? null } },
      });
    }
    out += sse({ type: 'content_block_stop', index: i });
  });
  out += sse({
    type: 'message_delta',
    delta: { stop_reason: message.stop_reason, stop_sequence: null, stop_details: message.stop_details ?? null },
    usage: {
      output_tokens: 42,
      ...(message.iterations
        ? { iterations: message.iterations.map((it) => ({ ...it, input_tokens: 100, output_tokens: 42, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })) }
        : {}),
    },
  });
  out += sse({ type: 'message_stop' });
  return new Response(out, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': `req_test_${index}` } });
}

/**
 * A real Anthropic SDK client whose transport is scripted: the n-th request to the Messages
 * API gets the n-th entry of `script` (a message to stream, a ready Response, or a function
 * of the request). Requests are recorded so tests can assert on what was sent.
 */
export function fakeAnthropic(script: (FakeMessage | Response | ((req: AnthropicRequest) => FakeMessage | Response))[]): FakeAnthropic {
  const requests: AnthropicRequest[] = [];
  const transport = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const recorded: AnthropicRequest = {
      url: new URL(request.url),
      headers: request.headers,
      body: JSON.parse(await request.text()) as Record<string, any>,
    };
    const index = requests.push(recorded) - 1;
    const entry = script[index];
    if (!entry) return json({ type: 'error', error: { type: 'invalid_request_error', message: 'the test script has no more replies' } }, 400);
    const reply = typeof entry === 'function' ? entry(recorded) : entry;
    return reply instanceof Response ? reply : messageStream(reply, index);
  };
  const client = new Anthropic({ apiKey: 'sk-test-not-a-real-key', baseURL: 'https://anthropic.test', fetch: transport as typeof fetch, maxRetries: 0 });
  return { client, requests };
}
