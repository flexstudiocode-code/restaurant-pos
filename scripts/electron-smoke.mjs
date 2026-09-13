// Desktop smoke test: boots the Electron app with FLEXPOS_SMOKE_TEST=1 (the
// window stays hidden; main.cjs reports the loaded page title and quits).
// Fails loudly if the main process crashes on startup.
//
//   node scripts/electron-smoke.mjs

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, FLEXPOS_SMOKE_TEST: '1' },
});

child.on('exit', (code) => process.exit(code ?? 0));
