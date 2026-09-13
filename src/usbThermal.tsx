// USB thermal printing for the desktop app (Electron).
//
// The Electron main process lists installed printers and can write raw
// ESC/POS bytes to them over the OS print queue (electron/main.cjs →
// installPrinterIpc). This module keeps track of the chosen printer
// (persisted locally) and sends the same 1-bit raster receipts/KOTs that the
// Bluetooth path uses, so output is identical on every printer.

import { useEffect, useSyncExternalStore, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getDesktop, isDesktop, type DesktopPrinterInfo } from './desktop';
import { thermalWidthMm } from './types';
import { buildEscPosRaster, type RasterOptions } from './thermal';
import { base64FromBytes } from './nativeThermal';
import { useStore } from './store';

const SELECTED_KEY = 'nellara-usb-printer';
const WIDTH_CACHE_KEY = 'nellara-usb-printer-widths';

/** Detected paper width (mm) remembered per printer, so re-selecting a
 *  printer reapplies its width instantly without waiting on the driver. */
let widthCache: Record<string, number> = {};
try {
  widthCache = JSON.parse(localStorage.getItem(WIDTH_CACHE_KEY) ?? '{}') as Record<string, number>;
} catch {
  /* ignore */
}

function rememberWidth(name: string, mm: number): void {
  widthCache = { ...widthCache, [name]: mm };
  try {
    localStorage.setItem(WIDTH_CACHE_KEY, JSON.stringify(widthCache));
  } catch {
    /* ignore */
  }
}

