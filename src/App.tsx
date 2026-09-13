import { useEffect, useState } from 'react';
import { useStore } from './store';
import { isDesktop } from './desktop';
import { usePinKeypad } from './usePinKeypad';
import type { Tab } from './types';

/** Live online/offline state (browser-level; no network calls). */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
import { LoginScreen } from './screens/Login';
import { TablesScreen } from './screens/TablesScreen';
import { OrderScreen } from './screens/OrderScreen';
import { ReceiptScreen } from './screens/ReceiptScreen';
import { KitchenScreen } from './screens/KitchenScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { MenuScreen } from './screens/MenuScreen';
import { ExpensesScreen } from './screens/ExpensesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { BillDesignScreen } from './screens/BillDesignScreen';
import { SyncSheet } from './components/SyncSheet';
import { Modal, Toasts } from './components/ui';
import { AppLogo } from './components/AppLogo';
import {
  IconTables, IconKitchen, IconOrders, IconReport, IconMenu, IconGear, IconExpense, IconLogout,
} from './components/icons';

function Splash() {
  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <AppLogo container="login-logo" />
        <div className="bold">Meadows Park Restaurant</div>
        <div className="small muted">Loading…</div>
      </div>
    </div>
  );
}

const TAB_TITLES: Record<Tab, string> = {
  tables: 'Tables',
  kitchen: 'Kitchen',
  orders: 'Orders',
  reports: 'Reports',
  menu: 'Menu',
  settings: 'Settings',
  expenses: 'Expenses',
};

const SETTINGS_UNLOCK_KEY = 'nellara-settings-unlocked';

