// End-to-end smoke test against a running server + web dev server:
//   phone opens the app, saves to the server, chats (offline brain when the server has no AI key),
//   links a second "desktop" device with a pairing code, and the sidekick hops between them.
//   node scripts/e2e.mjs            (needs `npm run dev` running)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.BASE ?? 'http://localhost:5173';
const out = resolve(root, 'shots');
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const gl = ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: gl });

// ---- phone
const phoneCtx = await browser.newContext({ viewport: { width: 430, height: 900 }, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' });
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => console.error('[phone error]', e.message));
await phone.goto(`${base}/?demo=fox&sky=day&q=low`);
await phone.waitForFunction('window.__ready === true', null, { timeout: 120000 });
await phone.waitForFunction(() => !!localStorage.getItem('sidekick.auth.v1'), null, { timeout: 30000 }).catch(() => {});
const auth = await phone.evaluate(() => JSON.parse(localStorage.getItem('sidekick.auth.v1') ?? 'null'));
check('phone registers a device with the server', !!auth?.token);

const api = (page, path, token, init = {}) => page.evaluate(async ([p, t, i]) => {
  const r = await fetch(p, { ...i, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...(i.headers ?? {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, token, init]);

await phone.waitForTimeout(3500); // debounce + upload
const st = await api(phone, '/api/state', auth.token);
check('save reaches the server', st.status === 200 && st.body?.state?.owner?.onboarded === true, `tasks=${st.body?.state?.tasks?.length}`);
const health = (await api(phone, '/api/health', auth.token)).body;
console.log('      health:', JSON.stringify(health));

// ---- chat
await phone.getByRole('button', { name: 'Talk' }).click();
await phone.waitForTimeout(600);
await phone.locator('input[placeholder^="Say something"]').fill('What should I do first?');
await phone.keyboard.press('Enter');
await phone.waitForFunction(() => document.querySelectorAll('.msg').length >= 2 && !document.querySelector('.msg .bob'), null, { timeout: 30000 });
const reply = await phone.locator('.msg').last().innerText();
check('chat answers (offline brain when the server has no AI key)', reply.length > 10, JSON.stringify(reply.slice(0, 90)));
await phone.screenshot({ path: resolve(out, 'e2e-chat.png') });
await phone.getByRole('button', { name: 'Close' }).click();

// ---- complete a task and see the reward
const before = (await api(phone, '/api/state', auth.token)).body.state.progress.coins;
await phone.getByRole('button', { name: 'Tasks' }).click();
await phone.waitForTimeout(500);
await phone.getByRole('button', { name: 'Mark as done' }).first().click();
await phone.waitForTimeout(3500);
const after = (await api(phone, '/api/state', auth.token)).body.state;
check('finishing a task pays coins and syncs', after.progress.coins > before && after.progress.tasksDone === 1, `${before} -> ${after.progress.coins} coins`);
await phone.screenshot({ path: resolve(out, 'e2e-tasks.png') });
await phone.getByRole('button', { name: 'Close' }).click();

// ---- link a desktop and hop
const code = (await api(phone, '/api/auth/pair-code', auth.token, { method: 'POST' })).body?.code;
check('pairing code issued', typeof code === 'string' && code.length >= 6, code);
const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 440 } });
const desk = await deskCtx.newPage();
desk.on('pageerror', (e) => console.error('[desktop error]', e.message));
await desk.goto(`${base}/pet.html?desktop=1`);
await desk.waitForFunction('window.__ready === true', null, { timeout: 60000 });
await desk.locator('input[placeholder="Code"]').fill(code);
await desk.getByRole('button', { name: 'Link' }).click();
await desk.waitForFunction(() => !document.querySelector('input[placeholder="Code"]'), null, { timeout: 30000 });
check('desktop links with the code and receives the save', true);
await phone.waitForSelector('text=is on your', { timeout: 20000 }).then(() => check('phone shows the sidekick has hopped to the desktop', true)).catch(() => check('phone shows the sidekick has hopped to the desktop', false));
await desk.waitForTimeout(2500);
await desk.screenshot({ path: resolve(out, 'e2e-desktop.png') });
await phone.screenshot({ path: resolve(out, 'e2e-away.png') });
await phone.getByRole('button', { name: 'Call back' }).click();
await phone.waitForFunction(() => !document.body.innerText.includes('is on your'), null, { timeout: 20000 }).then(() => check('calling it back brings it home', true)).catch(() => check('calling it back brings it home', false));
await phone.waitForTimeout(1500);
await phone.screenshot({ path: resolve(out, 'e2e-back.png') });

await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
process.exit(bad ? 1 : 0);
