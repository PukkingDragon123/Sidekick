// Run the server and the web dev server together: `npm run dev`.
import { spawn } from 'node:child_process';

const run = (name, args) => {
  const p = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `[${name}] ${l}\n`).join(''));
  p.stdout.on('data', tag); p.stderr.on('data', tag);
  p.on('exit', (c) => { console.log(`[${name}] exited (${c})`); process.exit(c ?? 0); });
  return p;
};
const kids = [run('server', ['run', 'dev', '-w', 'server']), run('web', ['run', 'dev', '-w', 'web'])];
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { kids.forEach((k) => k.kill(sig)); process.exit(0); });
