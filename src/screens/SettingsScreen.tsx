import { useRef, useState, type ChangeEvent } from 'react';
import { useStore } from '../store';
import type { Role, StaffUser } from '../types';
import { thermalWidthMm, uid } from '../types';
import { fileToPhotoDataUrl } from '../photo';
import { fmt } from '../money';
import { buildBill } from '../bill';
import { businessDayKey } from '../rollover';
import { Switch, Modal, Chips } from '../components/ui';
import { IconTrash } from '../components/icons';
import {
  connectThermal,
  disconnectThermal,
  testPrint,
  useThermal,
  dotsForMm,
} from '../thermal';
import { gatewayFetch } from '../razorpay';
import {
  refreshDetectedWidth,
  refreshUsbPrinters,
  selectUsbPrinter,
  useUsbPrinter,
  usbTestPrint,
} from '../usbThermal';

export function SettingsScreen() {
  const { user, setScreen } = useStore();
  const isAdmin = user?.role === 'admin';

  return (
    <div style={{ paddingBottom: 20 }}>
      <div className="section" style={{ paddingBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>Settings</div>
      </div>

      {!isAdmin && (
        <div className="section" style={{ paddingTop: 0 }}>
          <div className="card" style={{ background: 'var(--accent-soft)', borderColor: '#fcd34d' }}>
            Settings are read-only for waiters. Sign in with the admin PIN to change them.
          </div>
        </div>
      )}

      {isAdmin && (
        <>
          <AppearanceSection />
          <div className="card" style={{ margin: '0 14px 12px' }}>
            <div className="section-title" style={{ marginTop: 0 }}>Bill design</div>
            <div className="small muted" style={{ marginBottom: 10 }}>
              Change the layout of the bill yourself — header lines, which sections
              appear, veg/non-veg markers and the printed text size.
            </div>
            <button className="btn btn-ghost btn-block" onClick={() => setScreen({ name: 'billDesign' })}>
              🎨 Edit bill design
            </button>
          </div>
          <ProfileSection />
          <PaymentSection />
          <BillingSection />
          <ThermalSection />
          <UsbSection />
          <DaySection />
          <TablesSection />
          <UsersSection />
          <DataSection />
        </>
      )}

      <div className="section small muted" style={{ paddingTop: 0 }}>
        Meadows Park Restaurant · Offline-first · Data is stored on this device
      </div>
    </div>
  );
}

function SaveRow({ onSave, dirty }: { onSave: () => void; dirty: boolean }) {
  return (
    <div className="row" style={{ marginTop: 4 }}>
      <button className="btn btn-primary grow" disabled={!dirty} onClick={onSave}>
        Save changes
      </button>
    </div>
  );
}

const THEME_KEY = 'nellara-theme';

function AppearanceSection() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  const apply = (d: boolean) => {
    setDark(d);
    document.documentElement.dataset.theme = d ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_KEY, d ? 'dark' : 'light');
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  };

  return (
    <div className="card" style={{ margin: '0 14px 12px' }}>
      <div className="section-title" style={{ marginTop: 0 }}>Appearance</div>
      <Switch
        on={dark}
        onChange={apply}
        label="Dark mode"
        sub="Dark theme for low-light environments"
      />
    </div>
  );
}

