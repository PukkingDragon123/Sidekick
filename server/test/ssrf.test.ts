import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FetchLimitError, SsrfError, assertPublicHttpUrl, createPublicFetch, fetchTransport, isBlockedAddress, normalizeFeedUrl,
} from '../src/integrations/ssrf.ts';
import { boot, closeAll, fakeFetch, makeState } from './helpers.ts';

const servers: http.Server[] = [];

afterEach(async () => {
  await closeAll();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function localServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('address classification', () => {
  test.each([
    '127.0.0.1', '127.8.9.10', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.20', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '192.0.2.10', '198.18.0.1', '224.0.0.251', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456:789a::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::1', 'not-an-ip',
  ])('%s is blocked', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  test.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2a00:1450:4001:81b::200e'])(
    '%s is public',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('URL checks', () => {
  test.each([
    'ftp://example.com/feed.ics', 'file:///etc/passwd', 'gopher://example.com/', 'javascript:alert(1)', 'not a url',
    'http://localhost/feed.ics', 'http://printer/feed.ics', 'http://api.localhost/', 'http://user:pw@example.com/feed.ics',
    'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://017700000001/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.1.2.3:8080/', 'http://0.0.0.0/',
  ])('%s is refused before any request is made', (url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(SsrfError);
  });

  test('ordinary feed links pass, and webcal:// is read as https://', () => {
    expect(assertPublicHttpUrl('https://canvas.example.edu/feeds/calendars/user_abc.ics').hostname).toBe('canvas.example.edu');
    expect(assertPublicHttpUrl('http://8.8.8.8:8080/cal.ics').port).toBe('8080');
    expect(normalizeFeedUrl('webcal://school.example/cal.ics')).toBe('https://school.example/cal.ics');
    expect(normalizeFeedUrl('  WEBCALS://school.example/cal.ics ')).toBe('https://school.example/cal.ics');
  });
});

describe('guarded fetch over an injected transport', () => {
  const publicIp = async () => [{ address: '93.184.216.34', family: 4 as const }];

  test('a host that resolves to a private address is refused and never contacted', async () => {
    const out = fakeFetch(() => new Response('secret'));
    for (const address of ['10.0.0.7', '127.0.0.1', '169.254.169.254', '::1', 'fd00::2']) {
      const guarded = createPublicFetch({ lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }], transport: fetchTransport(out.fetch) });
      await expect(guarded('https://intranet.example.com/cal.ics')).rejects.toThrow(SsrfError);
    }
    expect(out.calls).toHaveLength(0);
  });

  test('one private answer among public ones is enough to refuse (DNS rebinding)', async () => {
    const out = fakeFetch(() => new Response('secret'));
    const guarded = createPublicFetch({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '192.168.0.10', family: 4 }],
      transport: fetchTransport(out.fetch),
    });
    await expect(guarded('https://rebind.example.com/')).rejects.toThrow(SsrfError);
    expect(out.calls).toHaveLength(0);
  });

  test('a name that does not resolve is refused', async () => {
    const guarded = createPublicFetch({
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
      transport: fetchTransport(fakeFetch().fetch),
    });
    await expect(guarded('https://nowhere.example.com/')).rejects.toThrow(/could not be found/);
  });

  test('redirects are followed hop by hop, each one re-checked', async () => {
    const out = fakeFetch((call) => {
      if (call.url.pathname === '/start') return new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/final.ics' } });
      if (call.url.pathname === '/final.ics') return new Response('BEGIN:VCALENDAR');
      if (call.url.pathname === '/to-metadata') return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/' } });
      if (call.url.pathname === '/to-file') return new Response(null, { status: 301, headers: { location: 'file:///etc/passwd' } });
      if (call.url.pathname === '/loop') return new Response(null, { status: 302, headers: { location: '/loop' } });
      return undefined;
    });
    const guarded = createPublicFetch({ lookup: publicIp, transport: fetchTransport(out.fetch) });

    const ok = await guarded('https://school.example.com/start');
    expect(ok.status).toBe(200);
    expect(ok.url).toBe('https://cdn.example.com/final.ics');
    expect(ok.body.toString()).toBe('BEGIN:VCALENDAR');

    await expect(guarded('https://school.example.com/to-metadata')).rejects.toThrow(SsrfError);
    await expect(guarded('https://school.example.com/to-file')).rejects.toThrow(SsrfError);
    expect(out.to('http://169.254.169.254')).toHaveLength(0);
    await expect(guarded('https://school.example.com/loop')).rejects.toMatchObject({ code: 'too_many_redirects' });
  });

  test('responses over the size limit are cut off, with or without a Content-Length', async () => {
    const big = 'x'.repeat(5000);
    const out = fakeFetch((call) =>
      call.url.pathname === '/declared'
        ? new Response(big, { headers: { 'content-length': String(big.length) } })
        : new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } })),
    );
    const guarded = createPublicFetch({ lookup: publicIp, transport: fetchTransport(out.fetch) });
    await expect(guarded('https://school.example.com/declared', { maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' });
    await expect(guarded('https://school.example.com/streamed', { maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' });
    expect((await guarded('https://school.example.com/streamed', { maxBytes: 6000 })).body.length).toBe(5000);
  });

  test('a server that never answers hits the time limit', async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const guarded = createPublicFetch({ lookup: publicIp, transport: fetchTransport(hang) });
    await expect(guarded('https://slow.example.com/', { timeoutMs: 60 })).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('guarded fetch over real sockets', () => {
  test('loopback is refused by the default policy, by name and by address', async () => {
    let hits = 0;
    const base = await localServer((_req, res) => {
      hits += 1;
      res.end('should never be served');
    });
    const guarded = createPublicFetch();
    const port = new URL(base).port;
    await expect(guarded(`http://127.0.0.1:${port}/`)).rejects.toThrow(SsrfError);
    await expect(guarded(`http://localhost:${port}/`)).rejects.toThrow(SsrfError);
    await expect(guarded(`http://[::1]:${port}/`)).rejects.toThrow(SsrfError);
    expect(hits).toBe(0);
  });

  test('the connection goes to the address that was vetted, whatever the name says', async () => {
    const base = await localServer((req, res) => res.end(`host=${req.headers.host}`));
    const port = new URL(base).port;
    // "feeds.example.com" does not exist; the lookup we vetted says where to connect
    const guarded = createPublicFetch({ lookup: async () => [{ address: '127.0.0.1', family: 4 }], isBlocked: () => false });
    const res = await guarded(`http://feeds.example.com:${port}/cal.ics`);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe(`host=feeds.example.com:${port}`);
  });

  test('size limit, time limit and redirect re-checking on the socket path', async () => {
    const base = await localServer((req, res) => {
      if (req.url === '/big') res.end('y'.repeat(50_000));
      else if (req.url === '/hang') return; // never answers
      else if (req.url === '/hop') res.writeHead(302, { location: 'http://10.9.8.7/internal' }).end();
      else if (req.url === '/relative') res.writeHead(307, { location: '/ok' }).end();
      else res.end('fine');
    });
    // a policy that trusts only this test server
    const guarded = createPublicFetch({ isBlocked: (address) => address !== '127.0.0.1' });
    await expect(guarded(`${base}/big`, { maxBytes: 10_000 })).rejects.toMatchObject({ code: 'too_large' });
    await expect(guarded(`${base}/hang`, { timeoutMs: 150 })).rejects.toMatchObject({ code: 'timeout' });
    await expect(guarded(`${base}/hop`)).rejects.toThrow(SsrfError);
    const ok = await guarded(`${base}/relative`);
    expect(ok.body.toString()).toBe('fine');
    expect(ok.url).toBe(`${base}/ok`);
  });
});

describe('through the API', () => {
  test('adding a feed that points inward is refused with a clear error and nothing is stored', async () => {
    const out = fakeFetch(() => new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'));
    const h = await boot({ fetch: out.fetch, lookup: async () => [{ address: '192.168.1.1', family: 4 }] });
    const a = await h.register();
    await h.putState(a.token, makeState());

    for (const url of ['http://127.0.0.1:8787/api/health', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'https://router.example.com/cal.ics']) {
      const res = await h.api('POST', '/api/integrations/ics', { token: a.token, body: { url } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('blocked_url');
    }
    expect(out.calls).toHaveLength(0);
    expect((await h.api('GET', '/api/integrations', { token: a.token })).body.items).toEqual([]);
  });

  test('push endpoints are held to the same rule', async () => {
    const h = await boot();
    const a = await h.register();
    const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
    for (const endpoint of ['https://127.0.0.1/push', 'https://localhost/push', 'http://push.example.com/abc', 'https://10.0.0.3/x']) {
      const res = await h.api('POST', '/api/push/subscribe', { token: a.token, body: { subscription: { endpoint, keys } } });
      expect(res.status).toBe(400);
    }
    expect(h.server.ctx.db.pushSubs(a.accountId)).toEqual([]);
  });
});

test('FetchLimitError carries a machine-readable code', () => {
  expect(new FetchLimitError('timeout', 'slow').code).toBe('timeout');
});
