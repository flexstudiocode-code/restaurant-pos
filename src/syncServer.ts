import { Capacitor, registerPlugin } from '@capacitor/core';
import { getDesktop, isDesktop } from './desktop';

export interface SyncServerStatus {
  running: boolean;
  port: number;
  count: number;
  addresses: string[];
}

interface SyncServerPluginNative {
  start(options: { port: number }): Promise<{ running: boolean; port: number; addresses: string[] }>;
  stop(): Promise<void>;
  getStatus(): Promise<SyncServerStatus>;
  broadcast(options: { message: string }): Promise<void>;
  sendTo(options: { connectionId: number; message: string }): Promise<void>;
  close(options: { connectionId: number }): Promise<void>;
  addListener(eventName: string, handler: (data: unknown) => void): Promise<{ remove: () => void }>;
}

const SyncServer = registerPlugin<SyncServerPluginNative>('SyncServer');

/**
 * Can THIS device run the collector hub?
 * - Android app: yes, via the native SyncServer plugin.
 * - Desktop app (Electron): yes, via a WebSocket server in the main process.
 * - Plain browser: no — a browser cannot listen for connections.
 */
/** The desktop bridge's hub transport, or null when not in the Electron app. */
function desktopHub() {
  return getDesktop()?.hub ?? null;
}

export function isHubAvailable(): boolean {
  return Capacitor.isNativePlatform() || (isDesktop() && desktopHub() != null);
}

export async function startNativeHub(port: number): Promise<{ addresses: string[] }> {
  const dh = desktopHub();
  if (dh) {
    const res = await dh.start(port);
    return { addresses: res.addresses };
  }
  const res = await SyncServer.start({ port });
  return { addresses: res.addresses };
}

export async function stopNativeHub(): Promise<void> {
  const dh = desktopHub();
  if (dh) {
    await dh.stop();
    return;
  }
  await SyncServer.stop();
}

export async function nativeBroadcast(message: string): Promise<void> {
  const dh = desktopHub();
  if (dh) {
    await dh.broadcast(message);
    return;
  }
  await SyncServer.broadcast({ message });
}

export async function nativeSendTo(connectionId: number, message: string): Promise<void> {
  const dh = desktopHub();
  if (dh) {
    await dh.sendTo(connectionId, message);
    return;
  }
  await SyncServer.sendTo({ connectionId, message });
}

export async function nativeCloseConnection(connectionId: number): Promise<void> {
  try {
    const dh = desktopHub();
    if (dh) {
      await dh.close(connectionId);
      return;
    }
    await SyncServer.close({ connectionId });
  } catch {
    /* already gone */
  }
}

export async function onNativeEvent(
  eventName: 'syncClientConnected' | 'syncClientDisconnected' | 'syncMessage',
  handler: (data: { connectionId: number; count?: number; message?: string }) => void
): Promise<{ remove: () => void }> {
  const dh = desktopHub();
  if (dh) {
    const remove = dh.onEvent((payload) => {
      if (payload.event === eventName) handler(payload.data);
    });
    return { remove };
  }
  return SyncServer.addListener(eventName, (data) =>
    handler(data as { connectionId: number; count?: number; message?: string })
  );
}
