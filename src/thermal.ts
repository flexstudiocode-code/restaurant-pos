// Thermal receipt printing over Web Bluetooth (ESC/POS).
//
// How it works:
//  - Connects to a Bluetooth thermal printer (most 58mm/80mm ESC/POS printers
//    expose the standard 0xFF00 serial service).
//  - Renders the receipt text to a 1-bit raster image on a hidden canvas, so
//    Unicode (₹, Malayalam…) prints correctly on any ESC/POS printer.
//  - Sends the raster via the "GS v 0" command in small chunks.
//
// Requires Chrome/Edge (Android or desktop) over HTTPS (or localhost). In the
// native Android app the same raster bytes go out over a classic Bluetooth SPP
// socket via the BluetoothThermal plugin instead (see nativeThermal.ts). If
// Bluetooth is unavailable, the app still prints via the system dialog.

import { useSyncExternalStore } from 'react';
import {
  base64FromBytes,
  isNativeApp,
  nativeConnect,
  nativeDisconnect,
  nativeOnDisconnected,
  nativeWrite,
} from './nativeThermal';
import { showDevicePicker } from './components/DevicePicker';

const THERMAL_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
const LAST_ADDRESS_KEY = 'nellara-thermal-address';

export interface ThermalStatus {
  supported: boolean; // Web Bluetooth available in this browser
  connected: boolean;
  name: string | null;
  busy: boolean;
}

const INITIAL: ThermalStatus = {
  supported: isNativeApp() || (typeof navigator !== 'undefined' && 'bluetooth' in navigator),
  connected: false,
  name: null,
  busy: false,
};

let status: ThermalStatus = INITIAL;
let device: BluetoothDevice | null = null;
let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
const listeners = new Set<() => void>();