function cachedWidth(name: string): number | null {
  const v = widthCache[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface UsbPrinterStatus {
  supported: boolean; // desktop app with the printer bridge
  printers: DesktopPrinterInfo[];
  selected: string | null; // printer name
  detectedWidth: number | null; // detected paper width (mm), from the driver
  busy: boolean;
}

function initial(): UsbPrinterStatus {
  let selected: string | null = null;
  try {
    selected = localStorage.getItem(SELECTED_KEY);
  } catch {
    /* storage unavailable */
  }
  return {
    supported: isDesktop() && !!getDesktop(),
    printers: [],
    selected,
    detectedWidth: null,
    busy: false,
  };
}

let status: UsbPrinterStatus = initial();
const listeners = new Set<() => void>();

function setStatus(patch: Partial<UsbPrinterStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React hook for the current USB printer status. */
export function useUsbPrinter(): UsbPrinterStatus {
  return useSyncExternalStore(subscribe, () => status);
}

/** Reload the list of installed printers from the OS. */
export async function refreshUsbPrinters(): Promise<DesktopPrinterInfo[]> {
  const desktop = getDesktop();
  if (!desktop) return [];
  try {
    const printers = await desktop.printers.list();
    setStatus({ printers });
    return printers;
  } catch {
    return [];
  }
}

/** Fallback: guess the roll width from the printer model name (e.g. POS-80C,
 *  TM-T82, “80mm”), used when the driver doesn't expose a paper size. */
function widthFromName(name: string): number | null {
  const n = name.toLowerCase();
  const mm = /(\d{1,3})\s*mm/.exec(n);
  if (mm) {
    const v = Number(mm[1]);
    if (v >= 50 && v <= 90) return v;
  }
  if (/(^|[^0-9])80([^0-9]|$)/.test(n)) return 80;
  if (/(^|[^0-9])58([^0-9]|$)/.test(n)) return 58;
  return null;
}

/** Detect the paper width (mm) of a printer: OS driver first, name fallback. */
export async function detectPrinterWidth(name: string): Promise<number | null> {
  const desktop = getDesktop();
  if (desktop) {
    try {
      const mm = await desktop.printers.detectWidth(name);
      if (typeof mm === 'number' && Number.isFinite(mm)) return mm;
    } catch {
      /* fall through to the name heuristic */
    }
  }
  return widthFromName(name);
}

/** Re-run paper-width detection for a printer and store the result. */
export async function refreshDetectedWidth(name: string | null): Promise<number | null> {
  if (!name) {
    setStatus({ detectedWidth: null });
    return null;
  }
  const mm = await detectPrinterWidth(name);
  setStatus({ detectedWidth: mm });
  return mm;
}

/** Set by ThermalWidthAutoSync (rendered inside StoreProvider) so a detected
 *  paper width can update the billing setting + notify the user. */
let autoApplyWidth: ((mm: number) => void) | null = null;

export function registerThermalWidthAutoApply(fn: ((mm: number) => void) | null): () => void {
  autoApplyWidth = fn;
  return () => {
    autoApplyWidth = null;
  };
}

/** Renderless component (mount inside StoreProvider): when a USB printer's
 *  paper width is detected (58/80mm or a custom roll like 76mm), auto-set the
 *  receipt width to match. */
export function ThermalWidthAutoSync() {
  const { state, updateBilling, notify } = useStore();
  useEffect(() => {
    return registerThermalWidthAutoApply((mm) => {
      const current = thermalWidthMm(state.billing.thermalWidth, state.billing.thermalCustomWidth);
      if (current === mm) return; // already set — don't nag
      if (mm === 58 || mm === 80) {
        updateBilling({ thermalWidth: mm === 58 ? '58' : '80' });
      } else {
        updateBilling({ thermalWidth: 'custom', thermalCustomWidth: mm });
      }
      notify(`USB printer paper detected: ${mm}mm — receipt width set to match`, 'ok');
    });
  }, [updateBilling, notify, state.billing]);
  return null;
}

/** Remember the chosen printer (persisted for next time) and detect its paper. */
export function selectUsbPrinter(name: string | null): void {
  setStatus({ selected: name, detectedWidth: null });
  try {
    if (name) localStorage.setItem(SELECTED_KEY, name);
    else localStorage.removeItem(SELECTED_KEY);
  } catch {
    /* ignore */
  }
  if (!name) return;
  // Apply instantly from memory (previous detection) or the name, then
  // re-check with the driver and remember the exact result.
  const quick = cachedWidth(name) ?? widthFromName(name);
  if (quick) {
    setStatus({ detectedWidth: quick });
    autoApplyWidth?.(quick);
  }
  void detectPrinterWidth(name).then((mm) => {
    if (mm !== null) rememberWidth(name, mm);
    setStatus({ detectedWidth: mm });
    if (mm !== null) autoApplyWidth?.(mm);
  });
}

function base64Of(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  try {
    return btoa(bin);
  } catch {
    return base64FromBytes(bytes);
  }
}

async function sendToUsb(
  printerName: string,
  text: string,
  dots: number,
  opts: RasterOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  const desktop = getDesktop();
  if (!desktop) return { ok: false, error: 'Desktop bridge unavailable' };
  try {
    setStatus({ busy: true });
    // The ESC/POS CUT rides in the same byte stream right after the raster +
    // generous paper feed, so the printer executes it in order — the paper is
    // cut automatically once the receipt has fully printed, with no waiting
    // and no chance of the cut clipping the bottom of the bill.
    const err = await desktop.printers.printAndCut(printerName, base64Of(await buildEscPosRaster(text, dots, opts)));
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Print failed' };
  } finally {
    setStatus({ busy: false });
  }
}

/**
 * Print a receipt/KOT text to the USB printer. If no printer has been chosen
 * yet, an in-app picker lists the installed printers; picking one remembers
 * it for next time.
 */
export async function printViaUsb(
  text: string,
  dots: number,
  opts: RasterOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  const desktop = getDesktop();
  if (!desktop) return { ok: false, error: 'USB printing is only available in the desktop app' };
  let name = status.selected;
  if (!name) {
    const picked = await pickUsbPrinter();
    if (!picked) return { ok: false, error: 'No printer selected' };
    name = picked.name;
    selectUsbPrinter(name);
  }
  return sendToUsb(name, text, dots, opts);
}

// ESC/POS `GS V 0` — full cut. Sent alone when the user taps “Cut paper”.
const CUT_CMD = new Uint8Array([0x1d, 0x56, 0x00]);

/**
 * Send just the ESC/POS CUT command to the USB printer (no receipt) — e.g.
 * to cut a receipt that's still hanging out of the printer. Picks a printer
 * first if none has been chosen yet.
 */
export async function usbCut(): Promise<{ ok: boolean; error?: string }> {
  const desktop = getDesktop();
  if (!desktop) return { ok: false, error: 'USB printing is only available in the desktop app' };
  let name = status.selected;
  if (!name) {
    const picked = await pickUsbPrinter();
    if (!picked) return { ok: false, error: 'No printer selected' };
    name = picked.name;
    selectUsbPrinter(name);
  }
  try {
    setStatus({ busy: true });
    const err = await desktop.printers.printRaw(name, base64Of(CUT_CMD));
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Cut failed' };
  } finally {
    setStatus({ busy: false });
  }
}

/** Short test page for a chosen printer. */
export async function usbTestPrint(
  printerName: string | null,
  restaurantName: string,
  dots: number
): Promise<{ ok: boolean; error?: string }> {
  if (!printerName) return { ok: false, error: 'No printer selected' };
  const text = [
    '      THERMAL PRINTER TEST (USB)',
    '',
    `      ${restaurantName || 'Meadows Park Restaurant'}`,
    '',
    'If you can read this, the',
    'printer is working correctly.',
    '',
    `Dots: ${dots}  ·  ${new Date().toLocaleString('en-IN')}`,
  ].join('\n');
  return sendToUsb(printerName, text, dots);
}

// ── In-app printer picker (desktop) ───────────────────────────────────────

function pickUsbPrinter(): Promise<DesktopPrinterInfo | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (v: DesktopPrinterInfo | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<UsbPrinterPicker onPick={close} onCancel={() => close(null)} />);
  });
}

