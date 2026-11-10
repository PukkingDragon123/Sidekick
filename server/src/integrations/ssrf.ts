// Outbound requests to URLs that users give us (calendar feeds, push endpoints).
// Guards against server-side request forgery: http/https only, every address the host
// resolves to must be public, the connection is pinned to the address that was checked,
// redirects are re-checked hop by hop, and the response is bounded in size and time.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export class SsrfError extends Error {
  readonly code = 'blocked_url';
}

export class FetchLimitError extends Error {
  readonly code: 'too_large' | 'timeout' | 'too_many_redirects';

  constructor(code: 'too_large' | 'timeout' | 'too_many_redirects', message: string) {
    super(message);
    this.code = code;
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Lookup = (hostname: string) => Promise<ResolvedAddress[]>;

export interface PublicFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  /** default 5 MB */
  maxBytes?: number;
  /** total time for the whole exchange including redirects; default 10 s */
  timeoutMs?: number;
  /** default 3 for GET, 0 for anything else */
  maxRedirects?: number;
}

export interface PublicResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  /** final URL after redirects */
  url: string;
}

export type PublicFetch = (url: string, opts?: PublicFetchOptions) => Promise<PublicResponse>;

interface HopRequest {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body: Uint8Array | string | undefined;
  maxBytes: number;
  signal: AbortSignal;
}

interface HopResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** Performs one HTTP exchange with `url`, connecting only to one of `addresses`. */
export type Transport = (url: URL, addresses: ResolvedAddress[], req: HopRequest) => Promise<HopResponse>;

// ---- address classification -------------------------------------------------

const blockedV4 = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  blockedV4.addSubnet(prefix, bits, 'ipv4');
}

const blockedV6 = new net.BlockList();
for (const [prefix, bits] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // Teredo and other protocol assignments
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation
  ['5f00::', 16], // segment routing
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local
  ['ff00::', 8], // multicast
] as const) {
  blockedV6.addSubnet(prefix, bits, 'ipv6');
}

/** The 16-bit groups of an IPv6 address, or null if it does not parse. */
function v6Groups(address: string): number[] | null {
  let text = address.split('%')[0];
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    if (net.isIP(dotted[2]) !== 4) return null;
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** IPv4 address carried inside an IPv4-mapped (::ffff:0:0/96) or NAT64 (64:ff9b::/96) address. */
function embeddedV4(groups: number[]): string | null {
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0);
  if (!mapped && !nat64) return null;
  return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
}

/** True for anything that is not a routable public unicast address. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address.split('%')[0]);
  if (family === 4) return blockedV4.check(address, 'ipv4');
  if (family !== 6) return true;
  const groups = v6Groups(address);
  if (!groups) return true;
  const inner = embeddedV4(groups);
  if (inner) return blockedV4.check(inner, 'ipv4');
  return blockedV6.check(groups.map((g) => g.toString(16)).join(':'), 'ipv6');
}

/** Accepts webcal:// links (what "subscribe to calendar" buttons hand out) as https. */
export function normalizeFeedUrl(input: string): string {
  const trimmed = input.trim();
  if (/^webcals?:\/\//i.test(trimmed)) return trimmed.replace(/^webcals?:/i, 'https:');
  return trimmed;
}

/** Syntax-level checks that need no network. Throws SsrfError. */
export function assertPublicHttpUrl(input: string, isBlocked: (address: string) => boolean = isBlockedAddress): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SsrfError('That is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('Only http and https URLs are allowed');
  if (url.username || url.password) throw new SsrfError('URLs with embedded credentials are not allowed');
  const host = hostnameOf(url);
  if (!host) throw new SsrfError('The URL has no host');
  if (net.isIP(host)) {
    if (isBlocked(host)) throw new SsrfError('That address is not reachable from here');
  } else if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) {
    throw new SsrfError('That host is not reachable from here');
  }
  return url;
}

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