/** Settings PIN pad — the Settings tab is protected by a 4-digit PIN. */
function SettingsGate({ onUnlock }: { onUnlock: () => void }) {
  const { state, setTab } = useStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const press = (d: string) => {
    if (pin.length >= 4) return;
    setError(false);
    setPin((p) => p + d);
  };

  const submit = () => {
    if (pin.length < 4) return;
    if (pin === state.auth.settingsPin) {
      onUnlock();
    } else {
      setError(true);
      setPin('');
    }
  };

  usePinKeypad({
    onDigit: press,
    onBackspace: () => setPin((p) => p.slice(0, -1)),
    onClear: () => {
      setPin('');
      setError(false);
    },
    onSubmit: submit,
  });

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">🔐</div>
        <h1 style={{ margin: 0, fontSize: 21 }}>Settings locked</h1>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
          Enter the 4-digit settings PIN{error ? ' — wrong PIN, try again' : ''}
        </p>
        <div className="pin-head">
          <div className="pin-dots">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={pin.length > i ? 'filled' : ''} />
            ))}
          </div>
          <button
            className="pin-backspace"
            onClick={() => setPin((p) => p.slice(0, -1))}
            disabled={pin.length === 0}
            aria-label="Delete last digit"
            title="Delete last digit"
          >
            ⌫
          </button>
        </div>
        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)}>{d}</button>
          ))}
          <button className="fn" onClick={() => { setPin(''); setError(false); }}>Clear</button>
          <button onClick={() => press('0')}>0</button>
          <button className="enter" onClick={submit}>OK</button>
        </div>
        {isDesktop() && (
          <div className="pin-hint" style={{ marginTop: 8 }}>
            Keyboard: digits · ⌫ delete · ⏎ enter · Esc clear
          </div>
        )}
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => { setTab('tables'); }}>
          ← Back to tables
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { loaded, user, screen, tab, setTab, setScreen, logout, state, sync } = useStore();
  const online = useOnline(); // must be called before any early return (rules of hooks)
  const [settingsUnlocked, setSettingsUnlocked] = useState<boolean>(
    () => sessionStorage.getItem(SETTINGS_UNLOCK_KEY) === '1'
  );
  const [syncOpen, setSyncOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Desktop: Alt+1..7 jumps to the Nth tab (visible tabs only).
  useEffect(() => {
    if (!isDesktop() || !user) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 7) return;
      const vis: Tab[] =
        user.role === 'kitchen'
          ? ['kitchen']
          : user.role === 'admin'
            ? ['tables', 'kitchen', 'orders', 'reports', 'menu', 'settings', 'expenses']
            : ['tables', 'orders'];
      if (screen.name === 'tab' && n <= vis.length) {
        e.preventDefault();
        setTab(vis[n - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, screen.name, setTab]);

  if (!loaded) return <Splash />;
  if (!user) {
    return (
      <>
        {!online && (
          <div className="offline-banner" role="status">
            📡 Offline mode — billing keeps working, all data is saved on this device
          </div>
        )}
        <LoginScreen />
        <Toasts />
      </>
    );
  }

  const isAdmin = user.role === 'admin';
  const isKitchen = user.role === 'kitchen';

  // Visible tabs per role.
  const tabs: Tab[] = isKitchen
    ? ['kitchen']
    : isAdmin
      ? ['tables', 'kitchen', 'orders', 'reports', 'menu', 'settings', 'expenses']
      : ['tables', 'orders'];

  // Switch tabs from anywhere — including inside an order/receipt screen
  // (a tab click leaves the fullscreen screen and opens the chosen tab).
  const goTab = (t: Tab) => {
    if (screen.name !== 'tab') setScreen({ name: 'tab' });
    setTab(t);
  };

  const inFullScreen = screen.name === 'order' || screen.name === 'receipt' || screen.name === 'billDesign';

  let content;
  if (screen.name === 'order') {
    content = <OrderScreen orderId={screen.orderId} />;
  } else if (screen.name === 'receipt') {
    content = <ReceiptScreen orderId={screen.orderId} />;
  } else if (screen.name === 'billDesign') {
    content = isAdmin ? <BillDesignScreen /> : <TablesScreen />;
  } else if (isKitchen) {
    content = <KitchenScreen />;
  } else {
    switch (tab) {
      case 'tables': content = <TablesScreen />; break;
      case 'kitchen': content = <KitchenScreen />; break;
      case 'orders': content = <OrdersScreen />; break;
      case 'reports': content = isAdmin ? <ReportsScreen /> : <TablesScreen />; break;
      case 'menu': content = isAdmin ? <MenuScreen /> : <TablesScreen />; break;
      case 'expenses': content = isAdmin ? <ExpensesScreen /> : <TablesScreen />; break;
      case 'settings':
        content = isAdmin ? (
          settingsUnlocked ? (
            <SettingsScreen />
          ) : (
            <SettingsGate
              onUnlock={() => {
                setSettingsUnlocked(true);
                sessionStorage.setItem(SETTINGS_UNLOCK_KEY, '1');
              }}
            />
          )
        ) : (
          <TablesScreen />
        );
        break;
    }
  }

  const pendingKots = state.kots.filter((k) => k.status === 'pending').length;
  const desktop = isDesktop();

  return (
    <div className={`app ${inFullScreen ? 'no-nav' : ''} ${desktop ? 'desktop' : ''}`}>
      {!online && (
        <div className="offline-banner" role="status">
          📡 Offline mode — billing keeps working, all data is saved on this device
        </div>
      )}
      {desktop && (
        <aside className="sidebar">
          <div className="side-brand">
            <AppLogo container="brand-logo" />
            <div className="side-brand-name">
              <div className="bold">Meadows Park Restaurant</div>
              <div className="small muted">{state.profile.name}</div>
            </div>
          </div>
          {tabs.map((t) => (
            <button
              key={t}
              className={`side-nav-item ${tab === t ? 'active' : ''} ${t === 'kitchen' && pendingKots > 0 ? 'kitchen-dot' : ''}`}
              onClick={() => goTab(t)}
            >
              {t === 'tables' && <IconTables />}
              {t === 'kitchen' && <IconKitchen />}
              {t === 'orders' && <IconOrders />}
              {t === 'reports' && <IconReport />}
              {t === 'menu' && <IconMenu />}
              {t === 'settings' && <IconGear />}
              {t === 'expenses' && <IconExpense />}
              <span className="grow">{TAB_TITLES[t]}</span>
              {t === 'kitchen' && pendingKots > 0 && <span className="dot" />}
            </button>
          ))}
          <div className="side-spacer" />
          <button
            className={`side-sync ${sync.hubRunning || sync.clientState === 'connected' ? 'on' : ''}`}
            onClick={() => setSyncOpen(true)}
            title="Sync & multi-device"
          >
            <span
              className="sync-dot"
              style={
                sync.hubRunning || sync.clientState === 'connected'
                  ? { background: 'var(--ok)' }
                  : sync.clientState === 'connecting'
                    ? { background: 'var(--accent)' }
                    : { background: 'var(--muted)' }
              }
            />
            {sync.hubRunning
              ? `Hub · ${sync.hubClients.length}`
              : sync.clientState === 'connected'
                ? 'Synced'
                : sync.clientState === 'connecting'
                  ? 'Syncing…'
                  : 'Sync'}
          </button>
        </aside>
      )}
      <div className="main">
        {!inFullScreen && (
        <header className="topbar">
          <div className="brand">
            <AppLogo container="brand-logo" />
            <div className="grow" style={{ minWidth: 0 }}>
              <h1>{screen.name !== 'tab' ? '' : TAB_TITLES[tab]}</h1>
              <div className="sub">{state.profile.name} · {user.name}</div>
            </div>
          </div>
          {isDesktop() && (
            <button className="icon-btn" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts">
              ⌨️
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => {
              setSettingsUnlocked(false);
              sessionStorage.removeItem(SETTINGS_UNLOCK_KEY);
              logout();
            }}
            title="Sign out"
          >
            <IconLogout width={20} height={20} />
          </button>
        </header>
      )}
      {/* The sync pill lives in the topbar zone; it must not float over the
          order/receipt screens, where the header row already has its own buttons. */}
      {content}
      </div>

      {!desktop && !inFullScreen && (
        <button
          className="sync-pill"
          style={
            sync.hubRunning || sync.clientState === 'connected'
              ? { background: 'var(--ok-soft)', color: 'var(--ok)' }
              : sync.clientState === 'connecting'
                ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                : { background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }
          }
          onClick={() => setSyncOpen(true)}
          title="Sync & multi-device"
        >
        <span
          className="sync-dot"
          style={
            sync.hubRunning || sync.clientState === 'connected'
              ? { background: 'var(--ok)' }
              : sync.clientState === 'connecting'
                ? { background: 'var(--accent)' }
                : { background: 'var(--muted)' }
          }
        />
        {sync.hubRunning
          ? `Hub · ${sync.hubClients.length}`
          : sync.clientState === 'connected'
            ? 'Synced'
            : sync.clientState === 'connecting'
              ? 'Syncing…'
              : 'Sync'}
        </button>
      )}

      {!desktop && !inFullScreen && tabs.length > 1 && (
        <nav className="bottomnav">
          {tabs.map((t) => (
            <button
              key={t}
              className={`nav-item ${tab === t ? 'active' : ''} ${t === 'kitchen' && pendingKots > 0 ? 'kitchen-dot' : ''}`}
              onClick={() => goTab(t)}
            >
              {t === 'tables' && <IconTables />}
              {t === 'kitchen' && <IconKitchen />}
              {t === 'orders' && <IconOrders />}
              {t === 'reports' && <IconReport />}
              {t === 'menu' && <IconMenu />}
              {t === 'settings' && <IconGear />}
              {t === 'expenses' && <IconExpense />}
              <span>{TAB_TITLES[t]}</span>
              {t === 'kitchen' && pendingKots > 0 && <span className="dot" />}
            </button>
          ))}
        </nav>
      )}

      <Toasts />
      <SyncSheet open={syncOpen} onClose={() => setSyncOpen(false)} />

      {isDesktop() && (
        <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="⌨️ Keyboard shortcuts">
          <div style={{ display: 'grid', gap: 6, fontSize: 13.5 }}>
            <div className="row row-between"><span className="muted">Switch tab</span><b>Alt+1…7</b></div>
            <div className="row row-between"><span className="muted">Close popup</span><b>Esc</b></div>
            <div className="divider" />
            <div className="bold" style={{ fontSize: 12.5 }}>Tables screen</div>
            <div className="row row-between"><span className="muted">Open a table</span><b>number + Enter</b></div>
            <div className="row row-between"><span className="muted">Takeaway / Delivery</span><b>Alt+T / Alt+D</b></div>
            <div className="divider" />
            <div className="bold" style={{ fontSize: 12.5 }}>Order screen</div>
            <div className="row row-between"><span className="muted">Search menu</span><b>/</b></div>
            <div className="row row-between"><span className="muted">Pick an item</span><b>↑ ↓</b></div>
            <div className="row row-between"><span className="muted">Add item</span><b>Enter</b></div>
            <div className="row row-between"><span className="muted">Go to checkout</span><b>Alt+P</b></div>
            <div className="divider" />
            <div className="bold" style={{ fontSize: 12.5 }}>Kitchen screen</div>
            <div className="row row-between"><span className="muted">Select KOT</span><b>↑ ↓</b></div>
            <div className="row row-between"><span className="muted">Mark Ready</span><b>Enter / F2</b></div>
            <div className="row row-between"><span className="muted">Mark Served</span><b>F3</b></div>
            <div className="row row-between"><span className="muted">Print KOT</span><b>P</b></div>
            <div className="row row-between"><span className="muted">Filter (pending/ready/all)</span><b>1 / 2 / 3</b></div>
            <div className="divider" />
            <div className="bold" style={{ fontSize: 12.5 }}>Checkout / Receipt</div>
            <div className="row row-between"><span className="muted">Pay with amount</span><b>Enter</b></div>
            <div className="row row-between"><span className="muted">Print receipt</span><b>Alt+P</b></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
