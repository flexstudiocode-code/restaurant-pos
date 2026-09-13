// Integer-paise money arithmetic. All amounts are integers (paise).
// ₹1 = 100 paise. These helpers are the ONLY place floats meet money.

/** Parse a user-entered rupee string (e.g. "1,250.50") into paise. Returns null if invalid. */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [r = '0', p = ''] = cleaned.split('.');
  const rupees = Number(r);
  const paise = Number(p.padEnd(2, '0'));
  if (!Number.isSafeInteger(rupees) || rupees > 1e9) return null;
  return rupees * 100 + paise;
}

/** Format paise as a rupee string with thousands separators, e.g. ₹1,250.50 */
export function fmt(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const withSep = rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}₹${withSep}${rem ? '.' + String(rem).padStart(2, '0') : ''}`;
}

/** Format paise without the ₹ symbol (for compact tables). */
export function fmtPlain(paise: number): string {
  return fmt(paise).replace('₹', '');
}

/** Convert a percentage of paise: percent(paise, 18) → 18% of paise (rounded). */
export function percent(paise: number, pct: number): number {
  return Math.round((paise * pct) / 100);
}

/** Round paise to the nearest rupee. 50 paise rounds UP (standard Indian practice). */
export function roundToRupee(paise: number): number {
  return Math.round(paise / 100) * 100;
}

/** The round-off difference needed to reach the nearest rupee (for invoices). */
export function roundOffDiff(paise: number): number {
  return roundToRupee(paise) - paise;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Format a quantity: whole numbers without decimals, otherwise 1 decimal max. */
export function fmtQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(1).replace(/\.0$/, '');
}

/** Format paise as a plain number with exactly two decimals and no currency
 *  symbol or separators — e.g. 1520 → '15.20'. Matches classic POS receipt
 *  output (the reference bill layout). */
export function fmtRec2(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const r = Math.floor(abs / 100);
  const p = String(abs % 100).padStart(2, '0');
  return sign + r + '.' + p;
}
