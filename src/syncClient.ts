import type { AuthSettings, BillingSettings, Category, KOT, MenuItem, Order, RestaurantProfile } from './types';

export type ClientState = 'idle' | 'connecting' | 'connected' | 'error';

export interface WelcomeSnapshot {
  categories: Category[];
  items: MenuItem[];
  billing: BillingSettings;
  profile: RestaurantProfile;
  auth: AuthSettings;
  orders: Order[];
  kots: KOT[];
  invoiceCounter: number;
}

interface ClientCallbacks {
  onWelcome: (snap: WelcomeSnapshot) => void;
  onOrders: (orders: Order[]) => void;
  onKots: (kots: KOT[]) => void;
  onMenu: (categories: Category[], items: MenuItem[]) => void;
  onSettings: (billing: BillingSettings, profile: RestaurantProfile, auth: AuthSettings) => void;
  onCounter: (invoiceCounter: number) => void;
  onStatus: (state: ClientState, error?: string) => void;
}

const DEFAULT_PORT = 8765;

function normalizeAddress(raw: string): string {
  let a = raw.trim().replace(/^ws:\/\//i, '');
  if (a.startsWith('[')) return a; // ipv6 literal with port — leave as-is
  const hasPort = /:\d+$/.test(a);
  return hasPort ? a : `${a}:${DEFAULT_PORT}`;
}

export class SyncClient {
  private ws: WebSocket | null = null;
  private address = '';
  private pairingCode = '';
  private deviceId = '';
  private deviceName = '';
  private role = '';
  private reconnectTimer: number | null = null;
  private reconnectDelay = 2000;
  private manualClose = false;
  private cb: ClientCallbacks;

  constructor(cb: ClientCallbacks) {
    this.cb = cb;
  }

  connect(address: string, pairingCode: string, device: { id: string; name: string; role: string }): void {
    this.manualClose = false;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.address = normalizeAddress(address);
    this.pairingCode = pairingCode;
    this.deviceId = device.id;
    this.deviceName = device.name;
    this.role = device.role;
    this.open();
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
    this.cb.onStatus('idle');
  }

  pushOrders(orders: Order[]): void {
    this.send({ type: 'push-orders', orders });
  }

  pushKots(kots: KOT[]): void {
    this.send({ type: 'push-kots', kots });
  }

  private send(msg: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private open(): void {
    this.cb.onStatus('connecting');
    try {
      const ws = new WebSocket(`ws://${this.address}`);
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectDelay = 2000;
        ws.send(
          JSON.stringify({
            type: 'hello',
            deviceId: this.deviceId,
            name: this.deviceName,
            role: this.role,
            pairingCode: this.pairingCode,
          })
        );
        this.cb.onStatus('connected');
      };
      ws.onmessage = (e) => this.handleMessage(String(e.data));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        if (!this.manualClose) this.scheduleReconnect();
      };
      ws.onerror = () => {
        /* onclose follows */
      };
    } catch {
      this.cb.onStatus('error', 'Could not connect');
      if (!this.manualClose) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    this.cb.onStatus('connecting', 'Reconnecting…');
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  private handleMessage(raw: string): void {
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'welcome':
        this.cb.onWelcome(msg as unknown as WelcomeSnapshot);
        break;
      case 'orders-update':
        if (Array.isArray(msg.orders)) this.cb.onOrders(msg.orders as Order[]);
        break;
      case 'kots-update':
        if (Array.isArray(msg.kots)) this.cb.onKots(msg.kots as KOT[]);
        break;
      case 'menu-update':
        if (Array.isArray(msg.categories) && Array.isArray(msg.items)) {
          this.cb.onMenu(msg.categories as Category[], msg.items as MenuItem[]);
        }
        break;
      case 'settings-update':
        this.cb.onSettings(
          msg.billing as BillingSettings,
          msg.profile as RestaurantProfile,
          msg.auth as AuthSettings
        );
        break;
      case 'counter-correction':
        if (typeof msg.invoiceCounter === 'number') this.cb.onCounter(msg.invoiceCounter);
        break;
    }
  }
}
