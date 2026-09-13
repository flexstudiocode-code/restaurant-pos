// Meadows Park Restaurant — Electron main process.
//
// Loads the built web app (dist/) over a custom `app://` protocol so the
// absolute asset paths Vite emits keep working, and adds three desktop
// capabilities the browser PWA does not have:
//
//  1. Web Bluetooth thermal printing (the renderer's `navigator.bluetooth`
//     path works in Electron; this process supplies the device chooser and
//     handles pairing PINs).
//  2. External links (WhatsApp `wa.me`, …) open in the system browser.
//  3. The LAN sync HUB: a WebSocket server in this process, bridged to the
//     app's existing SyncHub logic over IPC — so an admin PC can be the
//     collector without the Android app.
//
// Security: renderer runs with contextIsolation + sandbox and no Node access;
// the preload only exposes the narrow `window.desktop` API.

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createSyncHubTransport } = require('./syncHubTransport.cjs');
const { serveFromDist } = require('./serveDist.cjs');
const { rawPrint, rawPrintWithCut, detectPrinterWidth } = require('./rawPrint.cjs');

const APP_SCHEME = 'app';
const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const DIST_DIR = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: 'Meadows Park Restaurant',
    backgroundColor: '#faf7f0',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Smoke test (scripts/electron-smoke.mjs): keep the window hidden, load the
  // app, report the page title, quit. Verifies the main process + protocol
  // wiring without leaving a window open.
  const smoke = !!process.env.FLEXPOS_SMOKE_TEST;
  // E2E (scripts/e2e-smoke.mjs): the window stays hidden and the app keeps
  // running so the test can drive it over the DevTools protocol.
  const e2e = !!process.env.FLEXPOS_E2E_TEST;
  if (!smoke && !e2e) mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (smoke) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log(`[smoke] loaded ${mainWindow.webContents.getURL()}`);
      void mainWindow.webContents
        .executeJavaScript(
          `JSON.stringify({ title: document.title, hasDesktopBridge: typeof window.desktop === 'object' })`
        )
        .then((t) => {
          console.log(`[smoke] ${t}`);
          setTimeout(() => app.quit(), 300);
        });
    });
  }

  // Load the app shell. The shell comes straight from disk (app:// → dist/),
  // so it needs no internet at all; retry a few times if the first load still
  // fails for a machine-local reason (antivirus, transient spooler/network
  // state…), otherwise a single hiccup would leave a permanently blank window.
  const loadShell = () => {
    if (DEV_URL) {
      void mainWindow.loadURL(DEV_URL);
    } else if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      void mainWindow.loadURL(`${APP_SCHEME}://bundle/index.html`);
    } else {
      // dist/ missing: show a helpful message instead of a blank window.
      void mainWindow.loadURL('about:blank');
      mainWindow.webContents.once('did-finish-load', () => {
        void mainWindow?.webContents.executeJavaScript(
          `document.body.innerHTML = '<div style="font-family:system-ui;padding:40px;text-align:center"><h2>dist/ not built</h2><p>Run <code>npm run build</code> first, or start with <code>npm run desktop:dev</code>.</p></div>'`
        );
      });
    }
  };

  let loadAttempts = 0;
  const MAX_LOAD_ATTEMPTS = 5;
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _desc, validatedURL) => {
    // -3 (ERR_ABORTED) = cancelled navigation (redirects, denied links) — not a failure.
    if (errorCode === -3) return;
    // Only retry the app's own shell, never external navigations.
    const isShell = DEV_URL ? validatedURL.startsWith(DEV_URL) : validatedURL.startsWith(`${APP_SCHEME}://`);
    if (!isShell) return;
    if (loadAttempts >= MAX_LOAD_ATTEMPTS) return;
    loadAttempts += 1;
    const delay = 400 * loadAttempts;
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) loadShell();
    }, delay);
  });

  loadShell();

  // ── External links (WhatsApp share, etc.) go to the system browser ─────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(`${APP_SCHEME}://`);
    if (!allowed) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  return mainWindow;
}

// ── Web Bluetooth: device chooser + pairing ────────────────────────────────
// `navigator.bluetooth.requestDevice` in the renderer fires
// `select-bluetooth-device` here; we relay the device list to the renderer,
// which shows the app's own picker modal, and the chosen device id comes back
// over IPC. Pairing PINs (cheap thermal printers commonly use 1234/0000) are
// answered here so no OS dialog interrupts the flow.
const pendingBtChoices = new Map(); // webContents -> (deviceId: string) => void
const pairingAttempts = new Map(); // deviceId -> attempt count

function handleSelectBluetoothDevice(contents, event, deviceList, callback) {
  event.preventDefault();
  pendingBtChoices.set(contents, callback);
  contents.send(
    'bluetooth:devices',
    (deviceList || []).map((d) => ({ id: d.deviceId, name: d.deviceName || d.deviceId }))
  );
}

