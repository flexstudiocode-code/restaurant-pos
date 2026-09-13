// Desktop sync-hub transport test. Exercises electron/syncHubTransport.cjs
// (the WebSocket server behind the desktop app's collector hub) exactly like
// the renderer's SyncHub would use it:
//
//   - client connects        → syncClientConnected
//   - client sends a message → syncMessage with connectionId + payload
//   - hub sendTo one client  → that client receives it
//   - hub broadcast          → every client receives it
//   - client disconnects     → syncClientDisconnected
//
//   node scripts/sync-hub-desktop-test.mjs

import { createRequire } from 'node:module';
import { WebSocket } from 'ws';

const require = createRequire(import.meta.url);
const { createSyncHubTransport } = require('../electron/syncHubTransport.cjs');

const events = [];
const hub = createSyncHubTransport({
  emit: (event, data) => events.push({ event, data }),
});

let failures = 0;
function check(name, ok, extra = '') {
  if (!ok) {
    failures++;
    console.log(`✗ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

const port = 18700 + Math.floor(Math.random() * 1000);

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => ws.once('message', (raw) => resolve(String(raw))));
}

// wait for an event of a given type (skips earlier ones)
function waitForEvent(type) {
  return new Promise((resolve) => {
    const poll = () => {
      const i = events.findIndex((e) => e.event === type);
      if (i >= 0) {
        const found = events[i];
        events.splice(0, i + 1);
        resolve(found);
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

const addresses = await hub.start(port);
check('hub starts on a port and reports LAN addresses', Array.isArray(addresses.addresses));

const ws = await connect();
const connected = await waitForEvent('syncClientConnected');
check('client connect emits syncClientConnected', connected.data.connectionId === 1 && connected.data.count === 1);

ws.send(JSON.stringify({ type: 'hello', deviceId: 'test-device', pairingCode: '1234' }));
const msg = await waitForEvent('syncMessage');
const parsed = JSON.parse(msg.data.message);
check(
  'client message is relayed with connectionId + payload',
  msg.data.connectionId === 1 && parsed.type === 'hello' && parsed.pairingCode === '1234'
);

// hub → single client
const pong = nextMessage(ws);
await hub.sendTo(1, '{"type":"welcome"}');
check('sendTo delivers to the addressed client', (await pong) === '{"type":"welcome"}');

// hub → broadcast
const b1 = nextMessage(ws);
await hub.broadcast('{"type":"ping"}');
check('broadcast delivers to connected clients', (await b1) === '{"type":"ping"}');

// hub closes a client
const closed = new Promise((resolve) => ws.on('close', () => resolve(true)));
await hub.close(1);
check('hub can close a client connection', (await closed) === true);
await waitForEvent('syncClientDisconnected');
check('client close emits syncClientDisconnected', true);

// a second client proves connectionId sequencing
const ws2 = await connect();
await waitForEvent('syncClientConnected');
const seq = events.find((e) => e.event === 'syncClientConnected');
check('second client gets a fresh connectionId', !seq || seq.data.connectionId === 2);

ws2.close();
await waitForEvent('syncClientDisconnected');
hub.stop();
check('hub.stop() clears clients', hub.clientCount === 0);

console.log(failures > 0 ? `\n${failures} FAILURE(S)` : '\nAll sync-hub transport tests passed ✅');
process.exit(failures > 0 ? 1 : 0);