function ProfileSection() {
  const { state, updateProfile, notify } = useStore();
  const p = state.profile;
  const [form, setForm] = useState({
    name: p.name, address: p.address, phone: p.phone,
    fssai: p.fssai, invoicePrefix: p.invoicePrefix,
    upiId: p.upiId, upiName: p.upiName, footerNote: p.footerNote, logo: p.logo ?? '',
  });
  const [logoBusy, setLogoBusy] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify({ name: p.name, address: p.address, phone: p.phone, fssai: p.fssai, invoicePrefix: p.invoicePrefix, upiId: p.upiId, upiName: p.upiName, footerNote: p.footerNote, logo: p.logo ?? '' });
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    fileToPhotoDataUrl(file, 512)
      .then((dataUrl) => setForm((f) => ({ ...f, logo: dataUrl })))
      .catch((err: unknown) => {
        notify(err instanceof Error ? err.message : 'Could not process image', 'err');
      })
      .finally(() => setLogoBusy(false));
  };

  return (
    <div className="card" style={{ margin: '0 14px 12px' }}>
      <div className="section-title" style={{ marginTop: 0 }}>Restaurant profile</div>
      <div className="field">
        <label>Logo (shown on the login screen &amp; app bar)</label>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <div
            className="login-logo"
            style={{ margin: 0, width: 64, height: 64, borderRadius: 16 }}
          >
            {form.logo ? (
              <img className="app-logo-img" src={form.logo} alt="Logo preview" />
            ) : (
              '🍽'
            )}
          </div>
          <input
            ref={logoRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              pickLogo(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={logoBusy} onClick={() => logoRef.current?.click()}>
              {logoBusy ? 'Processing…' : form.logo ? '🖼 Change logo' : '🖼 Upload logo'}
            </button>
            {form.logo && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm((f) => ({ ...f, logo: '' }))}>
                ✕ Remove
              </button>
            )}
          </div>
        </div>
        <div className="small muted" style={{ marginTop: 5 }}>
          Square images work best. Saved on this device; synced to connected devices.
        </div>
      </div>
      <div className="field"><label>Restaurant name</label><input className="input" value={form.name} onChange={set('name')} /></div>
      <div className="field"><label>Address (shown on bill)</label><input className="input" value={form.address} onChange={set('address')} /></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>Phone</label><input className="input" value={form.phone} onChange={set('phone')} /></div>
        <div className="field grow"><label>FSSAI license no.</label><input className="input" value={form.fssai} onChange={set('fssai')} /></div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ width: 130 }}><label>Invoice prefix</label><input className="input" value={form.invoicePrefix} onChange={set('invoicePrefix')} /></div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow"><label>UPI ID (for QR)</label><input className="input" value={form.upiId} onChange={set('upiId')} placeholder="restaurant@okhdfc" /></div>
        <div className="field grow"><label>UPI payee name</label><input className="input" value={form.upiName} onChange={set('upiName')} /></div>
      </div>
      <div className="field"><label>Bill footer note</label><input className="input" value={form.footerNote} onChange={set('footerNote')} /></div>
      <SaveRow
        dirty={dirty}
        onSave={() => {
          updateProfile({ ...form, invoicePrefix: form.invoicePrefix.trim() || 'INV-' });
          notify('Profile saved', 'ok');
        }}
      />
    </div>
  );
}

/** Online payments via Razorpay Checkout (card / UPI / netbanking). Only the
 *  public Key ID lives in the app; the secret stays on the payment helper
 *  server (server/) which creates orders and verifies signatures. */