export const systemLookup: Lookup = async (hostname) => {
  const found = await dns.promises.lookup(hostname, { all: true });
  return found.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

// ---- transports -------------------------------------------------------------

/** Real sockets, with name resolution replaced by the addresses that were already vetted. */
export const nodeTransport: Transport = async (url, addresses, req) => {
  let lastError: unknown = new Error('No address to connect to');
  for (const target of addresses.slice(0, 3)) {
    try {
      return await requestPinned(url, target, req);
    } catch (err) {
      lastError = err;
      if (req.signal.aborted || err instanceof FetchLimitError) break;
    }
  }
  throw lastError;
};

function requestPinned(url: URL, target: ResolvedAddress, req: HopRequest): Promise<HopResponse> {
  return new Promise<HopResponse>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const pinnedLookup = (
      _hostname: string,
      options: { all?: boolean },
      callback: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void,
    ): void => {
      if (options?.all) callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    };
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: hostnameOf(url),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: req.method,
        headers: { ...req.headers, host: url.host },
        agent: false,
        lookup: pinnedLookup as unknown as net.LookupFunction,
        signal: req.signal,
      },
      (res) => {
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > req.maxBytes) {
          request.destroy();
          reject(new FetchLimitError('too_large', 'The response is too large'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > req.maxBytes) {
            request.destroy();
            reject(new FetchLimitError('too_large', 'The response is too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) if (v != null) headers[k] = Array.isArray(v) ? v.join(', ') : v;
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      },
    );
    request.on('error', reject);
    if (req.body != null) request.write(req.body);
    request.end();
  });
}

/** Routes the exchange through a fetch implementation instead of sockets (tests inject one). */
export function fetchTransport(fetchImpl: typeof fetch): Transport {
  return async (url, _addresses, req) => {
    const res = await fetchImpl(url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      redirect: 'manual',
      signal: req.signal,
    });
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > req.maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new FetchLimitError('too_large', 'The response is too large');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > req.maxBytes) {
          await reader.cancel().catch(() => {});
          throw new FetchLimitError('too_large', 'The response is too large');
        }
        chunks.push(value);
      }
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, headers, body: Buffer.concat(chunks) };
  };
}

// ---- the guarded fetch ------------------------------------------------------

export interface PublicFetchDeps {
  lookup?: Lookup;
  transport?: Transport;
  /** Address policy; the default refuses everything that is not public. */
  isBlocked?: (address: string) => boolean;
}

export function createPublicFetch(deps: PublicFetchDeps = {}): PublicFetch {
  const lookup = deps.lookup ?? systemLookup;
  const transport = deps.transport ?? nodeTransport;
  const isBlocked = deps.isBlocked ?? isBlockedAddress;

  async function vet(url: URL): Promise<ResolvedAddress[]> {
    const host = hostnameOf(url);
    const literal = net.isIP(host);
    if (literal) {
      if (isBlocked(host)) throw new SsrfError('That address is not reachable from here');
      return [{ address: host, family: literal === 6 ? 6 : 4 }];
    }
    let addresses: ResolvedAddress[];
    try {
      addresses = await lookup(host);
    } catch {
      throw new SsrfError('That host could not be found');
    }
    if (!addresses.length) throw new SsrfError('That host could not be found');
    // one private answer among public ones is how DNS rebinding starts: refuse the lot
    if (addresses.some((a) => isBlocked(a.address))) throw new SsrfError('That host is not reachable from here');
    return [...addresses].sort((a, b) => a.family - b.family);
  }

  return async (input, opts = {}) => {
    const method = opts.method ?? 'GET';
    const maxRedirects = opts.maxRedirects ?? (method === 'GET' ? 3 : 0);
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const signal = AbortSignal.timeout(timeoutMs);
    let url = assertPublicHttpUrl(input, isBlocked);
    try {
      for (let hop = 0; ; hop++) {
        const addresses = await vet(url);
        const res = await transport(url, addresses, {
          method,
          headers: opts.headers ?? {},
          body: opts.body,
          maxBytes: opts.maxBytes ?? 5 * 1024 * 1024,
          signal,
        });
        const location = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(res.status) && location && maxRedirects > 0) {
          if (hop >= maxRedirects) throw new FetchLimitError('too_many_redirects', 'Too many redirects');
          let next: URL;
          try {
            next = new URL(location, url);
          } catch {
            throw new SsrfError('The server redirected somewhere invalid');
          }
          url = assertPublicHttpUrl(next.href, isBlocked);
          continue;
        }
        return { status: res.status, headers: res.headers, body: res.body, url: url.href };
      }
    } catch (err) {
      if (signal.aborted && !(err instanceof SsrfError) && !(err instanceof FetchLimitError)) {
        throw new FetchLimitError('timeout', 'The server took too long to answer');
      }
      throw err;
    }
  };
}
