// Desktop shell bridge. When the app runs inside the Electron desktop app,
// electron/preload.cjs exposes `window.desktop` — a narrow, whitelisted API
// for the capabilities that need the main process: the LAN sync hub (a
// WebSocket server) and Web Bluetooth device selection. Every other feature
// (billing, IndexedDB, printing, WhatsApp…) works through the normal web APIs.

export interface DesktopBluetoothDevice {
  id: string;
  name: string;
}

export interface DesktopHubEvent {
  event: 'syncClientConnected' | 'syncClientDisconnected' | 'syncMessage';
  data: { connectionId: number; count?: number; message?: string };
}

export interface DesktopPrinterInfo {
  name: string;
  displayName: string;
  status: string;
  isDefault: boolean;
}

/** Response shape of the payment-gateway proxy in the Electron main process. */
export interface GatewayResponse {
  status: number;
  json: { ok?: boolean; error?: string; orderId?: string; method?: string; mode?: string } | null;
  text: string;
}

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  version: string;
  hub: {
    start: (port: number) => Promise<{ addresses: string[] }>;
    stop: () => Promise<void>;
    broadcast: (message: string) => Promise<void>;
    sendTo: (connectionId: number, message: string) => Promise<void>;
    close: (connectionId: number) => Promise<void>;
    onEvent: (cb: (payload: DesktopHubEvent) => void) => () => void;
  };
  bluetooth: {
    onDevices: (cb: (devices: DesktopBluetoothDevice[]) => void) => () => void;
    choose: (deviceId: string) => Promise<boolean>;
  };
  printers: {
    list: () => Promise<DesktopPrinterInfo[]>;
    detectWidth: (printerName: string) => Promise<number | null>;
    printRaw: (printerName: string, base64: string) => Promise<string | null>;
    /** Print a raw ESC/POS payload that already includes the trailing CUT
     *  command — the cut rides in the same byte stream after the raster +
     *  paper feed, so the printer cuts automatically once printing finishes. */
    printAndCut: (printerName: string, base64: string) => Promise<string | null>;
  };
  /** Payment-gateway proxy: fetches the helper server from the main process
   *  (the secure app:// renderer cannot make plain-http fetches). */
  payments: {
    fetch: (url: string, init?: RequestInit) => Promise<GatewayResponse>;
  };
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

/**
 * True when running inside the Electron desktop app. Also true when the URL
 * has `?desktop=1` — a preview flag so the desktop layout can be checked in a
 * plain browser during development.
 */
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.desktop?.isDesktop === true) return true;
  try {
    if (window.location.search.includes('desktop=1')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** The desktop bridge, or null outside Electron. */
export function getDesktop(): DesktopBridge | null {
  return isDesktop() ? window.desktop! : null;
}
