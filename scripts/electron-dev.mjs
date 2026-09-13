// Desktop development launcher: starts Vite, waits for it to answer, then
// launches Electron against the dev server. Kills both when either exits.
//
//   node scripts/electron-dev.mjs        (port 5173, or VITE_PORT=…)

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // binary path when required outside Electron
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

const PORT = process.env.VITE_PORT || '5173';
const DEV_URL = `http://localhost:${PORT}`;

const vite = spawn(process.execPath, [viteBin, '--port', PORT, '--strictPort', '--host'], {
  stdio: 'inherit',
});

async function waitForServer(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (vite.exitCode !== null) throw new Error('Vite exited before the server was ready');
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

let electron = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (electron && electron.exitCode === null) electron.kill();
  if (vite.exitCode === null) vite.kill();
  process.exit(code);
}

try {
  await waitForServer(DEV_URL);
  console.log(`[desktop] Vite ready at ${DEV_URL} — launching Electron`);
  electron = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
  });
  electron.on('exit', (code) => shutdown(code ?? 0));
} catch (err) {
  console.error(`[desktop] ${err.message}`);
  shutdown(1);
}

vite.on('exit', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
