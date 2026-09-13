import type { AuthSettings, BillingSettings, Category, KOT, MenuItem, Order, RestaurantProfile } from './types';
import {
  isHubAvailable,
  nativeBroadcast,
  nativeCloseConnection,
  nativeSendTo,
  onNativeEvent,
  startNativeHub,
  stopNativeHub,
} from './syncServer';

export interface HubClientInfo {
  connectionId: number;
  deviceId: string;
  name: string;
  role: string;
}

export interface HubSnapshot {
  categories: Category[];
  items: MenuItem[];
  billing: BillingSettings;
  profile: RestaurantProfile;
  auth: AuthSettings;
  orders: Order[];
  kots: KOT[];
  invoiceCounter: number;
}

interface HubCallbacks {
  getSnapshot: () => HubSnapshot;
  onOrders: (orders: Order[], originDeviceId: string) => void;
  onKots: (kots: KOT[], originDeviceId: string) => void;
  onClientListChange: (clients: HubClientInfo[]) => void;
  onError: (msg: string) => void;
}

export class SyncHub {
  private clients = new Map<number, HubClientInfo>();
  private listeners: { remove: () => void }[] = [];
  private running = false;
  private pairingCode = '';
  private cb: HubCallbacks;

  constructor(cb: HubCallbacks) {
    this.cb = cb;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get clientList(): HubClientInfo[] {
    return [...this.clients.values()];
  }

  async start(port: number, pairingCode: string): Promise<{ addresses: string[] }> {
    if (!isHubAvailable()) {
      throw new Error('The sync hub is only available in the Android app or the desktop app. Use a waiter device to connect to a hub instead.');
    }
    if (this.running) await this.stop();
    this.pairingCode = pairingCode;
    const { addresses } = await startNativeHub(port);
    this.running = true;
    await this.attachListeners();
    return { addresses };
  }

  async stop(): Promise<void> {
    this.detachListeners();
    this.clients.clear();
    this.cb.onClientListChange([]);
    if (this.running) {
      this.running = false;
      await stopNativeHub();
    }
  }

  private async attachListeners(): Promise<void> {
    const add = (name: 'syncClientConnected' | 'syncClientDisconnected' | 'syncMessage', fn: (d: { connectionId: number; count?: number; message?: string }) => void) => {
      void onNativeEvent(name, fn).then((h) => this.listeners.push(h));
    };
    add('syncClientConnected', (d) => {
      if (this.clients.has(d.connectionId)) return;
      this.clients.set(d.connectionId, { connectionId: d.connectionId, deviceId: '', name: 'Waiting for handshake…', role: '' });
      this.cb.onClientListChange(this.clientList);
    });
    add('syncClientDisconnected', (d) => {
      this.clients.delete(d.connectionId);
      this.cb.onClientListChange(this.clientList);
    });
    add('syncMessage', (d) => {
      void this.handleMessage(d.connectionId, d.message ?? '');
    });
  }

  private detachListeners(): void {
    for (const l of this.listeners) l.remove();
    this.listeners = [];
  }

  private async handleMessage(connectionId: number, raw: string): Promise<void> {
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const client = this.clients.get(connectionId);
    if (!client) return;
    switch (msg.type) {
      case 'hello':
        if (msg.pairingCode !== this.pairingCode) {
          await nativeCloseConnection(connectionId);
          return;
        }
        this.clients.set(connectionId, {
          connectionId,
          deviceId: String(msg.deviceId ?? ''),
          name: String(msg.name ?? 'Device'),
          role: String(msg.role ?? ''),
        });
        this.cb.onClientListChange(this.clientList);
        await nativeSendTo(connectionId, JSON.stringify({ type: 'welcome', ...this.cb.getSnapshot() }));
        break;
      case 'push-orders':
        if (Array.isArray(msg.orders)) this.cb.onOrders(msg.orders as Order[], client.deviceId);
        break;
      case 'push-kots':
        if (Array.isArray(msg.kots)) this.cb.onKots(msg.kots as KOT[], client.deviceId);
        break;
    }
  }

  async broadcast(message: object): Promise<void> {
    if (!this.running) return;
    await nativeBroadcast(JSON.stringify(message));
  }

  async sendTo(connectionId: number, message: object): Promise<void> {
    if (!this.running) return;
    await nativeSendTo(connectionId, JSON.stringify(message));
  }
}