function PaymentSection() {
  const { state, updateGateway, notify } = useStore();
  const g = state.gateway;
  const [form, setForm] = useState({
    enabled: g.enabled,
    keyId: g.keyId,
    serverUrl: g.serverUrl,
  });
  const dirty =
    form.enabled !== g.enabled ||
    form.keyId !== g.keyId ||
    form.serverUrl !== g.serverUrl;
  const [testing, setTesting] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await gatewayFetch(form.serverUrl, '/api/health', {});
      if (res.status === 200 && res.json?.ok) {
        const mode = res.json.mode ?? 'unknown';
        notify(`Payment server reachable (${mode})`, 'ok');
      } else {
        notify('Payment server answered, but reports a problem', 'err');
      }
    } catch {
      notify('Payment server not reachable — is it running?', 'err');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="card" style={{ margin: '0 14px 12px' }}>
      <div className="section-title" style={{ marginTop: 0 }}>Online payments (Razorpay)</div>
      <Switch
        on={form.enabled}
        onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
        label="Accept card & UPI payments online"
        sub="Adds a “Pay online (card / UPI)” button at checkout that opens Razorpay Checkout. Needs internet — when offline, staff keep using cash / UPI QR / card as usual."
      />
      {form.enabled && (
        <>
          <div className="field">
            <label>Razorpay Key ID (public)</label>
            <input
              className="input"
              value={form.keyId}
              placeholder="rzp_test_… or rzp_live_…"
              onChange={(e) => setForm((f) => ({ ...f, keyId: e.target.value.trim() }))}
            />
            <div className="small muted" style={{ marginTop: 4 }}>
              From the Razorpay dashboard → Settings → API keys. This is the public key, safe to store here.
            </div>
          </div>
          <div className="field">
            <label>Payment server URL</label>
            <input
              className="input"
              value={form.serverUrl}
              placeholder="http://localhost:8787"
              onChange={(e) => setForm((f) => ({ ...f, serverUrl: e.target.value.trim() }))}
            />
            <div className="small muted" style={{ marginTop: 4 }}>
              Run <code>npm run pay:server</code> (with the secret key as an env var) on the counter PC — see the
              README → Online payments.
            </div>
          </div>
          <button
            className="btn btn-ghost btn-block"
            disabled={testing || !form.serverUrl}
            onClick={() => void testConnection()}
          >
            {testing ? 'Testing…' : '🔌 Test connection'}
          </button>
          <div className="small muted" style={{ marginTop: 8 }}>
            💳 Card details are typed into Razorpay's own PCI-DSS compliant page — they never touch this app.
            A bill is only marked paid after the server verifies the payment signature, and the secret key never
            leaves the server.
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            📱 On the Android app cards work, but UPI via the checkout may not open other UPI apps from the WebView
            — use the built-in UPI QR there.
          </div>
        </>
      )}
      <SaveRow
        dirty={dirty}
        onSave={() => {
          updateGateway(form);
          notify('Payment settings saved', 'ok');
        }}
      />
    </div>
  );
}

function BillingSection() {
  const { state, updateBilling, notify } = useStore();
  const b = state.billing;
  const [scPct, setScPct] = useState(String(b.serviceChargePct));
  const [roundOff, setRoundOff] = useState(b.roundOff);
  const [kotEnabled, setKotEnabled] = useState(b.kotEnabled);
  const dirty = scPct !== String(b.serviceChargePct) || roundOff !== b.roundOff || kotEnabled !== b.kotEnabled;

  const scPctNum = Number(scPct);

  return (
    <div className="card" style={{ margin: '0 14px 12px' }}>
      <div className="section-title" style={{ marginTop: 0 }}>Billing</div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow">
          <label>Service charge % (0 = off)</label>
          <input className="input" type="number" min="0" max="50" value={scPct} onChange={(e) => setScPct(e.target.value)} />
        </div>
      </div>
      <Switch on={roundOff} onChange={setRoundOff} label="Round off to nearest rupee" sub="0.50 rounds up — standard practice" />
      <Switch on={kotEnabled} onChange={setKotEnabled} label="Kitchen order tickets (KOT)" sub="Send items to kitchen display when ordering" />
      <SaveRow
        dirty={dirty}
        onSave={() => {
          updateBilling({
            serviceChargePct: Number.isFinite(scPctNum) && scPctNum >= 0 ? Math.min(50, scPctNum) : 0,
            roundOff,
            kotEnabled,
          });
          notify('Billing settings saved', 'ok');
        }}
      />
    </div>
  );
}

