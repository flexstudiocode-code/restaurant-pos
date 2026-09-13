import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AuthSettings,
  BillingSettings,
  Category,
  Expense,
  KOT,
  MenuItem,
  MenuItemVariant,
  Order,
  OrderLine,
  OrderType,
  Payment,
  RestaurantProfile,
  Role,
  Screen,
  StaffUser,
  State,
  Tab,
} from './types';
import { DEFAULT_BILL_LAYOUT, uid } from './types';
import { dbGet, dbSet } from './db';
import { seedState, seedItems, seedCategories, MENU_VERSION } from './seed';
import { buildBill } from './gst';
import { todayKey, invoiceLabel } from './format';
import { clamp } from './money';
import { mergeKots, mergeOrders, renumberCollisions } from './syncMerge';
import { businessDayKey, withCounters } from './rollover';

// This module owns the React context provider. A partial HMR update would swap
// the context object while the mounted provider still renders the old one, so
// every consumer would crash with “useStore must be used within StoreProvider”
// and the app would white-screen until a manual reload. invalidate() tells Vite
// to propagate the change instead, which falls back to a full page reload.
if (import.meta.hot) import.meta.hot.invalidate();

const STATE_KEY = 'state-v1';
const SESSION_KEY = 'nellara-user';
const BACKUP_KEY = 'backups';
const MAX_BACKUPS = 10;

interface SessionUser {
  name: string;
  role: Role;
}

interface BackupEntry {
  ts: number;
  label: string; // 'daily' | 'manual'
  state: State;
}

export interface BackupInfo {
  ts: number;
  label: string;
  bills: number; // paid orders in that snapshot
}

export interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'err' | 'info';
}

/** A device connected to this device's sync hub. */
export interface SyncClientInfo {
  connectionId: number;
  deviceId: string;
  name: string;
  role: string;
}

export type SyncClientState = 'idle' | 'connecting' | 'connected' | 'error';

/** Live LAN-sync status, shared between the store and the sync engine/UI. */
export interface SyncState {
  hubRequested: boolean; // user wants this device to run the hub
  hubRunning: boolean; // hub actually started
  hubPort: number;
  hubPairingCode: string;
  hubAddresses: string[];
  hubClients: SyncClientInfo[];
  hubNonce: number; // bump to restart the hub (new port/code)
  clientRequested: boolean; // user wants this device connected to a hub
  clientAddress: string;
  clientPairingCode: string;
  clientNonce: number; // bump to (re)connect
  clientState: SyncClientState;
  clientError: string;
}

export interface SyncCorrection {
  orderId: string;
  invoiceNo: string;
}

interface StoreValue {
  loaded: boolean;
  state: State;
  user: SessionUser | null;
  screen: Screen;
  tab: Tab;
  toasts: Toast[];
  // navigation
  setScreen: (s: Screen) => void;
  setTab: (t: Tab) => void;
  notify: (msg: string, kind?: Toast['kind']) => void;
  // auth
  login: (pin: string) => Role | null;
  logout: () => void;
  // orders
  newOrder: (type: OrderType, tableIndex: number | null) => Order;
  addItem: (orderId: string, itemId: string, qty: number, variantId?: string) => void;
  changeQty: (orderId: string, lineId: string, delta: number) => void;
  setLineNote: (orderId: string, lineId: string, note: string) => void;
  removeLine: (orderId: string, lineId: string) => void;
  sendToKitchen: (orderId: string) => void;
  setDiscount: (orderId: string, paise: number) => void;
  setDeliveryCharge: (orderId: string, paise: number) => void;
  setGstEnabled: (orderId: string, enabled: boolean) => void;
  setCustomerInfo: (orderId: string, info: { name?: string; phone?: string; address?: string }) => void;
  setOrderNote: (orderId: string, note: string) => void;
  splitOrder: (orderId: string, lineIds: string[]) => Order | null;
  repeatOrder: (sourceOrderId: string) => Order | null;
  payOrder: (orderId: string, payments: Payment[]) => string | null;
  voidOrder: (orderId: string, reason: string) => void;
  markKot: (kotId: string, status: 'ready' | 'served') => void;
  // menu & settings
  saveCategory: (c: Category) => void;
  deleteCategory: (id: string) => boolean;
  saveItem: (it: MenuItem) => void;
  deleteItem: (id: string) => void;
  toggleItemAvailable: (id: string) => void;
  updateProfile: (patch: Partial<State['profile']>) => void;
  updateBilling: (patch: Partial<State['billing']>) => void;
  updateGateway: (patch: Partial<State['gateway']>) => void;
  updateAuth: (patch: Partial<State['auth']>) => void;
  updateTableNames: (names: string[]) => void;
  // expenses
  addExpense: (e: { amount: number; category: string; note: string; createdAt: number }) => void;
  deleteExpense: (id: string) => void;
  // data & backups
  importState: (s: State) => void;
  resetToDemo: () => void;
  exportJson: () => void;
  exportMenu: () => void;
  importMenuJson: (data: { categories: Category[]; items: MenuItem[] }) => void;
  snapshotNow: () => void;
  listBackups: () => Promise<BackupInfo[]>;
  restoreBackup: (ts: number) => Promise<void>;
  setAutoBackup: (freq: State['autoBackup']) => void;
  rolloverDay: () => { bills: number; sales: number };
  // lan sync
  sync: SyncState;
  syncSetState: (patch: Partial<SyncState>) => void;
  syncApplyOrders: (orders: Order[]) => { corrections: SyncCorrection[]; counter: number };
  syncApplyKots: (kots: KOT[]) => void;
  syncApplyMenu: (categories: Category[], items: MenuItem[]) => void;
  syncApplySettings: (billing: BillingSettings, profile: RestaurantProfile, auth: AuthSettings) => void;
  syncApplyCounter: (invoiceCounter: number) => void;
}

