// Entry point: `tsx src/index.ts` (npm run start -w server).
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './app.ts';
import { REPO_ROOT } from './config.ts';

// A .env at the repository root is picked up without extra flags. Variables that are
// already set in the environment win over the file.
const envFile = path.join(REPO_ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const running = await startServer();
const { config, ai, log } = running.ctx;

const on = (flag: boolean): string => (flag ? 'on' : 'off');
log.info(`Sidekick server ${running.ctx.version} listening on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${running.port}`);
log.info(
  `  public URL ${config.publicUrl} | AI ${on(ai != null)}${ai ? ` (${config.ai.model})` : ''} | Google ${on(config.google != null)}` +
    ` | Microsoft ${on(config.microsoft != null)} | billing ${on(config.stripe != null)} | web client ${on(fs.existsSync(path.join(config.staticDir ?? '', 'index.html')))}`,
);

// One request going wrong in an unforeseen way should not take the whole server down.
process.on('unhandledRejection', (reason) => {
  log.error(`unhandled rejection (${reason instanceof Error ? reason.name : typeof reason})`);
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void running.stop().finally(() => process.exit(0));
  });
}