function ThermalSection() {
  const { state, updateBilling, notify } = useStore();
  const thermal = useThermal();
  const width = state.billing.thermalWidth;

  const handleConnect = async () => {
    const res = await connectThermal();
    if (res.ok) notify('Thermal printer connected', 'ok');
    else notify(res.error ?? 'Could not connect', 'err');
  };

  const handleTest = async () => {
    const err = await testPrint(
      state.profile.name,
      dotsForMm(thermalWidthMm(width, state.billing.thermalCustomWidth))
    );
    if (err) notify(err, 'err');
    else notify('Test page sent to printer', 'ok');
  };

  return (
    <div className="card" style={{ margin: '0 14px 12px' }}>
      <div className="section-title" style={{ marginTop: 0 }}>Thermal printer (Bluetooth)</div>
      <div className="field">
        <label>Paper width</label>
        <div className="seg">
          <button className={width === '58' ? 'active' : ''} onClick={() => updateBilling({ thermalWidth: '58' })}>
            58mm
          </button>
          <button className={width === '80' ? 'active' : ''} onClick={() => updateBilling({ thermalWidth: '80' })}>
            80mm
          </button>
          <button className={width === 'custom' ? 'active' : ''} onClick={() => updateBilling({ thermalWidth: 'custom' })}>
            Custom
          </button>
        </div>
        {width === 'custom' && (
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input
              className="input"
              type="number"
              min="40"
              max="120"
              value={state.billing.thermalCustomWidth}
              onChange={(e) =>
                updateBilling({
                  thermalCustomWidth: Math.min(120, Math.max(40, Math.round(Number(e.target.value) || 80))),
                })
              }
            />
            <span className="muted small">mm (e.g. 76mm roll)</span>
          </div>
        )}
        {width === 'custom' && state.billing.thermalCustomWidth !== 80 && state.billing.thermalCustomWidth !== 58 && (
          <div className="small muted" style={{ marginTop: 5 }}>
            Using a {state.billing.thermalCustomWidth}mm receipt — set automatically when a USB printer's paper
            width is detected, or change it here.
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        {thermal.connected ? (
          <button className="btn btn-danger grow" onClick={() => void disconnectThermal()}>
            Disconnect{thermal.name ? ` · ${thermal.name}` : ''}
          </button>
        ) : (
          <button className="btn btn-primary grow" onClick={() => void handleConnect()}>
            🖨 Connect printer
          </button>
        )}
        <button className="btn btn-ghost grow" disabled={!thermal.connected || thermal.busy} onClick={() => void handleTest()}>
          Test page
        </button>
      </div>
      {!thermal.supported && (
        <div className="small" style={{ color: 'var(--danger)' }}>
          Web Bluetooth is not available in this browser. Use Chrome/Edge on Android or desktop with HTTPS
          (works on localhost). The system Print button on receipts still works everywhere.
        </div>
      )}
      {thermal.connected && (
        <div className="small muted">Receipts will show a “Thermal ✓” button that prints straight to this printer.</div>
      )}
    </div>
  );
}

/** USB thermal printing (desktop app only): pick an installed printer and
 *  send raw ESC/POS receipts straight to it over the USB cable. */
function UsbSection() {
  const { state, notify } = useStore();
  const usb = useUsbPrinter();
  const width = state.billing.thermalWidth;

  useEffectOnce(() => {
    void refreshUsbPrinters();
    // A printer may already be chosen from a previous session — re-detect its
    // paper width so the UI shows it and the width setting stays in sync.
    if (usb.selected) void refreshDetectedWidth(usb.selected);
  });

  if (!usb.supported) return null;

  const handleTest = async () => {
    const res = await usbTestPrint(
      usb.selected,
      state.profile.name,
      dotsForMm(thermalWidthMm(width, state.billing.thermalCustomWidth))
    );
    if (res.ok) notify('Test page sent to printer', 'ok');
    else notify(res.error ?? 'Print failed', 'err');
  };

  return (
    <div className="card" style={{ margin: '0 14px 12px' }}>
      <div className="section-title" style={{ marginTop: 0 }}>USB printer (desktop)</div>
      <p className="small muted" style={{ margin: '0 0 10px' }}>
        Print straight to a thermal printer connected to this computer with a USB cable.
        Pick the printer below; receipts and KOTs then get a “🔌 USB” button.
      </p>
      {usb.printers.length === 0 ? (
        <div className="small muted" style={{ marginBottom: 8 }}>
          No printers found. Connect the printer with its USB cable, make sure its driver is
          installed (Windows: Settings → Devices → Printers), then tap Refresh.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
          {usb.printers.map((p) => (
            <button
              key={p.name}
              className={`btn btn-ghost${usb.selected === p.name ? ' active' : ''}`}
              style={{ justifyContent: 'flex-start' }}
              onClick={() => selectUsbPrinter(usb.selected === p.name ? null : p.name)}
            >
              🖨 {p.displayName}
              {p.isDefault ? ' (default)' : ''}
              {p.status !== 'idle' && p.status ? ` · ${p.status}` : ''}
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-ghost grow" onClick={() => void refreshUsbPrinters()}>
          🔄 Refresh
        </button>
        <button
          className="btn btn-primary grow"
          disabled={!usb.selected || usb.busy}
          onClick={() => void handleTest()}
        >
          Test page
        </button>
      </div>
      {usb.selected && (
        <div className="small muted" style={{ marginTop: 8 }}>
          Selected: <b>{usb.selected}</b>. Receipts &amp; KOTs will print there via the “🔌 USB” button.
        </div>
      )}
      {usb.detectedWidth !== null && (
        <div className="small" style={{ marginTop: 4, color: 'var(--ok)' }}>
          📏 Detected paper width: <b>{usb.detectedWidth}mm</b> — receipt width set to match
        </div>
      )}
    </div>
  );
}

/** End-of-day: automatic rollover time + manual "start next day". */
function DaySection() {
  const { state, updateBilling, rolloverDay, notify } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [time, setTime] = useState(state.billing.rolloverTime);
  const timeDirty = time !== state.billing.rolloverTime;

  // "Today" means the current business day (honours the rollover time), so it
  // matches what end-of-day itself closes out — not the plain calendar date.
  const bizDay = businessDayKey(state.billing.rolloverTime, new Date());
  const todayBills = state.orders.filter(
    (o) =>
      o.status === 'paid' &&
      o.paidAt !== null &&
      businessDayKey(state.billing.rolloverTime, new Date(o.paidAt)) === bizDay
  );
  const todaySales = todayBills.reduce((s, o) => {
    const bill = buildBill({
      lines: o.lines,
      discount: o.discount,
      billing: state.billing,
      deliveryCharge: o.deliveryCharge,
    });
    return s + bill.payable;
  }, 0);
  const openOrders = state.orders.filter((o) => o.status === 'open').length;

  return (
    <div className="card" style={{ margin: '0 14px 12px' }}>
      <div className="section-title" style={{ marginTop: 0 }}>End of day</div>
      <p className="small muted" style={{ margin: '0 0 10px' }}>
        At the end of each day the app does this automatically: closes any open orders,
        saves an end-of-day snapshot, and restarts invoice &amp; KOT numbers. Nothing is deleted —
        every day stays in history and reports.
      </p>
      <div className="field">
        <label>Automatic end-of-day time (24h)</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="time"
            className="input"
            style={{ flex: 1, minWidth: 0 }}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <button
            className="btn btn-ghost"
            disabled={!timeDirty}
            onClick={() => {
              updateBilling({ rolloverTime: time || '00:00' });
              notify('End-of-day time saved', 'ok');
            }}
          >
            Save time
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 5 }}>
          Default is 00:00 (midnight). Set e.g. 00:30 if your day ends at 12:30 AM.
        </div>
      </div>

      <div className="divider" />
      <p className="small muted" style={{ margin: '10px 0' }}>
        Want to start the next day early, before the automatic time? Use this:
      </p>
      <button className="btn btn-primary btn-block" onClick={() => setConfirm(true)}>
        🌅 Start next day now
      </button>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Start the next day?">
        <div className="small" style={{ marginBottom: 10 }}>
          <div className="sum-row"><span className="k">Paid bills today</span><span className="v">{todayBills.length}</span></div>
          <div className="sum-row"><span className="k">Today's sales</span><span className="v">{fmt(todaySales)}</span></div>
          <div className="sum-row"><span className="k">Open orders (will be closed)</span><span className="v">{openOrders}</span></div>
        </div>
        <p className="small muted" style={{ margin: '0 0 10px' }}>
          Invoice &amp; KOT numbers restart from 1, open orders are closed, and an end-of-day
          snapshot is saved so today can still be viewed in reports and restored if needed.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn btn-primary grow"
            onClick={() => {
              const res = rolloverDay();
              setConfirm(false);
              notify(`New day started — ${res.bills} bill(s) kept in history`, 'ok');
            }}
          >
            Yes, start next day
          </button>
          <button className="btn btn-ghost grow" onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      </Modal>
    </div>
  );
}

function TablesSection() {
  const { state, updateTableNames, notify } = useStore();
  const [names, setNames] = useState<string[]>(state.profile.tableNames);
  const [count, setCount] = useState(state.profile.tableNames.length);
  const dirty = JSON.stringify(names) !== JSON.stringify(state.profile.tableNames);

  const applyCount = (n: number) => {
    const c = Math.max(1, Math.min(60, Math.floor(n)));
    setCount(c);
    setNames((prev) => {
      const next = [...prev];
      while (next.length < c) next.push(String(next.length + 1));
      return next.slice(0, c);
    });
  };

  return (
    <div className="card" style={{ margin: '0 14px 12px' }}>
      <div className="section-title" style={{ marginTop: 0 }}>Dining tables</div>
      <div className="field">
        <label>Number of tables</label>
        <input className="input" type="number" min="1" max="60" value={count} onChange={(e) => applyCount(Number(e.target.value) || 1)} />
      </div>
      <div className="field">
        <label>Table names</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {names.map((n, i) => (
            <input
              key={i}
              className="input"
              style={{ width: 76, textAlign: 'center' }}
              value={n}
              onChange={(e) => setNames((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
        </div>
      </div>
      <SaveRow
        dirty={dirty}
        onSave={() => {
          // Fall back to the position number for blank names (index, not
          // indexOf — duplicate blanks must not collapse to the same name).
          updateTableNames(names.map((n, i) => n.trim() || String(i + 1)));
          notify('Tables saved', 'ok');
        }}
      />
    </div>
  );
}

/** Staff user management: change names/PINs/roles, add and remove users. */
function UsersSection() {
  const { state, updateAuth, notify } = useStore();
  const [draft, setDraft] = useState<StaffUser[]>(() => state.auth.users.map((u) => ({ ...u })));
  const [settingsPin, setSettingsPin] = useState(state.auth.settingsPin);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Role>('waiter');
  const [newPin, setNewPin] = useState('');

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(state.auth.users) ||
    settingsPin !== state.auth.settingsPin;
  const pins = draft.map((u) => u.pin);
  const valid = draft.every((u) => /^\d{4}$/.test(u.pin) && u.name.trim().length > 0);
  const unique = new Set(pins).size === pins.length;
  const hasAdmin = draft.some((u) => u.role === 'admin');
  const newValid = /^\d{4}$/.test(newPin) && newName.trim().length > 0 && !pins.includes(newPin);

  const setUser = (id: string, patch: Partial<StaffUser>) =>
    setDraft((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const removeUser = (id: string) => {
    const target = draft.find((u) => u.id === id);
    if (!target) return;
    if (target.role === 'admin' && draft.filter((u) => u.role === 'admin').length <= 1) {
      notify('Keep at least one manager', 'err');
      return;
    }
    setDraft((prev) => prev.filter((u) => u.id !== id));
  };

  const addUser = () => {
    if (!newValid) {
      notify('Name + a unique 4-digit PIN', 'err');
      return;
    }
    setDraft((prev) => [...prev, { id: uid(), name: newName.trim(), pin: newPin, role: newRole }]);
    setNewName('');
    setNewPin('');
  };

  return (
    <div className="card" style={{ margin: '0 14px 12px' }}>
      <div className="section-title" style={{ marginTop: 0 }}>Staff users</div>
      <p className="small muted" style={{ margin: '0 0 10px' }}>
        Each user signs in with their own 4-digit PIN. Change any PIN or name here, add new
        users (manager, waiter, kitchen…), or remove them.
      </p>
      {draft.map((u) => (
        <div className="row" key={u.id} style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <div className="field grow" style={{ margin: 0 }}>
            <input className="input" value={u.name} placeholder="Name" onChange={(e) => setUser(u.id, { name: e.target.value })} />
          </div>
          <div className="field" style={{ width: 118, margin: 0 }}>
            <select className="select" value={u.role} onChange={(e) => setUser(u.id, { role: e.target.value as Role })}>
              <option value="admin">Manager</option>
              <option value="waiter">Waiter</option>
              <option value="kitchen">Kitchen</option>
            </select>
          </div>
          <div className="field" style={{ width: 92, margin: 0 }}>
            <input
              className="input"
              inputMode="numeric"
              maxLength={4}
              value={u.pin}
              placeholder="PIN"
              aria-label={`${u.name} PIN`}
              onChange={(e) => setUser(u.id, { pin: e.target.value.replace(/\D/g, '') })}
            />
          </div>
          <button className="icon-btn" onClick={() => removeUser(u.id)} title="Remove user" aria-label="Remove user">
            <IconTrash width={15} height={15} />
          </button>
        </div>
      ))}

      <div className="divider" />
      <div className="section-title" style={{ marginTop: 8 }}>Add a user</div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <div className="field grow" style={{ margin: 0 }}>
          <input className="input" placeholder="Name (e.g. Ravi)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </div>
        <div className="field" style={{ width: 118, margin: 0 }}>
          <select className="select" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
            <option value="admin">Manager</option>
            <option value="waiter">Waiter</option>
            <option value="kitchen">Kitchen</option>
          </select>
        </div>
        <div className="field" style={{ width: 92, margin: 0 }}>
          <input
            className="input"
            inputMode="numeric"
            maxLength={4}
            placeholder="PIN"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <button className="btn btn-primary" onClick={addUser}>Add</button>
      </div>

      <div className="divider" />
      <div className="field" style={{ marginTop: 8 }}>
        <label>Settings tab PIN (opens this screen)</label>
        <input
          className="input"
          inputMode="numeric"
          maxLength={4}
          value={settingsPin}
          onChange={(e) => setSettingsPin(e.target.value.replace(/\D/g, ''))}
        />
      </div>

      {(!valid || !unique || !hasAdmin || !/^\d{4}$/.test(settingsPin)) && (
        <div className="small" style={{ color: 'var(--danger)', marginBottom: 8 }}>
          Every user needs a name and a 4-digit PIN; PINs must be unique, at least one manager is
          required, and the Settings PIN must be 4 digits.
        </div>
      )}
      <SaveRow
        dirty={dirty && valid && unique && hasAdmin && /^\d{4}$/.test(settingsPin)}
        onSave={() => {
          updateAuth({ users: draft, settingsPin });
          notify('Users saved', 'ok');
        }}
      />
    </div>
  );
}

function DataSection() {
  const {
    state, setAutoBackup,
    exportJson, importState, resetToDemo, notify,
    exportMenu, importMenuJson, snapshotNow, listBackups, restoreBackup,
  } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [backups, setBackups] = useState<{ ts: number; label: string; bills: number }[]>([]);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);

  const refreshBackups = () => {
    void listBackups().then(setBackups);
  };
  useEffectOnce(refreshBackups);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== 'object') {
          notify('Not a valid JSON file', 'err');
          return;
        }
        if (Array.isArray(parsed.orders) && parsed.version === 1) {
          importState(parsed); // full backup
        } else if (Array.isArray(parsed.categories) && Array.isArray(parsed.items)) {
          importMenuJson(parsed); // menu-only backup
        } else {
          notify('Not a valid backup file', 'err');
        }
      } catch {
        notify('Could not read that file', 'err');
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  return (
    <div className="card" style={{ margin: '0 14px 12px' }}>
      <div className="section-title" style={{ marginTop: 0 }}>Data & backup</div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="btn btn-ghost grow" onClick={exportJson}>⬇️ Full backup</button>
        <button className="btn btn-ghost grow" onClick={() => fileRef.current?.click()}>⬆️ Import file</button>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="btn btn-ghost grow" onClick={exportMenu}>🍽 Export menu</button>
        <button className="btn btn-ghost grow" onClick={snapshotNow}>📸 Backup now</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={handleFile} />

      <div className="section-title" style={{ marginTop: 8 }}>Auto-backup</div>
      <Chips style={{ padding: 0, marginBottom: 6 }}>
        {(['off', 'daily', 'weekly', 'monthly'] as const).map((f) => (
          <button
            key={f}
            className={`chip ${state.autoBackup === f ? 'active' : ''}`}
            onClick={() => setAutoBackup(f)}
          >
            {f === 'off' ? 'Off' : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </Chips>
      <div className="small muted" style={{ marginBottom: 8 }}>
        {state.autoBackup === 'off'
          ? 'Automatic snapshots are off — use “Backup now” to save a snapshot manually.'
          : `A snapshot is saved automatically ${state.autoBackup === 'daily' ? 'every day' : state.autoBackup === 'weekly' ? 'every week' : 'every month'}, right on this device, so data can be restored if anything goes wrong.`}
      </div>

      <div className="small muted" style={{ marginBottom: 8 }}>
        Import accepts a full backup (restores everything) or a menu file (restores categories & items only).
      </div>

      {backups.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 8 }}>Auto-snapshots (on this device)</div>
          {backups.map((b) => (
            <div className="row row-between" key={b.ts} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <div className="grow">
                <div className="small bold">
                  {new Date(b.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  {b.label !== 'manual' && <span className="badge badge-muted" style={{ marginLeft: 6 }}>Auto · {b.label}</span>}
                </div>
                <div className="small muted">{b.bills} paid bill(s) in snapshot</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRestore(b.ts)}>Restore</button>
            </div>
          ))}
        </>
      )}

      <div className="divider" />
      <button className="btn btn-danger btn-block" onClick={() => setConfirmReset(true)}>
        Reset to demo data
      </button>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset everything?">
        <p className="small">This deletes all orders, items and settings on this device and restores the demo restaurant. Export a backup first if you need it.</p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-danger grow" onClick={() => { resetToDemo(); setConfirmReset(false); }}>Yes, reset</button>
          <button className="btn btn-ghost grow" onClick={() => setConfirmReset(false)}>Cancel</button>
        </div>
      </Modal>

      <Modal open={confirmRestore !== null} onClose={() => setConfirmRestore(null)} title="Restore this snapshot?">
        <p className="small">
          This replaces the current data on this device with the snapshot from{' '}
          {confirmRestore !== null ? new Date(confirmRestore).toLocaleString('en-IN') : ''}. A backup of your current
          data will still be available as a daily snapshot.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn btn-primary grow"
            onClick={() => {
              if (confirmRestore !== null) void restoreBackup(confirmRestore);
              setConfirmRestore(null);
              refreshBackups();
            }}
          >
            Restore
          </button>
          <button className="btn btn-ghost grow" onClick={() => setConfirmRestore(null)}>Cancel</button>
        </div>
      </Modal>
    </div>
  );
}

function useEffectOnce(fn: () => void) {
  const ref = useRef(false);
  if (!ref.current) {
    ref.current = true;
    fn();
  }
}
