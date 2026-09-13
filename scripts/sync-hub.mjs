// Standalone test hub for the LAN sync client. Mimics the protocol the native
// SyncServerPlugin speaks, so the web client can be exercised in a browser
// without building the Android app:
//
//   node scripts/sync-hub.mjs [port] [pairingCode] [outFile]
//
// Received orders/kots are appended to outFile as JSONL (default: log into
// node_modules/.cache/sync-hub-log.jsonl). Menu changes are logged too.
// Used by the Playwright E2E check: run this, point the app at ws://127.0.0.1:PORT.

import { WebSocketServer } from 'ws';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? 8765);
const pairingCode = process.argv[3] ?? '1234';
const cacheDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const outFile = process.argv[4] ?? join(cacheDir, 'sync-hub-log.jsonl');

function log(entry) {
  appendFileSync(outFile, JSON.stringify(entry) + '\n');
  console.log(`[hub] ${entry.type}`, entry.type === 'push-orders' ? `${entry.orders?.length} order(s)` : entry.type === 'push-kots' ? `${entry.kots?.length} kot(s)` : '');
}

const wss = new WebSocketServer({ port, host: '0.0.0.0' });
console.log(`[hub] listening on ws://0.0.0.0:${port}, pairing code ${pairingCode}`);
console.log(`[hub] log → ${outFile}`);

wss.on('connection', (ws) => {
  console.log('[hub] client connected');
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'hello':
        if (msg.pairingCode !== pairingCode) {
          console.log('[hub] wrong pairing code — closing');
          ws.close();
          return;
        }
        console.log(`[hub] hello from "${msg.name}" (${msg.deviceId}), role=${msg.role}`);
        ws.send(
          JSON.stringify({
            type: 'welcome',
            categories: [],
            items: [],
            billing: {},
            profile: {},
            auth: {},
            orders: [],
            kots: [],
            invoiceCounter: 0,
          })
        );
        break;
      case 'push-orders':
        log({ type: 'push-orders', deviceId: msg.deviceId, at: Date.now(), orders: msg.orders });
        break;
      case 'push-kots':
        log({ type: 'push-kots', deviceId: msg.deviceId, at: Date.now(), kots: msg.kots });
        break;
      default:
        console.log(`[hub] unhandled message type: ${msg.type}`);
    }
  });
  ws.on('close', () => console.log('[hub] client disconnected'));
});

wss.on('error', (e) => {
  console.error('[hub] error:', e.message);
  process.exit(1);
});
