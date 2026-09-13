// Display formatting for dates/times. All local time.

const pad = (n: number) => String(n).padStart(2, '0');

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(h)}:${pad(d.getMinutes())} ${ampm}`;
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function fmtDateTime(ms: number): string {
  return `${fmtDate(ms)} ${fmtTime(ms)}`;
}

export function fmtDay(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]}, ${pad(d.getDate())} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()}`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function invoiceLabel(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(4, '0')}`;
}

/**
 * Split the restaurant name into a display title + trailing word for the
 * bill header: "Meadows Park Restaurant" → main "Meadows Park" and suffix
 * "Restaurant". Splits at the last space; single-word names keep everything
 * in the title. Shared by the on-screen/system-printed bill (Brush Script MT
 * title + sans-serif suffix) and the thermal raster receipt (two lines).
 */
export function splitBillName(name: string): { main: string; suffix: string } {
  const trimmed = name.trim();
  const i = trimmed.lastIndexOf(' ');
  if (i <= 0) return { main: trimmed, suffix: '' };
  return { main: trimmed.slice(0, i).trim(), suffix: trimmed.slice(i + 1).trim() };
}
