// Screenshot harness for visual QA.
//   node scripts/shots.mjs sheet:nature sheet:animals app            -> shots/*.png
//   node scripts/shots.mjs "sheet:trees?yaw=20" --w 1400 --h 900
// Needs the web dev server running (npm run dev:web).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright may be installed globally (NODE_PATH), which only CommonJS resolution honours.
const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const W = Number(opt('w', 1280)), H = Number(opt('h', 860)), base = opt('base', 'http://localhost:5173');
const out = resolve(root, opt('out', 'shots'));
const wait = Number(opt('wait', 0));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });

for (const target of args) {
  const [kind, rest = ''] = target.split(':');
  const [name, query = ''] = rest.split('?');
  const url = kind === 'sheet' ? `${base}/sheet.html?set=${name}${query ? '&' + query : ''}` : `${base}/${kind === 'app' ? '' : kind + '.html'}${rest ? '?' + rest : ''}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
  if (wait) await page.waitForTimeout(wait);
  const file = resolve(out, `${kind}${name ? '-' + name.replace(/[^\w-]/g, '_') : ''}.png`);
  await page.screenshot({ path: file });
  console.log(`${file}  (${Date.now() - t0} ms)`);
}
await browser.close();