function setStatus(patch: Partial<ThermalStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React hook for current printer status. */
export function useThermal(): ThermalStatus {
  return useSyncExternalStore(subscribe, () => status);
}

export function isBluetoothSupported(): boolean {
  return isNativeApp() || (typeof navigator !== 'undefined' && 'bluetooth' in navigator);
}

// ── ESC/POS command builders ──────────────────────────────────────────────

function escInit(): Uint8Array {
  return new Uint8Array([0x1b, 0x40]);
}
function escFeed(n: number): Uint8Array {
  return new Uint8Array([0x1b, 0x64, n & 0xff]);
}
function gsCut(): Uint8Array {
  return new Uint8Array([0x1d, 0x56, 0x00]);
}
function rasterCommand(widthDots: number, height: number, data: Uint8Array): Uint8Array {
  const bytesPerRow = Math.ceil(widthDots / 8);
  const cmd = new Uint8Array(8 + bytesPerRow * height);
  cmd[0] = 0x1d; cmd[1] = 0x76; cmd[2] = 0x30; cmd[3] = 0x00; // GS v 0, m=0 (normal)
  cmd[4] = bytesPerRow & 0xff;
  cmd[5] = (bytesPerRow >> 8) & 0xff;
  cmd[6] = height & 0xff;
  cmd[7] = (height >> 8) & 0xff;
  cmd.set(data, 8);
  return cmd;
}

// ── Raster rendering ──────────────────────────────────────────────────────

interface Bitmap {
  widthDots: number;
  height: number;
  data: Uint8Array;
}

export interface RasterOptions {
  /** Leading lines rendered in the script header font (restaurant name). */
  scriptLines?: number;
  /** Lines right after the script lines, rendered as the sans-serif subtitle
   *  (e.g. “RESTAURANT”) — mirrors the on-screen two-line bill header. */
  subLines?: number;
  /** Body-font lines right after the subtitle that are centred (address,
   *  phone, GSTIN, custom header lines, TAX INVOICE) — mirrors the centred
   *  on-screen header block under the restaurant name. */
  centerLines?: number;
  /** Supersampling factor — text is drawn at this multiple of the dot
   *  resolution, then smoothed down, which removes the stair-step aliasing
   *  that makes 1-bit raster text look ragged. 2 is a good balance. */
  scale?: number;
  /** Include the trailing ESC/POS cut command (`GS V 0`). Default true. The
   *  cut rides in the same byte stream right after the raster + feed, so the
   *  printer executes it in order — after the receipt has fully printed. */
  cut?: boolean;
  /** Body-text weight (400 regular, 700 bold, 800 extra bold) — the bill
   *  design “thickness” setting. The script header keeps its own weight. */
  fontWeight?: number;
}

/** Same script stack as the on-screen bill header (CSS .r-name-main). */
const SCRIPT_FAMILY =
  "'Brush Script MT', 'Meadows Script', 'Brush Script Std', 'Segoe Script', cursive";
/** Same sans-serif stack as the on-screen subtitle (.r-name-sub). */
const SUB_FAMILY = "'Segoe UI', Roboto, Arial, sans-serif";
const BODY_FAMILY = "ui-monospace, Menlo, Consolas, 'Courier New', monospace";

/** Make sure the font families we draw with are loaded before measuring
 *  (measuring an unloaded font returns fallback metrics → wrong sizing).
 *  `document.fonts.load()` takes a single family name, not a stack, so load
 *  each quoted family from `fontSpec` individually. No-op when fonts aren't
 *  ready yet — the canvas then falls back gracefully. */
async function ensureFontLoaded(fontSpec: string): Promise<void> {
  try {
    if (typeof document !== 'undefined' && 'fonts' in document) {
      const families = fontSpec.match(/'([^']+)'|"([^"]+)"/g) ?? [];
      const names = [...new Set(families.map((f) => f.replace(/^['"]|['"]$/g, '')))];
      await Promise.all(names.map((n) => document.fonts.load(`40px "${n}"`)));
      await document.fonts.ready;
    }
  } catch {
    /* ignore */
  }
}

/**
 * Render receipt text into a 1-bit raster (MSB-first) image.
 * `dots` is the printable width: 384 for 58mm, 576 for 80mm at 203dpi.
 *
 * Quality: text is drawn on a canvas `scale`× the dot resolution and then
 * down-sampled with high-quality smoothing before the 1-bit threshold, which
 * turns aliased stair-steps into crisp anti-aliased glyph edges on paper.
 * The first `opts.scriptLines` lines (the restaurant name) are centred and
 * rendered in the script header font so the printed bill matches the screen.
 */
export async function renderTextToRaster(
  text: string,
  dots: number,
  opts: RasterOptions = {}
): Promise<Bitmap> {
  const scriptLines = Math.max(0, Math.floor(opts.scriptLines ?? 0));
  const subLines = Math.max(0, Math.floor(opts.subLines ?? 0));
  const centerLines = Math.max(0, Math.floor(opts.centerLines ?? 0));
  const scale = Math.max(1, Math.min(4, Math.floor(opts.scale ?? 2)));
  const lines = text.split('\n');
  const header = lines.slice(0, scriptLines).map((l) => l.trim()).filter(Boolean);
  const subHeader = lines.slice(scriptLines, scriptLines + subLines).map((l) => l.trim()).filter(Boolean);
  // Header detail block (address, GSTIN, …) is centred in the body font.
  const centeredHeader = lines
    .slice(scriptLines + subLines, scriptLines + subLines + centerLines)
    .map((l) => l.trim())
    .filter(Boolean);
  const body = lines.slice(scriptLines + subLines + centerLines);

  const padX = Math.max(4, Math.floor(dots * 0.02));
  const padY = Math.max(8, Math.floor(dots * 0.02));

  // Body (monospace) font sized so the widest line fits (monospace ≈ 0.62em).
  // Centered header lines count too — they're drawn in the same body font.
  const maxBodyChars = Math.max(1, ...[...centeredHeader, ...body].map((l) => l.length));
  const bodyPx = Math.max(8, Math.floor(dots / (maxBodyChars * 0.62)));
  const bodyLineH = Math.ceil(bodyPx * 1.32);

  // Script header font: load the families, then binary-search the largest size
  // that fits the paper. Measured on a throwaway probe canvas — the render
  // canvas below must have its final size set before any context operation
  // (Chromium drops subsequent fillText if the canvas is resized afterwards).
  let scriptPx = Math.max(10, Math.floor(bodyPx * 1.5));
  if (header.length > 0) {
    await ensureFontLoaded(`40px ${SCRIPT_FAMILY}`);
    const probe = document.createElement('canvas');
    probe.width = dots * scale;
    probe.height = 8;
    const pctx = probe.getContext('2d');
    if (pctx) {
      let lo = 8;
      let hi = 72;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        pctx.font = `${mid * scale}px ${SCRIPT_FAMILY}`;
        const w =
          header.reduce((m, l) => Math.max(m, pctx.measureText(l).width), 0) / scale;
        if (w <= dots - padX * 2) lo = mid;
        else hi = mid;
      }
      scriptPx = Math.floor(lo);
    }
  }
  // Extra leading so script descenders/flourishes don't clip into the next line.
  const headerLineH = Math.ceil(scriptPx * 1.45);
  // Sans-serif subtitle (e.g. “RESTAURANT”): letterspaced uppercase, smaller.
  const subPx = Math.max(10, Math.min(18, Math.floor(scriptPx * 0.32)));
  const subLineH = Math.ceil(subPx * 1.8);

  const height = Math.max(
    32,
    Math.ceil(
      padY * 2 +
        header.length * headerLineH +
        subHeader.length * subLineH +
        (centeredHeader.length + body.length) * bodyLineH
    )
  );

  // 1) Draw at `scale`× resolution (crisp vector text, no pixel snapping).
  const canvas = document.createElement('canvas');
  canvas.width = dots * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { widthDots: dots, height: 0, data: new Uint8Array(0) };

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  let y = padY * scale;
  if (header.length > 0) {
    ctx.font = `${scriptPx * scale}px ${SCRIPT_FAMILY}`;
    ctx.textAlign = 'center';
    for (const ln of header) {
      ctx.fillText(ln, (dots * scale) / 2, y);
      y += headerLineH * scale;
    }
  }
  if (subHeader.length > 0) {
    const ls = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    ctx.font = `800 ${subPx * scale}px ${SUB_FAMILY}`;
    if (ls.letterSpacing !== undefined) ls.letterSpacing = `${(3 * scale).toFixed(1)}px`;
    ctx.textAlign = 'center';
    for (const ln of subHeader) {
      ctx.fillText(ln, (dots * scale) / 2, y);
      y += subLineH * scale;
    }
    if (ls.letterSpacing !== undefined) ls.letterSpacing = '0px';
  }
  const weight = Math.max(400, Math.min(800, Math.round(opts.fontWeight ?? 400)));
  ctx.font = `${weight} ${bodyPx * scale}px ${BODY_FAMILY}`;
  if (centeredHeader.length > 0) {
    ctx.textAlign = 'center';
    for (const ln of centeredHeader) {
      ctx.fillText(ln, (dots * scale) / 2, y);
      y += bodyLineH * scale;
    }
  }
  ctx.textAlign = 'left';
  for (const ln of body) {
    ctx.fillText(ln, padX * scale, y);
    y += bodyLineH * scale;
  }

  // 2) Down-sample to the dot resolution with smoothing → soft edges.
  const out = document.createElement('canvas');
  out.width = dots;
  out.height = height;
  const octx = out.getContext('2d');
  if (!octx) return { widthDots: dots, height: 0, data: new Uint8Array(0) };
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, dots, height);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(canvas, 0, 0, dots, height);

  // 3) 1-bit threshold. Slightly above mid-grey so printed strokes stay bold
  //    (thermal ink fades on the roll).
  const img = octx.getImageData(0, 0, dots, height).data;
  const bytesPerRow = Math.ceil(dots / 8);
  const data = new Uint8Array(bytesPerRow * height);
  for (let yy = 0; yy < height; yy++) {
    for (let x = 0; x < dots; x++) {
      const o = (yy * dots + x) * 4;
      const lum = img[o] * 0.299 + img[o + 1] * 0.587 + img[o + 2] * 0.114;
      if (lum < 140) data[yy * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthDots: dots, height, data };
}

// ── Bluetooth connection & writes ─────────────────────────────────────────

// Largest BLE write chunk we try. Most thermal printers negotiate a large
// MTU, but some stay at the 23-byte default — if a write fails we halve the
// chunk size and retry (see writeChunks) so those printers still work.
let writeChunkSize = 240;

async function writeChunks(bytes: Uint8Array, nativeChunkSize = 240): Promise<void> {
  if (isNativeApp()) {
    for (let i = 0; i < bytes.length; i += nativeChunkSize) {
      await nativeWrite(base64FromBytes(bytes.slice(i, i + nativeChunkSize)));
      // Give the printer a moment to drain its buffer (cheap printers drop
      // data if the host floods them).
      await new Promise((r) => setTimeout(r, 30));
    }
    return;
  }
  if (!characteristic) throw new Error('Printer not connected');
  let i = 0;
  while (i < bytes.length) {
    const chunk = bytes.slice(i, i + writeChunkSize);
    try {
      await characteristic.writeValueWithoutResponse(chunk);
    } catch {
      try {
        await characteristic.writeValue(chunk);
      } catch (e) {
        // The printer's MTU may be smaller than our chunk size — halve the
        // chunk and retry the same offset instead of failing the whole print.
        if (writeChunkSize <= 20) throw e;
        writeChunkSize = Math.max(20, Math.floor(writeChunkSize / 2));
        continue;
      }
    }
    i += chunk.length;
    // Give the printer a moment to drain its buffer (cheap printers drop data
    // if the host floods them).
    await new Promise((r) => setTimeout(r, 30));
  }
}

function onDisconnected() {
  device = null;
  characteristic = null;
  setStatus({ connected: false, name: null });
}

/** Reject `p` if it takes longer than `ms`. */
async function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let t: number | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = window.setTimeout(() => rej(new Error(msg)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t !== undefined) window.clearTimeout(t);
  }
}

let nativeListenersAttached = false;
function attachNativeListeners() {
  if (nativeListenersAttached || !isNativeApp()) return;
  nativeListenersAttached = true;
  nativeOnDisconnected(onDisconnected);
}

/** Build the full ESC/POS payload for a receipt: init + raster + feed + cut.
 *  Pass `{ cut: false }` to omit the cut command — the sender then issues it
 *  as a separate job once printing has finished (see rawPrintWithCut). */
// How many lines the paper feeds after the receipt before the cut. On most
// thermal printers the cutter sits 20–35mm past the print head, so a small
// feed (4 lines ≈ 17mm) leaves the last printed lines between head and cutter
// — the cut then clips the bottom of the bill. 10 lines (≈ 42mm) clears any
// cutter position, so the whole bill stays on the customer's copy.
const CUT_FEED_LINES = 10;

export async function buildEscPosRaster(
  text: string,
  dots: number,
  opts: RasterOptions = {}
): Promise<Uint8Array> {
  const bitmap = await renderTextToRaster(text, dots, opts);
  return concatBytes(
    opts.cut === false
      ? [escInit(), rasterCommand(bitmap.widthDots, bitmap.height, bitmap.data), escFeed(CUT_FEED_LINES)]
      : [escInit(), rasterCommand(bitmap.widthDots, bitmap.height, bitmap.data), escFeed(CUT_FEED_LINES), gsCut()]
  );
}

/**
 * Request + connect to a Bluetooth thermal printer. Must be called from a
 * click. In the native app, pass a specific device `address` to skip the
 * picker, or omit it to use the last printer / show the picker.
 */
export async function connectThermal(addressArg?: string): Promise<{ ok: boolean; error?: string }> {
  if (isNativeApp()) return connectNative(addressArg);
  if (!isBluetoothSupported()) {
    setStatus({ supported: false });
    return {
      ok: false,
      error:
        'Web Bluetooth is not supported in this browser. Use Chrome or Edge (Android/desktop) with HTTPS, or use the system Print button instead.',
    };
  }
  if (status.connected) return { ok: true };
  try {
    const dev = await navigator.bluetooth.requestDevice({
      filters: [{ services: [THERMAL_SERVICE] }],
      optionalServices: [THERMAL_SERVICE],
    });
    const server = await dev.gatt?.connect();
    if (!server) throw new Error('Could not connect to printer');
    const service = await server.getPrimaryService(THERMAL_SERVICE);
    const chars = await service.getCharacteristics();
    let ch: BluetoothRemoteGATTCharacteristic | null = null;
    for (const c of chars) {
      if (c.properties.write || c.properties.writeWithoutResponse) {
        ch = c;
        break;
      }
    }
    if (!ch) throw new Error('Printer exposes no writable characteristic');

    device = dev;
    characteristic = ch;
    dev.addEventListener('gattserverdisconnected', onDisconnected);
    setStatus({ supported: true, connected: true, name: dev.name || 'Thermal printer', busy: false });
    return { ok: true };
  } catch (e) {
    setStatus({ busy: false });
    const msg = e instanceof Error ? e.message : 'Connection failed';
    // The Web Bluetooth "user cancelled the request device" rejection is what
    // the OS/browser reports when the device chooser is dismissed or no
    // matching device is found — make it actionable instead of cryptic.
    if (/cancel/i.test(msg) || /notfound/i.test(msg)) {
      return {
        ok: false,
        error:
          'No printer selected. Make sure the printer is powered on, close to this ' +
          'computer, and not connected to your phone, then tap Connect printer again.',
      };
    }
    return { ok: false, error: msg };
  }
}

async function connectNative(addressArg?: string): Promise<{ ok: boolean; error?: string }> {
  attachNativeListeners();
  if (status.connected) return { ok: true };

  let address = addressArg;
  let pickedName: string | null = null;
  if (!address) {
    address = localStorage.getItem(LAST_ADDRESS_KEY) ?? undefined;
  }
  if (!address) {
    const picked = await showDevicePicker();
    if (!picked) return { ok: false, error: 'No printer selected' };
    address = picked.address;
    pickedName = picked.name;
  }

  setStatus({ busy: true });
  try {
    const res = await withTimeout(nativeConnect(address), 20000, 'Connection timed out');
    if (res.connected) {
      localStorage.setItem(LAST_ADDRESS_KEY, address);
      setStatus({ supported: true, connected: true, name: res.name ?? pickedName ?? 'Thermal printer', busy: false });
      return { ok: true };
    }
    setStatus({ busy: false });
    return { ok: false, error: 'Could not connect to the printer' };
  } catch (e) {
    setStatus({ busy: false });
    return { ok: false, error: e instanceof Error ? e.message : 'Connection failed' };
  }
}

export async function disconnectThermal(): Promise<void> {
  if (isNativeApp()) {
    try {
      await nativeDisconnect();
    } catch {
      /* ignore */
    }
    onDisconnected();
    return;
  }
  if (device && device.gatt?.connected) {
    try {
      device.gatt.disconnect();
    } catch {
      /* ignore */
    }
  }
  onDisconnected();
}

/** Print a raster image plus feed + cut. Returns an error message or null. */
export async function printRaster(
  text: string,
  dots: number,
  opts: RasterOptions = {}
): Promise<string | null> {
  if (!status.connected) return 'Printer not connected';
  try {
    setStatus({ busy: true });
    await writeChunks(await buildEscPosRaster(text, dots, opts));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Print failed';
  } finally {
    setStatus({ busy: false });
  }
}

/** Print a short test page to confirm the printer works. */
export async function testPrint(name: string, dots: number): Promise<string | null> {
  const text = [
    '      THERMAL PRINTER TEST',
    '',
    `      ${name || 'Meadows Park Restaurant'}`,
    '',
    'If you can read this, the',
    'printer is working correctly.',
    '',
    `Dots: ${dots}  ·  ${new Date().toLocaleString('en-IN')}`,
  ].join('\n');
  return printRaster(text, dots);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Printable raster dots for a paper width in mm (ESC/POS 203dpi convention:
 *  58mm → 384 dots, 80mm-class / wider (≥70mm) → 576 dots). */
export function dotsForMm(mm: number): number {
  return mm >= 70 ? 576 : 384;
}