function UsbPrinterPicker({
  onPick,
  onCancel,
}: {
  onPick: (p: DesktopPrinterInfo) => void;
  onCancel: () => void;
}) {
  const [printers, setPrinters] = useState<DesktopPrinterInfo[]>([]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    void refreshUsbPrinters().then((list) => {
      setPrinters(list);
      // Show remembered/guessed widths right away, then refresh from the driver.
      const quick: Record<string, number> = {};
      for (const p of list) {
        const w = cachedWidth(p.name) ?? widthFromName(p.name);
        if (w) quick[p.name] = w;
      }
      setWidths(quick);
      setLoading(false);
      void Promise.all(list.map((p) => detectPrinterWidth(p.name).catch(() => null))).then((results) => {
        const next: Record<string, number> = {};
        list.forEach((p, i) => {
          const mm = results[i];
          if (mm !== null) {
            rememberWidth(p.name, mm);
            next[p.name] = mm;
          }
        });
        setWidths((prev) => ({ ...prev, ...next }));
      });
    });
  };

  useEffect(load, []);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal" style={{ width: 'min(92vw, 420px)' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16.5 }}>🖨 USB printer</h2>
        {loading ? (
          <p className="small muted">Loading printers…</p>
        ) : printers.length === 0 ? (
          <div>
            <p className="small muted">
              No printers found. Make sure the printer is connected to this computer with
              the USB cable and its driver is installed (Windows: it appears in Settings →
              Devices → Printers). Then tap Refresh.
            </p>
            <button className="btn btn-ghost btn-block" onClick={load}>
              🔄 Refresh
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8, maxHeight: 280, overflowY: 'auto', margin: '4px 0 12px' }}>
            {printers.map((p) => (
              <button
                key={p.name}
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => onPick(p)}
              >
                🖨 {p.displayName}
                {widths[p.name] ? ` · ${widths[p.name]}mm` : ''}
                {p.isDefault ? ' (default)' : ''}
                {p.status !== 'idle' && p.status ? ` · ${p.status}` : ''}
              </button>
            ))}
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          {printers.length > 0 && (
            <button className="btn btn-ghost grow" onClick={load}>
              🔄 Refresh
            </button>
          )}
          <button className="btn btn-primary grow" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