const StoreContext = createContext<StoreValue | null>(null);


/** Older states stored one PIN per role; migrate them to the named-users list. */
function migrateAuth(auth: AuthSettings): AuthSettings {
  const legacy = auth as AuthSettings & {
    adminPin?: string;
    waiterPin?: string;
    kitchenPin?: string;
  };
  const users: StaffUser[] =
    Array.isArray(auth.users) && auth.users.length > 0
      ? auth.users.map((u) => ({
          id: u.id || u.name,
          name: u.name.trim() || 'Staff',
          pin: String(u.pin),
          role: u.role,
        }))
      : [
          { id: 'u-admin', name: 'Manager', pin: legacy.adminPin ?? '0000', role: 'admin' },
          { id: 'u-waiter', name: 'Waiter', pin: legacy.waiterPin ?? '2222', role: 'waiter' },
          { id: 'u-kitchen', name: 'Kitchen', pin: legacy.kitchenPin ?? '1111', role: 'kitchen' },
        ];
  return { users, settingsPin: legacy.settingsPin ?? '1234' };
}

/** Fill in fields that older saved states may be missing (forward migration). */
function normalizeState(s: State): State {
  const st = withCounters(s);
  // Menu updates ship with the app: if this saved state predates the current
  // bundled menu, replace its categories/items with the fresh seed menu.
  // (Historical orders are unaffected — they snapshot item name/price.)
  const menuVersion = (st as { menuVersion?: number }).menuVersion ?? 0;
  const menuCurrent = menuVersion === MENU_VERSION;
  return {
    ...st,
    menuVersion: MENU_VERSION,
    autoBackup: (st as { autoBackup?: State['autoBackup'] }).autoBackup ?? 'daily',
    auth: migrateAuth(st.auth),
    // Optional online payment gateway (v1.3.x). Disabled by default so
    // existing installs keep working exactly as before until configured.
    gateway: {
      enabled: false,
      keyId: '',
      serverUrl: 'http://localhost:8787',
      ...((st as { gateway?: Partial<State['gateway']> }).gateway ?? {}),
    },
    billing: {
      ...st.billing,
      // v1.2.7: GST is now charged ON TOP of menu prices (exclusive) so the
      // bill total actually includes CGST + SGST. One-time migration for
      // existing installs; the flag keeps a later manual choice (Settings →
      // Billing & GST) intact.
      pricingMode: st.billing.pricingMigrated ? st.billing.pricingMode : 'exclusive',
      pricingMigrated: true,
      // 80mm is the standard POS paper; older states stored the previous
      // 58mm default (or nothing) — move everyone to 80mm.
      thermalWidth: st.billing.thermalWidth === '58' ? '80' : (st.billing.thermalWidth ?? '80'),
      thermalCustomWidth: (st.billing as { thermalCustomWidth?: number }).thermalCustomWidth ?? 80,
      rolloverTime: st.billing.rolloverTime ?? '00:00',
      // v1.2.9: user-customisable bill design. Existing saved states get the
      // default layout merged in so nothing changes until the user edits it.
      billLayout: (() => {
        const savedBl = (st.billing as { billLayout?: Partial<State['billing']['billLayout']> }).billLayout ?? {};
        const merged: State['billing']['billLayout'] = { ...DEFAULT_BILL_LAYOUT, ...savedBl };
        // v1.4.x: fine-grained font size replaced the old small/medium/large
        // chips — carry the old choice over so bills don't silently change.
        if ((savedBl as { fontSizePct?: number }).fontSizePct === undefined) {
          merged.fontSizePct =
            merged.printSize === 'small' ? 88 : merged.printSize === 'large' ? 112 : 100;
        }
        return merged;
      })(),
    },
    // Don't auto-roll over the very first day after an update: only from the
    // next business day onward, so an upgrade never surprises anyone.
    lastRolloverDate: st.lastRolloverDate ?? todayKey(),
    profile: {
      ...st.profile,
      logo: (st.profile as { logo?: string }).logo ?? '',
    },
    expenses: Array.isArray(st.expenses) ? st.expenses : [],
    categories: menuCurrent ? st.categories : seedCategories(),
    items: menuCurrent
      ? (Array.isArray(st.items) ? st.items : []).map((i) => ({
          ...i,
          photo: (i as { photo?: string }).photo ?? '',
          variants: (i as { variants?: MenuItemVariant[] }).variants ?? [],
        }))
      : seedItems(),
    orders: (Array.isArray(st.orders) ? st.orders : []).map((o) => ({
      ...o,
      // v1.5.2: flat delivery charge per order (paise). Older orders treat unknown as 0.
      deliveryCharge: (o as { deliveryCharge?: number }).deliveryCharge ?? 0,
      gstEnabled: (o as { gstEnabled?: boolean }).gstEnabled ?? true,
      customerPhone: (o as { customerPhone?: string }).customerPhone ?? '',
      customerAddress: (o as { customerAddress?: string }).customerAddress ?? '',
      orderNote: (o as { orderNote?: string }).orderNote ?? '',
      updatedAt: (o as { updatedAt?: number }).updatedAt ?? o.createdAt,
    })),
    kots: (Array.isArray(st.kots) ? st.kots : []).map((k) => ({
      ...k,
      orderNote: (k as { orderNote?: string }).orderNote ?? '',
      updatedAt: (k as { updatedAt?: number }).updatedAt ?? k.createdAt,
    })),
  };
}

function loadSession(): SessionUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

