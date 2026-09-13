// WebSocket transport for the LAN sync hub (desktop app).
//
// Pure transport: accepts WebSocket clients and relays messages to the app
// logic through the `emit` callback. The app's SyncHub (in the renderer) owns
// the protocol — pairing code, welcome snapshot, invoice renumbering. This
// module has no idea what the messages mean, which keeps it testable in plain
// Node (see scripts/sync-hub-desktop-test.mjs).
//
// Events emitted:
//   { event: 'syncClientConnected',    data: { connectionId, count } }
//   { event: 'syncClientDisconnected', data: { connectionId, count } }
//   { event: 'syncMessage',            data: { connectionId, message } }

const { WebSocketServer } = require('ws');
const os = require('node:os');

/** IPv4 LAN addresses of this machine (excluding loopback). */
function lanAddresses() {
  const out = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

function createSyncHubTransport({ emit }) {
  let wss = null;
  let started = false;
  let nextId = 1;
  const clients = new Map(); // connectionId -> ws

  return {
    get clientCount() {
      return clients.size;
    },

    /** Start listening on `port` (0.0.0.0). Resolves with LAN addresses. */
    start(port) {
      if (wss && started) return Promise.resolve({ addresses: lanAddresses() });
      return new Promise((resolve, reject) => {
        let server;
        try {
          server = new WebSocketServer({ port, host: '0.0.0.0' });
        } catch (err) {
          reject(err);
          return;
        }
        wss = server;
        server.on('error', (err) => {
          if (!started) {
            wss = null;
            reject(err);
          } else {
            console.error('[hub] server error:', err.message);
          }
        });
        server.on('listening', () => {
          started = true;
          resolve({ addresses: lanAddresses() });
        });
        server.on('connection', (ws) => {
          const id = nextId++;
          clients.set(id, ws);
          emit('syncClientConnected', { connectionId: id, count: clients.size });
          ws.on('message', (raw) => {
            emit('syncMessage', { connectionId: id, message: String(raw) });
          });
          ws.on('close', () => {
            if (clients.get(id) === ws) clients.delete(id);
            emit('syncClientDisconnected', { connectionId: id, count: clients.size });
          });
          ws.on('error', () => {
            /* close follows */
          });
        });
      });
    },

    stop() {
      started = false;
      for (const ws of clients.values()) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
      if (wss) {
        wss.close();
        wss = null;
      }
    },

    broadcast(message) {
      for (const ws of clients.values()) {
        if (ws.readyState === ws.OPEN) ws.send(message);
      }
    },

    sendTo(connectionId, message) {
      const ws = clients.get(connectionId);
      if (ws && ws.readyState === ws.OPEN) ws.send(message);
    },

    close(connectionId) {
      const ws = clients.get(connectionId);
      if (ws) ws.close();
    },
  };
}

module.exports = { createSyncHubTransport, lanAddresses };
