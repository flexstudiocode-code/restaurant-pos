import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { isDesktop } from '../desktop';
import { isEditableTarget } from '../shortcuts';
import type { KOT } from '../types';
import { fmtQty } from '../money';
import { fmtTime, duration } from '../format';
import { Modal, EmptyState } from '../components/ui';
import { IconPrint, IconCheck } from '../components/icons';
import { thermalWidthMm } from '../types';
import { connectThermal, printRaster, useThermal, dotsForMm } from '../thermal';
import { printViaUsb, useUsbPrinter } from '../usbThermal';
import { buildKotText, rasterWidthFor } from '../receipt';
import { beepNewKot, primeKitchenSound } from '../kitchenAlerts';

const SOUND_KEY = 'kitchen-sound';
const WARN_MINUTES = 5; // pending ≥ 5 min → amber
const LATE_MINUTES = 10; // pending ≥ 10 min → red + pulse
const REBEEP_MS = 30_000; // re-beep while the newest pending KOT is unhandled

function kitchenSoundOn(): boolean {
  try {
    return (localStorage.getItem(SOUND_KEY) ?? 'on') === 'on';
  } catch {
    return true;
  }
}

function setKitchenSound(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

/** Minutes since a KOT was created (for the aging indicator). */
function ageMinutes(kot: KOT, now: number): number {
  return Math.floor(Math.max(0, now - kot.createdAt) / 60_000);
}

/** Aging class for a pending KOT: '' | 'warn' | 'late'. */
function agingClass(kot: KOT, now: number): string {
  if (kot.status !== 'pending') return '';
  const mins = ageMinutes(kot, now);
  if (mins >= LATE_MINUTES) return 'late';
  if (mins >= WARN_MINUTES) return 'warn';
  return '';
}

export function KitchenScreen() {
  const { state, markKot, notify } = useStore();
  const thermal = useThermal();
  const usb = useUsbPrinter();
  const [filter, setFilter] = useState<'pending' | 'ready' | 'all'>('pending');
  const [printKot, setPrintKot] = useState<KOT | null>(null);
  const [soundOn, setSoundOn] = useState(kitchenSoundOn);
  const [now, setNow] = useState(() => Date.now());

  // KOT raster: same paper width as the receipt, wrapped at the same char
  // width so a larger font-size setting prints a larger ticket (long item
  // names wrap onto extra lines instead of shrinking the whole ticket).
  const mm = thermalWidthMm(state.billing.thermalWidth, state.billing.thermalCustomWidth);
  const dots = dotsForMm(mm);
  const kotWidth = rasterWidthFor(mm, state.billing.billLayout?.fontSizePct);

  const kots = useMemo(() => {
    const list = [...state.kots].sort((a, b) => b.createdAt - a.createdAt);
    return filter === 'all' ? list : list.filter((k) => k.status === filter);
  }, [state.kots, filter]);

  const pendingCount = state.kots.filter((k) => k.status === 'pending').length;

  // ── New-KOT sound alert ────────────────────────────────────────────────
  // Beeps when the newest pending KOT changes: a ticket just arrived (own
  // send, LAN-synced from a waiter phone, or a split creating a ticket), or
  // the previous newest was handled while older ones still wait. Re-beeps
  // every 30s while a pending KOT stays unhandled. Id-based, so tab switches
  // or the ready/all filter never re-beep old tickets.
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
  const lastAlerted = useRef<string | null>(null);

  const newestPending = useMemo(
    () =>
      state.kots.reduce<KOT | null>(
        (n, k) => (k.status === 'pending' && (!n || k.createdAt > n.createdAt) ? k : n),
        null
      ),
    [state.kots]
  );

  useEffect(() => {
    if (newestPending === null) {
      lastAlerted.current = null;
      return;
    }
    if (lastAlerted.current !== newestPending.id && soundOnRef.current) {
      primeKitchenSound();
      beepNewKot();
    }
    lastAlerted.current = newestPending.id;
    const id = window.setInterval(() => {
      if (soundOnRef.current) {
        primeKitchenSound();
        beepNewKot();
      }
    }, REBEEP_MS);
    return () => window.clearInterval(id);
  }, [newestPending]);

  // Unlock the AudioContext on the first user gesture (mobile autoplay rules)
  // and tick the aging clock every 30s so elapsed times stay fresh.
  useEffect(() => {
    const unlock = () => primeKitchenSound();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.clearInterval(id);
    };
  }, []);

  // ── Desktop keyboard flow ──────────────────────────────────────────────
  // ↑/↓ select a KOT; Enter/F2 → Ready, F3 → Served, P → print, 1/2/3 filter.
  const [hl, setHl] = useState(0);

  useEffect(() => setHl(0), [kots]);

  useEffect(() => {
    if (!isDesktop() || kots.length === 0) return;
    const el = document.querySelector(`[data-kot="${kots[Math.min(hl, kots.length - 1)]?.id}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [hl, kots]);

  useEffect(() => {
    if (!isDesktop()) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (printKot) return; // print dialog is open — leave keys to it
      const kot = kots[Math.min(hl, kots.length - 1)];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHl((h) => Math.min(h + 1, Math.max(0, kots.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHl((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'F2' || e.key === 'F3') {
        if (!kot) return;
        e.preventDefault();
        const no = `#${String(kot.kotNo).padStart(3, '0')}`;
        if (kot.status === 'pending' && (e.key === 'Enter' || e.key === 'F2')) {
          markKot(kot.id, 'ready');
          notify(`KOT ${no} ready`, 'ok');
        } else if (kot.status === 'ready' && (e.key === 'Enter' || e.key === 'F3')) {
          const order = state.orders.find((o) => o.id === kot.orderId);
          if (order?.status === 'paid') {
            notify('This bill is already paid — just serve it', 'info');
            return;
          }
          markKot(kot.id, 'served');
          notify(`KOT ${no} served`, 'ok');
        } else if (kot.status === 'pending') {
          notify(`KOT ${no} is still pending — press F2 to mark ready`, 'info');
        } else {
          notify(`KOT ${no} already served`, 'info');
        }
      } else if ((e.key === 'p' || e.key === 'P') && kot) {
        e.preventDefault();
        setPrintKot(kot);
      } else if (e.key === '1') {
        e.preventDefault();
        setFilter('pending');
      } else if (e.key === '2') {
        e.preventDefault();
        setFilter('ready');
      } else if (e.key === '3') {
        e.preventDefault();
        setFilter('all');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kots, hl, printKot, markKot, notify, state.orders]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setKitchenSound(next);
    if (next) {
      primeKitchenSound();
      beepNewKot(); // audible confirmation + unlocks audio after the gesture
    }
  };

  return (
    <div>
      <div className="section" style={{ paddingBottom: 6 }}>
        <div className="row-between">
          <div className="section-title" style={{ margin: 0 }}>
            Kitchen display
          </div>
          <div className="row" style={{ gap: 4 }}>
            {pendingCount > 0 && <span className="badge badge-warn">{pendingCount} pending</span>}
            <button
              className="icon-btn"
              title={soundOn ? 'Sound on — tap to mute the new-order beep' : 'Muted — tap to unmute the new-order beep'}
              onClick={toggleSound}
            >
              {soundOn ? '🔔' : '🔕'}
            </button>
          </div>
        </div>
      </div>

      {isDesktop() && (
        <div className="small muted" style={{ margin: '0 14px 8px' }}>
          ⌨ ↑/↓ select · Enter/F2 ready · F3 served · P print · 1/2/3 filter
        </div>
      )}

      <div className="seg" style={{ margin: '0 14px 12px' }}>
        <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
          Pending ({state.kots.filter((k) => k.status === 'pending').length})
        </button>
        <button className={filter === 'ready' ? 'active' : ''} onClick={() => setFilter('ready')}>
          Ready ({state.kots.filter((k) => k.status === 'ready').length})
        </button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          All ({state.kots.length})
        </button>
      </div>

      <div style={{ padding: '0 14px' }}>
        {kots.length === 0 && (
          <EmptyState icon="🔥" text="No KOTs here right now." />
        )}
        {kots.map((k, i) => {
          const order = state.orders.find((o) => o.id === k.orderId);
          const isPaid = order?.status === 'paid';
          const aging = agingClass(k, now);
          const ageMin = ageMinutes(k, now);
          return (
            <div
              key={k.id}
              data-kot={k.id}
              className={`kot-card ${k.status} ${aging ? `age-${aging}` : ''} ${isDesktop() && i === hl ? 'keyboard-hl' : ''}`}
            >
              <div className="row-between" style={{ marginBottom: 6 }}>
                <div className="bold" style={{ fontSize: 15 }}>
                  KOT #{String(k.kotNo).padStart(3, '0')} · {k.tableLabel}
                </div>
                <div className="small muted">
                  {fmtTime(k.createdAt)}
                  {k.status === 'pending' && ageMin >= 1 && (
                    <span className={`kot-age ${aging}`}> · {duration(now - k.createdAt)}</span>
                  )}
                </div>
              </div>
              {k.orderNote && (
                <div className="kot-item" style={{ background: 'var(--accent-soft)', borderRadius: 8, padding: '6px 8px' }}>
                  <span className="grow">📝 {k.orderNote}</span>
                </div>
              )}
              {k.items.map((it, i) => (
                <div className="kot-item" key={i}>
                  <span className="q">{fmtQty(it.qty)}×</span>
                  <span className="grow">
                    {it.name}
                    {it.note && <div className="note">— {it.note}</div>}
                  </span>
                </div>
              ))}
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setPrintKot(k)}>
                  <IconPrint width={15} height={15} /> Print
                </button>
                <div className="grow" />
                {k.status === 'pending' && (
                  <button className="btn btn-accent btn-sm" onClick={() => markKot(k.id, 'ready')}>
                    <IconCheck width={15} height={15} /> Ready
                  </button>
                )}
                {k.status === 'ready' && !isPaid && (
                  <button className="btn btn-primary btn-sm" onClick={() => markKot(k.id, 'served')}>
                    Served
                  </button>
                )}
                {k.status === 'ready' && isPaid && (
                  <span className="badge badge-ok">Bill paid · serve</span>
                )}
                {k.status === 'served' && <span className="badge badge-muted">Served</span>}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={!!printKot} onClose={() => setPrintKot(null)} title="Print KOT">
        {printKot && (
          <div className="kot-print" style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>
            <div className="kot-name" style={{ textAlign: 'center' }}>
              {state.profile.name}
            </div>
            <div style={{ textAlign: 'center', margin: '4px 0 8px' }}>
              KOT #{String(printKot.kotNo).padStart(3, '0')} · {printKot.tableLabel} · {fmtTime(printKot.createdAt)}
            </div>
            <div style={{ borderTop: '1px dashed #333', margin: '6px 0' }} />
            {printKot.items.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                <span style={{ fontWeight: 800, width: 28 }}>{fmtQty(it.qty)}×</span>
                <span style={{ flex: 1 }}>
                  {it.name}
                  {it.note && <span style={{ fontStyle: 'italic', color: '#555' }}> ({it.note})</span>}
                </span>
              </div>
            ))}
            <div style={{ borderTop: '1px dashed #333', margin: '8px 0 6px' }} />
            <div style={{ textAlign: 'center', fontSize: 12 }}>Time: {fmtTime(printKot.createdAt)}</div>
          </div>
        )}
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn-ghost grow" onClick={() => window.print()}>
            <IconPrint width={16} height={16} /> Print
          </button>
          <button
            className="btn btn-primary grow"
            disabled={thermal.busy}
            onClick={async () => {
              const kot = printKot;
              if (!kot) return;
              if (!thermal.connected) {
                const res = await connectThermal();
                if (!res.ok) {
                  notify(res.error ?? 'Could not connect', 'err');
                  return;
                }
              }
              const err = await printRaster(
                buildKotText(kot, state.profile.name, kotWidth),
                dots,
                { scriptLines: 1, centerLines: 1 }
              );
              notify(err ? err : 'KOT sent to thermal printer', err ? 'err' : 'ok');
            }}
          >
            🖨 {thermal.connected ? 'Thermal ✓' : 'Thermal'}
          </button>
          {isDesktop() && (
            <button
              className="btn btn-ghost grow"
              disabled={usb.busy}
              onClick={async () => {
                const kot = printKot;
                if (!kot) return;
                const res = await printViaUsb(
                  buildKotText(kot, state.profile.name, kotWidth),
                  dots,
                  { scriptLines: 1, centerLines: 1 }
                );
                if (res.ok) notify('KOT sent to USB printer', 'ok');
                else notify(res.error ?? 'Could not print', 'err');
              }}
            >
              🔌 {usb.selected ? 'USB ✓' : 'USB'}
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}