async function readBackups(): Promise<BackupEntry[]> {
  try {
    return (await dbGet<BackupEntry[]>(BACKUP_KEY)) ?? [];
  } catch {
    return [];
  }
}

/** Store a snapshot, keeping the newest MAX_BACKUPS. */
async function writeBackup(entry: BackupEntry): Promise<void> {
  const list = await readBackups();
  const next = [entry, ...list].slice(0, MAX_BACKUPS);
  await dbSet(BACKUP_KEY, next);
}

/** Remove today's auto-backups so a fresh one can be taken (after import/reset). */
async function clearDailyBackup(): Promise<void> {
  const list = await readBackups();
  const today = todayKey();
  const next = list.filter((b) => !(b.label !== 'manual' && todayKey(new Date(b.ts)) === today));
  await dbSet(BACKUP_KEY, next);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Is an auto-backup due for the given frequency, based on existing backups? */
async function autoBackupDue(freq: State['autoBackup'], now: Date): Promise<boolean> {
  if (freq === 'off') return false;
  const list = await readBackups();
  const window =
    freq === 'daily' ? DAY_MS : freq === 'weekly' ? 7 * DAY_MS : 30 * DAY_MS;
  return !list.some((b) => b.label === freq && now.getTime() - b.ts < window);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<State>(() => seedState());
  const [user, setUser] = useState<SessionUser | null>(() => loadSession());
  const [screen, setScreen] = useState<Screen>({ name: 'tab' });
  const [tab, setTab] = useState<Tab>('tables');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sync, setSync] = useState<SyncState>({
    hubRequested: false,
    hubRunning: false,
    hubPort: 8765,
    hubPairingCode: '',
    hubAddresses: [],
    hubClients: [],
    hubNonce: 0,
    clientRequested: false,
    clientAddress: '',
    clientPairingCode: '',
    clientNonce: 0,
    clientState: 'idle',
    clientError: '',
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // ── load from IndexedDB + daily auto-backup ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let saved: State | undefined;
      try {
        saved = await dbGet<State>(STATE_KEY);
        if (!cancelled && saved && saved.version === 1) {
          setState(normalizeState(saved));
        }
      } catch {
        // fall back to seed
      }
      // Auto-backup protects against accidental data loss (daily by default).
      if (!cancelled) {
        const base = saved && saved.version === 1 ? saved : seedState();
        try {
          const freq: State['autoBackup'] = base.autoBackup ?? 'daily';
          if (await autoBackupDue(freq, new Date())) {
            await writeBackup({ ts: Date.now(), label: freq, state: base });
          }
        } catch {
          /* backup is best-effort */
        }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Periodic auto-backup check (every 30 min while the app is open), so a
  // weekly/monthly backup is taken even if the app stays open across the due
  // time without a reload.
  useEffect(() => {
    const check = () => {
      const freq = stateRef.current.autoBackup;
      if (freq === 'off') return;
      void autoBackupDue(freq, new Date()).then((due) => {
        if (due) {
          void writeBackup({ ts: Date.now(), label: freq, state: stateRef.current });
        }
      });
    };
    const id = window.setInterval(check, 30 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // ── debounced persistence + flush on unload ────────────────────────────
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void dbSet(STATE_KEY, state);
    }, 400);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state, loaded]);

  const flush = useCallback(() => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void dbSet(STATE_KEY, stateRef.current);
  }, []);
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flush]);

  const apply = useCallback((fn: (s: State) => State) => {
    setState((prev) => withCounters(fn(prev)));
  }, []);

  // ── toasts ─────────────────────────────────────────────────────────────
  const notify = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2600);
  }, []);

  // ── auth ───────────────────────────────────────────────────────────────
  const login = useCallback(
    (pin: string): Role | null => {
      const s = stateRef.current;
      const match = s.auth.users.find((u) => u.pin === pin);
      if (!match) return null;
      const u: SessionUser = { name: match.name, role: match.role };
      setUser(u);
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(u));
      } catch {
        /* ignore */
      }
      setTab(match.role === 'kitchen' ? 'kitchen' : 'tables');
      setScreen({ name: 'tab' });
      return match.role;
    },
    []
  );

  const logout = useCallback(() => {
    flush();
    setUser(null);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    setScreen({ name: 'tab' });
  }, [flush]);

  // ── orders ─────────────────────────────────────────────────────────────
  const newOrder = useCallback(
    (type: OrderType, tableIndex: number | null): Order => {
      const s = stateRef.current;
      // One open order per table.
      if (type === 'dine-in' && tableIndex !== null) {
        const existing = s.orders.find(
          (o) => o.type === 'dine-in' && o.tableIndex === tableIndex && o.status === 'open'
        );
        if (existing) return existing;
      }
      const order: Order = {
        id: uid(),
        invoiceNo: '',
        kotNos: [],
        gstEnabled: true,
        type,
        tableIndex,
        customerName: '',
        customerPhone: '',
        customerAddress: '',
        orderNote: '',
        lines: [],
        discount: 0,
        serviceCharge: 0,
        deliveryCharge: 0,
        status: 'open',
        payments: [],
        createdAt: Date.now(),
        paidAt: null,
        voidReason: '',
        staffName: user?.name ?? 'Staff',
        closedBy: null,
        updatedAt: Date.now(),
      };
      apply((prev) => ({ ...prev, orders: [...prev.orders, order] }));
      return order;
    },
    [apply, user]
  );

  const addItem = useCallback(
    (orderId: string, itemId: string, qty: number, variantId?: string) => {
      const s = stateRef.current;
      const order = s.orders.find((o) => o.id === orderId);
      const item = s.items.find((i) => i.id === itemId);
      if (!order || !item || qty <= 0) return;
      if (order.status !== 'open') return;

      // Resolve the chosen size/portion variant (if any); the line snapshots its label+price.
      const variant = variantId ? item.variants.find((v) => v.id === variantId) : undefined;
      if (variantId && !variant) return;
      const lineName = variant ? `${item.name} (${variant.label})` : item.name;
      const unitPrice = variant ? variant.price : item.price;

      // Stock check: count this item across all open orders.
      let used = 0;
      for (const o of s.orders) {
        if (o.status !== 'open') continue;
        for (const l of o.lines) if (l.itemId === itemId) used += l.qty;
      }
      if (item.stock !== null) {
        const available = item.stock - used;
        if (available <= 0) {
          // Distinguish a genuinely sold-out item from one whose stock is
          // already reserved by other open orders — otherwise the cashier sees
          // “out of stock” for an item that still shows stock in the menu.
          notify(
            item.stock <= 0
              ? `"${item.name}" is out of stock`
              : `"${item.name}": all ${item.stock} already in open orders`,
            'err'
          );
          return;
        }
        qty = Math.min(qty, available);
      }

      apply((prev) => {
        const o = prev.orders.find((x) => x.id === orderId);
        if (!o) return prev;
        // Same item + same variant collapse into one line; different variants stay separate.
        const sameKey = (l: OrderLine) =>
          l.itemId === itemId && (l.variantId ?? '') === (variantId ?? '');
        const existing = o.lines.find(sameKey);
        let lines: OrderLine[];
        if (existing) {
          lines = o.lines.map((l) => (sameKey(l) ? { ...l, qty: l.qty + qty } : l));
        } else {
          lines = [
            ...o.lines,
            {
              id: uid(),
              itemId,
              name: lineName,
              unitPrice,
              qty,
              gstRate: item.gstRate,
              hsn: item.hsn,
              veg: item.veg,
              note: '',
              kotPrinted: false,
              variantId: variant?.id,
            },
          ];
        }
        return {
          ...prev,
          orders: prev.orders.map((x) => (x.id === orderId ? { ...o, lines, updatedAt: Date.now() } : x)),
        };
      });
    },
    [apply, notify]
  );

  const changeQty = useCallback(
    (orderId: string, lineId: string, delta: number) => {
      const s = stateRef.current;
      const order = s.orders.find((o) => o.id === orderId);
      const line = order?.lines.find((l) => l.id === lineId);
      if (!order || !line) return;
      const item = s.items.find((i) => i.id === line.itemId);
      const newQty = clamp(line.qty + delta, 1, 999);
      if (item && item.stock !== null && delta > 0) {
        let used = 0;
        for (const o of s.orders) {
          if (o.status !== 'open') continue;
          for (const l of o.lines)
            if (l.itemId === item.id && l.id !== lineId) used += l.qty;
        }
        const cap = Math.max(1, item.stock - used);
        if (newQty > cap) {
          notify(`Only ${cap} left for "${item.name}"`, 'err');
          return;
        }
      }
      apply((prev) => ({
        ...prev,
        orders: prev.orders.map((o) =>
          o.id === orderId
            ? {
                ...o,
                lines: o.lines.map((l) => (l.id === lineId ? { ...l, qty: newQty } : l)),
                updatedAt: Date.now(),
              }
            : o
        ),
      }));
    },
    [apply, notify]
  );

  const setLineNote = useCallback((orderId: string, lineId: string, note: string) => {
    apply((prev) => ({
      ...prev,
      orders: prev.orders.map((o) =>
        o.id === orderId
          ? { ...o, lines: o.lines.map((l) => (l.id === lineId ? { ...l, note } : l)), updatedAt: Date.now() }
          : o
      ),
    }));
  }, [apply]);

  const removeLine = useCallback((orderId: string, lineId: string) => {
    apply((prev) => ({
      ...prev,
      orders: prev.orders.map((o) =>
        o.id === orderId
          ? { ...o, lines: o.lines.filter((l) => l.id !== lineId), updatedAt: Date.now() }
          : o
      ),
    }));
  }, [apply]);

  const sendToKitchen = useCallback(
    (orderId: string) => {
      const s = stateRef.current;
      const order = s.orders.find((o) => o.id === orderId);
      if (!order || order.status !== 'open') return;
      const pending = order.lines.filter((l) => !l.kotPrinted);
      if (pending.length === 0) {
        notify('No new items to send to kitchen', 'info');
        return;
      }
      if (!s.billing.kotEnabled) {
        // No KOT flow configured: just mark lines as sent.
        apply((prev) => ({
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === orderId
              ? { ...o, lines: o.lines.map((l) => ({ ...l, kotPrinted: true })), updatedAt: Date.now() }
              : o
          ),
        }));
        notify(`${pending.length} item(s) sent to kitchen`, 'ok');
        return;
      }
      const kotNo = s.kotCounter + 1;
      const tableLabel =
        order.type === 'dine-in' && order.tableIndex !== null
          ? `Table ${s.profile.tableNames[order.tableIndex] ?? order.tableIndex + 1}`
          : order.type === 'takeaway'
            ? 'Takeaway'
            : order.customerName
              ? `Delivery – ${order.customerName}`
              : 'Delivery';
      const kot = {
        id: uid(),
        orderId,
        kotNo,
        tableLabel,
        orderType: order.type,
        items: pending.map((l) => ({ name: l.name, qty: l.qty, note: l.note })),
        orderNote: order.orderNote,
        status: 'pending' as const,
        createdAt: Date.now(),
        readyAt: null,
        servedAt: null,
        updatedAt: Date.now(),
      };
      apply((prev) => ({
        ...prev,
        kotCounter: kotNo,
        kots: [...prev.kots, kot],
        orders: prev.orders.map((o) =>
          o.id === orderId
            ? {
                ...o,
                kotNos: [...o.kotNos, `K${String(kotNo).padStart(3, '0')}`],
                lines: o.lines.map((l) => ({ ...l, kotPrinted: true })),
                updatedAt: Date.now(),
              }
            : o
        ),
      }));
      notify(`KOT #${String(kotNo).padStart(3, '0')} sent to kitchen`, 'ok');
    },
    [apply, notify]
  );

  const setDiscount = useCallback((orderId: string, paise: number) => {
    apply((prev) => ({
      ...prev,
      orders: prev.orders.map((o) =>
        o.id === orderId
          ? { ...o, discount: Math.max(0, Math.round(paise)), updatedAt: Date.now() }
          : o
      ),
    }));
  }, [apply]);

  const setDeliveryCharge = useCallback((orderId: string, paise: number) => {
    apply((prev) => ({
      ...prev,
      orders: prev.orders.map((o) =>
        o.id === orderId
          ? { ...o, deliveryCharge: Math.max(0, Math.round(paise)), updatedAt: Date.now() }
          : o
      ),
    }));
  }, [apply]);

  const setGstEnabled = useCallback((orderId: string, enabled: boolean) => {
    apply((prev) => ({
      ...prev,
      orders: prev.orders.map((o) =>
        o.id === orderId ? { ...o, gstEnabled: enabled, updatedAt: Date.now() } : o
      ),
    }));
  }, [apply]);

  const setCustomerInfo = useCallback(
    (orderId: string, info: { name?: string; phone?: string; address?: string }) => {
      apply((prev) => ({
        ...prev,
        orders: prev.orders.map((o) =>
          o.id === orderId
            ? {
                ...o,
                customerName: info.name !== undefined ? info.name : o.customerName,
                customerPhone: info.phone !== undefined ? info.phone : o.customerPhone,
                customerAddress: info.address !== undefined ? info.address : o.customerAddress,
                updatedAt: Date.now(),
              }
            : o
        ),
      }));
    },
    [apply]
  );

  const setOrderNote = useCallback((orderId: string, note: string) => {
    apply((prev) => ({
      ...prev,
      orders: prev.orders.map((o) => (o.id === orderId ? { ...o, orderNote: note, updatedAt: Date.now() } : o)),
    }));
  }, [apply]);

  const splitOrder = useCallback(
    (orderId: string, lineIds: string[]): Order | null => {
      const s = stateRef.current;
      const order = s.orders.find((o) => o.id === orderId);
      if (!order || order.status !== 'open' || order.type !== 'dine-in' || order.tableIndex === null) {
        notify('Only open dine-in orders can be split', 'err');
        return null;
      }
      const moving = order.lines.filter((l) => lineIds.includes(l.id));
      const remaining = order.lines.filter((l) => !lineIds.includes(l.id));
      if (moving.length === 0 || remaining.length === 0) {
        notify('Select some items to move (keep at least one on this bill)', 'err');
        return null;
      }
      const newOrder: Order = {
        ...order,
        id: uid(),
        invoiceNo: '',
        kotNos: [],
        lines: moving,
        discount: 0,
        serviceCharge: 0,
        deliveryCharge: 0,
        status: 'open',
        payments: [],
        createdAt: Date.now(),
        paidAt: null,
        closedBy: null,
        updatedAt: Date.now(),
      };
      apply((prev) => ({
        ...prev,
        orders: [
          ...prev.orders.map((o) =>
            o.id === orderId
              ? { ...o, lines: remaining, discount: 0, payments: o.payments, updatedAt: Date.now() }
              : o
          ),
          newOrder,
        ],
      }));
      notify(`Bill split — ${remaining.length} item(s) here, ${moving.length} on the new bill`, 'ok');
      return newOrder;
    },
    [apply, notify]
  );

  const repeatOrder = useCallback(
    (sourceOrderId: string): Order | null => {
      const s = stateRef.current;
      const source = s.orders.find((o) => o.id === sourceOrderId);
      if (!source || source.lines.length === 0) {
        notify('No items to repeat', 'err');
        return null;
      }
      const copy: Order = {
        ...source,
        id: uid(),
        invoiceNo: '',
        kotNos: [],
        lines: source.lines.map((l) => ({
          ...l,
          id: uid(),
          kotPrinted: false,
          note: '',
        })),
        discount: 0,
        serviceCharge: 0,
        deliveryCharge: 0,
        status: 'open',
        payments: [],
        createdAt: Date.now(),
        paidAt: null,
        closedBy: null,
        voidReason: '',
        staffName: user?.name ?? 'Staff',
        updatedAt: Date.now(),
      };
      apply((prev) => ({ ...prev, orders: [...prev.orders, copy] }));
      notify(`New order created with ${copy.lines.length} item(s)`, 'ok');
      return copy;
    },
    [apply, notify, user]
  );

  const payOrder = useCallback(
    (orderId: string, payments: Payment[]): string | null => {
      const s = stateRef.current;
      const order = s.orders.find((o) => o.id === orderId);
      if (!order || order.status !== 'open') {
        notify('Order is not open', 'err');
        return null;
      }
      const bill = buildBill({
        lines: order.lines,
        discount: order.discount,
        billing: s.billing,
        gstEnabled: order.gstEnabled,
        deliveryCharge: order.deliveryCharge,
      });
      const paid = payments.reduce((sum, p) => sum + p.amount, 0);
      if (paid < bill.payable) {
        notify('Payment amount is less than the bill total', 'err');
        return null;
      }
      const label = invoiceLabel(s.profile.invoicePrefix, s.invoiceCounter + 1);
      apply((prev) => ({
        ...prev,
        invoiceCounter: prev.invoiceCounter + 1,
        orders: prev.orders.map((o) =>
          o.id === orderId
            ? {
                ...o,
                invoiceNo: label,
                status: 'paid',
                paidAt: Date.now(),
                payments,
                discount: bill.discount,
                serviceCharge: bill.serviceCharge,
                deliveryCharge: bill.deliveryCharge,
                closedBy: user?.name ?? 'Staff',
                updatedAt: Date.now(),
              }
            : o
        ),
        items: prev.items.map((it) => {
          if (it.stock === null) return it;
          const qty = order.lines
            .filter((l) => l.itemId === it.id)
            .reduce((sum, l) => sum + l.qty, 0);
          return qty > 0 ? { ...it, stock: Math.max(0, it.stock - qty) } : it;
        }),
      }));
      return label;
    },
    [apply, notify, user]
  );

  const voidOrder = useCallback(
    (orderId: string, reason: string) => {
      const s = stateRef.current;
      const order = s.orders.find((o) => o.id === orderId);
      if (!order) return;
      apply((prev) => ({
        ...prev,
        orders: prev.orders.map((o) =>
          o.id === orderId
            ? { ...o, status: 'void', voidReason: reason, paidAt: o.paidAt, updatedAt: Date.now() }
            : o
        ),
        // Restore stock if the order had been paid.
        items:
          order.status === 'paid'
            ? prev.items.map((it) => {
                if (it.stock === null) return it;
                const qty = order.lines
                  .filter((l) => l.itemId === it.id)
                  .reduce((sum, l) => sum + l.qty, 0);
                return qty > 0 ? { ...it, stock: it.stock + qty } : it;
              })
            : prev.items,
      }));
      notify('Order voided', 'info');
    },
    [apply, notify]
  );

  const markKot = useCallback((kotId: string, status: 'ready' | 'served') => {
    apply((prev) => ({
      ...prev,
      kots: prev.kots.map((k) =>
        k.id === kotId
          ? {
              ...k,
              status,
              readyAt: status === 'ready' ? (k.readyAt ?? Date.now()) : k.readyAt,
              servedAt: status === 'served' ? Date.now() : k.servedAt,
              updatedAt: Date.now(),
            }
          : k
      ),
    }));
  }, [apply]);

  // ── menu & settings ────────────────────────────────────────────────────
  const saveCategory = useCallback(
    (c: Category) => {
      apply((prev) => {
        const exists = prev.categories.some((x) => x.id === c.id);
        return {
          ...prev,
          categories: exists
            ? prev.categories.map((x) => (x.id === c.id ? c : x))
            : [...prev.categories, c],
        };
      });
    },
    [apply]
  );

  const deleteCategory = useCallback(
    (id: string): boolean => {
      const s = stateRef.current;
      if (s.items.some((i) => i.categoryId === id)) return false;
      apply((prev) => ({ ...prev, categories: prev.categories.filter((c) => c.id !== id) }));
      return true;
    },
    [apply]
  );

  const saveItem = useCallback(
    (it: MenuItem) => {
      apply((prev) => {
        const exists = prev.items.some((x) => x.id === it.id);
        return {
          ...prev,
          items: exists
            ? prev.items.map((x) => (x.id === it.id ? it : x))
            : [...prev.items, it],
        };
      });
    },
    [apply]
  );

  const deleteItem = useCallback((id: string) => {
    apply((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }));
  }, [apply]);

  const toggleItemAvailable = useCallback((id: string) => {
    apply((prev) => ({
      ...prev,
      items: prev.items.map((i) => (i.id === id ? { ...i, available: !i.available } : i)),
    }));
  }, [apply]);

  const updateProfile = useCallback((patch: Partial<State['profile']>) => {
    apply((prev) => ({ ...prev, profile: { ...prev.profile, ...patch } }));
  }, [apply]);

  const updateBilling = useCallback((patch: Partial<State['billing']>) => {
    apply((prev) => ({ ...prev, billing: { ...prev.billing, ...patch } }));
  }, [apply]);

  const updateGateway = useCallback((patch: Partial<State['gateway']>) => {
    apply((prev) => ({ ...prev, gateway: { ...prev.gateway, ...patch } }));
  }, [apply]);

  const updateAuth = useCallback((patch: Partial<State['auth']>) => {
    apply((prev) => ({ ...prev, auth: { ...prev.auth, ...patch } }));
  }, [apply]);

  const updateTableNames = useCallback((names: string[]) => {
    apply((prev) => ({ ...prev, profile: { ...prev.profile, tableNames: names } }));
  }, [apply]);

  // ── expenses ───────────────────────────────────────────────────────────
  const addExpense = useCallback(
    (e: { amount: number; category: string; note: string; createdAt: number }) => {
      if (!Number.isFinite(e.amount) || e.amount <= 0) {
        notify('Enter a valid expense amount', 'err');
        return;
      }
      const exp: Expense = {
        id: uid(),
        amount: Math.round(e.amount),
        category: e.category || 'Miscellaneous',
        note: e.note.trim(),
        createdAt: Number.isFinite(e.createdAt) ? e.createdAt : Date.now(),
      };
      apply((prev) => ({ ...prev, expenses: [exp, ...prev.expenses] }));
      notify('Expense recorded', 'ok');
    },
    [apply, notify]
  );

  const deleteExpense = useCallback((id: string) => {
    apply((prev) => ({ ...prev, expenses: prev.expenses.filter((e) => e.id !== id) }));
  }, [apply]);

  // ── data ───────────────────────────────────────────────────────────────
  const importState = useCallback((s: State) => {
    setState(normalizeState({ ...s, version: 1 }));
    void clearDailyBackup(); // let the imported state get a fresh daily backup
    notify('Data imported', 'ok');
  }, [notify]);

  const resetToDemo = useCallback(() => {
    setState(withCounters(seedState()));
    void clearDailyBackup();
    notify('Reset to demo data', 'info');
  }, [notify]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(stateRef.current, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nellara-pos-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Full backup downloaded', 'ok');
  }, [notify]);

  const exportMenu = useCallback(() => {
    const s = stateRef.current;
    const data = { kind: 'nellara-menu', exportedAt: Date.now(), categories: s.categories, items: s.items };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nellara-menu-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Menu exported', 'ok');
  }, [notify]);

  const importMenuJson = useCallback(
    (data: { categories: Category[]; items: MenuItem[] }) => {
      if (!Array.isArray(data.categories) || !Array.isArray(data.items)) {
        notify('Not a valid menu file', 'err');
        return;
      }
      // Keep only items whose category exists (or is created) to avoid orphans.
      const cats = data.categories.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string');
      const catIds = new Set(cats.map((c) => c.id));
      const items = data.items
        .filter(
          (i) =>
            i &&
            typeof i.id === 'string' &&
            typeof i.name === 'string' &&
            typeof i.price === 'number' &&
            catIds.has(i.categoryId)
        )
        .map((i) => ({
          ...i,
          photo: (i as { photo?: string }).photo ?? '',
          variants: (i as { variants?: MenuItemVariant[] }).variants ?? [],
        }));
      if (cats.length === 0 || items.length === 0) {
        notify('Menu file has no valid categories/items', 'err');
        return;
      }
      apply((prev) => ({ ...prev, categories: cats, items }));
      notify(`Menu imported (${cats.length} categories, ${items.length} items)`, 'ok');
    },
    [apply, notify]
  );

  const snapshotNow = useCallback(() => {
    void writeBackup({ ts: Date.now(), label: 'manual', state: stateRef.current }).then(() => {
      notify('Manual backup saved', 'ok');
    });
  }, [notify]);

  const listBackups = useCallback(async (): Promise<BackupInfo[]> => {
    const list = await readBackups();
    return list.map((b) => ({
      ts: b.ts,
      label: b.label,
      bills: b.state.orders.filter((o) => o.status === 'paid').length,
    }));
  }, []);

  const restoreBackup = useCallback(
    async (ts: number): Promise<void> => {
      const list = await readBackups();
      const entry = list.find((b) => b.ts === ts);
      if (!entry) {
        notify('Backup not found', 'err');
        return;
      }
      setState(normalizeState({ ...entry.state, version: 1 }));
      // The restored state may be older than today's auto-backup; make sure a
      // fresh auto backup of the CURRENT state is taken on next load.
      await clearDailyBackup();
      notify(`Restored backup from ${new Date(ts).toLocaleString('en-IN')}`, 'ok');
    },
    [notify]
  );

  const setAutoBackup = useCallback(
    (freq: State['autoBackup']) => {
      apply((prev) => ({ ...prev, autoBackup: freq }));
      notify(
        freq === 'off'
          ? 'Auto-backup turned off'
          : `Auto-backup set to ${freq}`,
        'ok'
      );
    },
    [apply, notify]
  );

  /** End-of-day for `newDay`: EOD snapshot, close open orders, reset counters. */
  const doRollover = useCallback(
    (newDay: string): { bills: number; sales: number } => {
      const s = stateRef.current;
      const todayBills = s.orders.filter(
        (o) => o.status === 'paid' && o.paidAt !== null && todayKey(new Date(o.paidAt)) === todayKey()
      );
    const sales = todayBills.reduce(
      (sum, o) =>
        sum +
        buildBill({ lines: o.lines, discount: o.discount, billing: s.billing, gstEnabled: o.gstEnabled })
          .payable,
      0
    );
      // EOD snapshot of the current state BEFORE the reset, so the day is recoverable.
      void writeBackup({ ts: Date.now(), label: 'manual', state: s });
      // Counters only reset if they're actually behind the new day (a manual
      // early rollover already advanced them — don't zero them again).
      const resetInvoice = s.invoiceCounterDate < newDay;
      const resetKot = s.kotCounterDate < newDay;
      apply((prev) => ({
        ...prev,
        invoiceCounter: resetInvoice ? 0 : prev.invoiceCounter,
        invoiceCounterDate: newDay,
        kotCounter: resetKot ? 0 : prev.kotCounter,
        kotCounterDate: newDay,
        lastRolloverDate: newDay,
        orders: prev.orders.map((o) =>
          o.status === 'open'
            ? { ...o, status: 'void' as const, voidReason: 'End of day rollover', updatedAt: Date.now() }
            : o
        ),
      }));
      notify(
        `New day started — invoice & KOT numbers restart, ${todayBills.length} paid bill(s) kept in history`,
        'ok'
      );
      return { bills: todayBills.length, sales };
    },
    [apply, notify]
  );

  /** Manual "Start next day": end the current business day and start the next one now. */
  const rolloverDay = useCallback((): { bills: number; sales: number } => {
    const now = new Date();
    const next = businessDayKey(stateRef.current.billing.rolloverTime, new Date(now.getTime() + DAY_MS));
    return doRollover(next);
  }, [doRollover]);

  // Automatic end-of-day rollover at the configured time (default midnight).
  // Every 30s, if a new business day has begun that hasn't been rolled over
  // yet — including after the app was closed overnight — close open orders,
  // take the EOD snapshot and restart the counters.
  useEffect(() => {
    if (!loaded) return;
    const check = () => {
      const s = stateRef.current;
      const cur = businessDayKey(s.billing.rolloverTime, new Date());
      if (s.lastRolloverDate < cur) {
        doRollover(cur);
      }
    };
    check();
    const id = window.setInterval(check, 30 * 1000);
    return () => window.clearInterval(id);
  }, [doRollover, loaded]);

  // ── lan sync (see syncEngine.tsx) ──────────────────────────────────────
  const syncSetState = useCallback((patch: Partial<SyncState>) => {
    setSync((s) => ({ ...s, ...patch }));
  }, []);

  /** Merge orders arriving over the wire: LWW by updatedAt, renumber invoice
   *  collisions, adjust stock for paid/void transitions not seen here before. */
  const syncApplyOrders = useCallback((incoming: Order[]): { corrections: SyncCorrection[]; counter: number } => {
    const prev = stateRef.current;
    const merged = mergeOrders(prev.orders, incoming).map((o) => ({
      ...o,
      // Orders arriving from an older device version may lack the GST flag.
      gstEnabled: (o as { gstEnabled?: boolean }).gstEnabled ?? true,
    }));
    const { orders, counter } = renumberCollisions(merged, prev.invoiceCounter, prev.profile.invoicePrefix);
    const incomingById = new Map(incoming.map((o) => [o.id, o]));
    const corrections = orders
      .filter((o) => {
        const inc = incomingById.get(o.id);
        return inc && inc.invoiceNo !== o.invoiceNo;
      })
      .map((o) => ({ orderId: o.id, invoiceNo: o.invoiceNo }));
    // Stock follows status TRANSITIONS against the local copy, not just new
    // ids: a paid order that another device already had as `open` must still
    // consume stock here (open orders reserve nothing — only payment does).
    let items = prev.items;
    for (const inc of incoming) {
      const existing = prev.orders.find((o) => o.id === inc.id);
      const wasPaidHere = existing?.status === 'paid';
      const usedQty = (itemId: string) =>
        inc.lines.filter((l) => l.itemId === itemId).reduce((sum, l) => sum + l.qty, 0);
      if (inc.status === 'paid' && !wasPaidHere) {
        items = items.map((it) => {
          if (it.stock === null) return it;
          const qty = usedQty(it.id);
          return qty > 0 ? { ...it, stock: Math.max(0, it.stock - qty) } : it;
        });
      } else if (inc.status === 'void' && wasPaidHere) {
        items = items.map((it) => {
          if (it.stock === null) return it;
          const qty = usedQty(it.id);
          return qty > 0 ? { ...it, stock: it.stock + qty } : it;
        });
      }
    }
    setState(withCounters({ ...prev, orders, items, invoiceCounter: Math.max(prev.invoiceCounter, counter) }));
    return { corrections, counter };
  }, []);

  const syncApplyKots = useCallback((kots: KOT[]) => {
    const prev = stateRef.current;
    setState(withCounters({ ...prev, kots: mergeKots(prev.kots, kots) }));
  }, []);

  const syncApplyMenu = useCallback((categories: Category[], items: MenuItem[]) => {
    const prev = stateRef.current;
    setState(withCounters({ ...prev, categories, items }));
  }, []);

  const syncApplySettings = useCallback(
    (billing: BillingSettings, profile: RestaurantProfile, auth: AuthSettings) => {
      const prev = stateRef.current;
      setState(withCounters({ ...prev, billing, profile, auth }));
    },
    []
  );

  const syncApplyCounter = useCallback((invoiceCounter: number) => {
    const prev = stateRef.current;
    if (invoiceCounter > prev.invoiceCounter) {
      setState(withCounters({ ...prev, invoiceCounter }));
    }
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      loaded,
      state,
      user,
      screen,
      tab,
      toasts,
      setScreen,
      setTab,
      notify,
      login,
      logout,
      newOrder,
      addItem,
      changeQty,
      setLineNote,
      removeLine,
      sendToKitchen,
      setDiscount,
      setDeliveryCharge,
      setGstEnabled,
      setCustomerInfo,
      setOrderNote,
      splitOrder,
      repeatOrder,
      payOrder,
      voidOrder,
      markKot,
      saveCategory,
      deleteCategory,
      saveItem,
      deleteItem,
      toggleItemAvailable,
      updateProfile,
      updateBilling,
      updateGateway,
      updateAuth,
      updateTableNames,
      addExpense,
      deleteExpense,
      importState,
      resetToDemo,
      exportJson,
      exportMenu,
      importMenuJson,
      snapshotNow,
      listBackups,
      restoreBackup,
      setAutoBackup,
      rolloverDay,
      sync,
      syncSetState,
      syncApplyOrders,
      syncApplyKots,
      syncApplyMenu,
      syncApplySettings,
      syncApplyCounter,
    }),
    [
      loaded, state, user, screen, tab, toasts, notify, login, logout, newOrder,
      addItem, changeQty, setLineNote, removeLine, sendToKitchen, setDiscount,
      setDeliveryCharge, setGstEnabled, setCustomerInfo, setOrderNote, splitOrder, repeatOrder, payOrder, voidOrder,
      markKot, saveCategory, deleteCategory,
      saveItem, deleteItem, toggleItemAvailable, updateProfile, updateBilling,
      updateGateway, updateAuth, updateTableNames, addExpense, deleteExpense, importState,
      resetToDemo, exportJson, exportMenu, importMenuJson, snapshotNow,
      listBackups, restoreBackup, setAutoBackup, rolloverDay,
      sync, syncSetState, syncApplyOrders, syncApplyKots, syncApplyMenu,
      syncApplySettings, syncApplyCounter,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