// Backups/menu exports (Blob downloads) get a native "Save as…" dialog.
// Registered once (not per-window) so macOS window recreation can't double it.
function installDownloadHandler() {
  session.defaultSession.on('will-download', (event, item) => {
    const win = BrowserWindow.fromWebContents(item.getWebContents());
    if (!win) return;
    event.preventDefault();
    const target = dialog.showSaveDialogSync(win, {
      title: 'Save file',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
    if (target) item.setSavePath(target);
    else item.cancel();
  });
}

function installBluetoothHandlers() {
  session.defaultSession.setBluetoothPairingHandler((details, callback) => {
    if (details.pairingKind === 'providePin') {
      const pins = ['1234', '0000', '8888', '1111'];
      const attempt = pairingAttempts.get(details.deviceId) || 0;
      pairingAttempts.set(details.deviceId, attempt + 1);
      callback({ pin: pins[attempt % pins.length] });
    } else {
      callback({ confirmed: true });
    }
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('select-bluetooth-device', (event, deviceList, callback) =>
      handleSelectBluetoothDevice(contents, event, deviceList, callback)
    );
  });

  ipcMain.handle('bluetooth:choose', (_event, deviceId) => {
    const contents = _event.sender;
    const callback = pendingBtChoices.get(contents);
    pendingBtChoices.delete(contents);
    if (typeof callback === 'function') callback(typeof deviceId === 'string' ? deviceId : '');
    return true;
  });
}

// ── USB thermal printing (ESC/POS over the OS print queue) ────────────────
// The desktop app can send raw ESC/POS bytes to an installed USB/thermal
// printer without any native modules. The transport lives in rawPrint.cjs:
// on Windows it talks to the spooler directly (winspool.drv via PowerShell),
// so it works for any installed printer with no sharing/firewall setup; on
// macOS/Linux it pipes bytes through `lp -o raw`. The renderer renders the
// receipt/KOT to the same 1-bit ESC/POS raster used for Bluetooth, so output
// is identical on every printer.

// Electron's PrinterInfo.status is already a string ('idle', 'printing',
// 'paused', 'stopped', 'offline', 'error', 'unavailable') — pass it through
// so the UI can warn about offline/error printers (the old code indexed an
// array with Number(status), which is NaN and always fell back to 'idle').
const PRINTER_STATUS = new Set(['idle', 'printing', 'paused', 'stopped', 'offline', 'error', 'unavailable']);

async function listPrinters() {
  const wc = mainWindow?.webContents;
  if (!wc) return [];
  const printers = await wc.getPrintersAsync();
  return (printers || []).map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    status: typeof p.status === 'string' && PRINTER_STATUS.has(p.status) ? p.status : 'idle',
    isDefault: !!p.isDefault,
  }));
}

function installPrinterIpc() {
  ipcMain.handle('printers:list', () => listPrinters());
  ipcMain.handle('printers:detectWidth', (_e, printerName) =>
    typeof printerName === 'string' && printerName.trim() ? detectPrinterWidth(printerName.trim()) : null
  );
  ipcMain.handle('printers:printRaw', (_e, printerName, base64) => {
    if (typeof printerName !== 'string' || !printerName.trim()) throw new Error('No printer selected');
    if (typeof base64 !== 'string' || base64.length === 0) throw new Error('Nothing to print');
    return rawPrint(printerName.trim(), Buffer.from(base64, 'base64'));
  });
  // Print a raw ESC/POS payload that already includes the trailing CUT
  // command — the cut rides in the same byte stream right after the raster
  // + paper feed, so the printer executes it in order, after the receipt has
  // fully printed (see rawPrint.cjs). No polling, no clipped bills.
  ipcMain.handle('printers:printAndCut', (_e, printerName, base64) => {
    if (typeof printerName !== 'string' || !printerName.trim()) throw new Error('No printer selected');
    if (typeof base64 !== 'string' || base64.length === 0) throw new Error('Nothing to print');
    return rawPrintWithCut(printerName.trim(), Buffer.from(base64, 'base64'));
  });
}

// ── Payment-gateway proxy ──────────────────────────────────────────────────
// The app serves over the secure `app://` scheme (webSecurity: true), where
// plain-http subresource fetches are blocked as mixed content. The payment
// helper server (server/) normally runs on http://localhost on the counter
// PC, so the renderer asks the main process to fetch it instead. Node has no
// mixed-content rules, so this works with any http(s) helper URL.
function installPaymentIpc() {
  ipcMain.handle('payments:fetch', async (_event, url, init) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('Only http(s) URLs are allowed');
    }
    const res = await fetch(url, {
      method: init?.method || 'GET',
      headers: init?.headers || {},
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    return { status: res.status, json, text };
  });
}

// ── LAN sync hub transport ─────────────────────────────────────────────────
// Pure transport (electron/syncHubTransport.cjs): the renderer's SyncHub owns
// the protocol (pairing code, welcome snapshot, invoice renumbering). This
// process just accepts WebSocket clients and relays messages over IPC.
let hub = null;

function installHubIpc() {
  hub = createSyncHubTransport({
    emit: (event, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hub:event', { event, data });
      }
    },
  });
  ipcMain.handle('hub:start', (_e, port) => {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('Port must be 1024–65535');
    return hub.start(p);
  });
  ipcMain.handle('hub:stop', () => hub.stop());
  ipcMain.handle('hub:broadcast', (_e, message) => hub.broadcast(String(message)));
  ipcMain.handle('hub:sendTo', (_e, connectionId, message) => hub.sendTo(Number(connectionId), String(message)));
  ipcMain.handle('hub:close', (_e, connectionId) => hub.close(Number(connectionId)));
}

// ── App lifecycle ──────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Shipped builds: no application menu bar, so Alt+letter shortcuts
    // (Alt+T/D/P…) are free for the app and staff can't open devtools.
    if (app.isPackaged) Menu.setApplicationMenu(null);

    // Serve the app shell straight from disk — no network service, so the
    // desktop app works with WiFi/internet completely off.
    protocol.handle(APP_SCHEME, (request) => serveFromDist(request.url, DIST_DIR));

    createWindow();
    installDownloadHandler();
    installBluetoothHandlers();
    installHubIpc();
    installPrinterIpc();
    installPaymentIpc();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (hub) hub.stop();
  });
}
