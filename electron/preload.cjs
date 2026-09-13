// Flex POS — Electron preload. Runs in an isolated context and exposes the
// narrow `window.desktop` API to the renderer via contextBridge. The renderer
// never gets Node or full IPC access — only these whitelisted methods.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.env.npm_package_version || '',

  // LAN sync hub transport (see electron/main.cjs → createSyncHub).
  hub: {
    start: (port) => ipcRenderer.invoke('hub:start', port),
    stop: () => ipcRenderer.invoke('hub:stop'),
    broadcast: (message) => ipcRenderer.invoke('hub:broadcast', message),
    sendTo: (connectionId, message) => ipcRenderer.invoke('hub:sendTo', connectionId, message),
    close: (connectionId) => ipcRenderer.invoke('hub:close', connectionId),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('hub:event', listener);
      return () => ipcRenderer.removeListener('hub:event', listener);
    },
  },

  // Web Bluetooth device selection (see main.cjs → installBluetoothHandlers).
  bluetooth: {
    onDevices: (callback) => {
      const listener = (_event, devices) => callback(devices);
      ipcRenderer.on('bluetooth:devices', listener);
      return () => ipcRenderer.removeListener('bluetooth:devices', listener);
    },
    choose: (deviceId) => ipcRenderer.invoke('bluetooth:choose', deviceId),
  },

  // Installed printers + raw ESC/POS output over USB (main.cjs → installPrinterIpc).
  printers: {
    list: () => ipcRenderer.invoke('printers:list'),
    detectWidth: (printerName) => ipcRenderer.invoke('printers:detectWidth', printerName),
    printRaw: (printerName, base64) => ipcRenderer.invoke('printers:printRaw', printerName, base64),
    printAndCut: (printerName, base64) => ipcRenderer.invoke('printers:printAndCut', printerName, base64),
  },

  // Payment-gateway proxy (main.cjs → installPaymentIpc): the app serves
  // over the secure `app://` scheme, so plain-http fetches are blocked as
  // mixed content — route them through the main process instead.
  payments: {
    fetch: (url, init) => ipcRenderer.invoke('payments:fetch', url, init),
  },
});
