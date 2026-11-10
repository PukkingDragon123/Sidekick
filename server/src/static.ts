// Serves the built web client (web/dist) when it exists, with the single-page-app fallback:
// any GET that is not a file and not the API gets index.html.
import fs from 'node:fs';
import path from 'node:path';
import type { Context } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};

async function fileResponse(c: Context, file: string, cache: string): Promise<Response | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const headers = {
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(stat.size),
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
  };
  if (c.req.method === 'HEAD') return new Response(null, { headers });
  return new Response(await fs.promises.readFile(file), { headers });
}

/** Handler for everything outside /api and /ws. Returns null when there is no built client. */
export async function serveStatic(c: Context, root: string | null): Promise<Response | null> {
  if (!root || (c.req.method !== 'GET' && c.req.method !== 'HEAD')) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(c.req.url).pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, `.${path.posix.normalize(`/${pathname}`)}`);
  // never leave the build directory, whatever the path says
  if (target !== base && !target.startsWith(base + path.sep)) return null;

  if (target !== base) {
    // fingerprinted bundles never change; everything else (index.html, sw.js, manifest) must revalidate
    const immutable = /^\/assets\//.test(pathname) || /\.[0-9a-f]{8,}\.\w+$/i.test(pathname);
    const direct = await fileResponse(c, target, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (direct) return direct;
    // a missing file with an extension is a real 404, not a route of the app
    if (path.extname(pathname)) return null;
  }
  return fileResponse(c, path.join(base, 'index.html'), 'no-cache');
}
