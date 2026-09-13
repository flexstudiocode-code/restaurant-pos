// Placeholder substitution for user-editable bill header/footer lines, plus
// helpers for the bill font-size / thickness controls.
// Used by ReceiptScreen (on-screen + print), receipt.ts (thermal/WhatsApp)
// and the BillDesignScreen preview.

import type { CSSProperties } from 'react';
import type { BillLayout, Order, State } from './types';
import { fmtDate, fmtTime } from './format';
import { tableLabel } from './selectors';

/** Replace {placeholders} in a custom bill line with live order data. */
export function applyBillPlaceholders(text: string, state: State, order: Order): string {
  const p = state.profile;
  const at = order.paidAt ?? order.createdAt;
  const map: Record<string, string> = {
    name: p.name,
    address: p.address,
    phone: p.phone,
    fssai: p.fssai,
    invoice: order.invoiceNo || '',
    date: fmtDate(at),
    time: fmtTime(at),
    cashier: order.closedBy || order.staffName,
    covers: String(order.lines.reduce((s, l) => s + l.qty, 0)),
    table: order.tableIndex !== null ? tableLabel(state, order) : '',
    type:
      order.type === 'dine-in'
        ? 'Dine-in'
        : order.type === 'takeaway'
          ? 'Takeaway'
          : 'Delivery',
  };
  return text.replace(/\{(\w+)\}/g, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : m
  );
}

/** Clamp the saved font-size percent into the supported range. */
export function billFontSizePct(layout: BillLayout | undefined | null): number {
  const pct = Math.round(Number(layout?.fontSizePct) || 100);
  return Math.min(150, Math.max(80, pct));
}

/** Numeric font-weight (400/700/800) for the bill's body text. */
export function billWeightNumber(layout: BillLayout | undefined | null): number {
  const w = layout?.fontWeight ?? 'regular';
  return w === 'extrabold' ? 800 : w === 'bold' ? 700 : 400;
}

/** CSS custom properties that scale/thicken the receipt on screen and in the
 *  system Print dialog. Set as the inline style of the `.receipt-shell` div. */
export function billFontStyle(layout: BillLayout | undefined | null): CSSProperties {
  return {
    '--bill-scale': String(billFontSizePct(layout) / 100),
    '--bill-weight': String(billWeightNumber(layout)),
  } as CSSProperties;
}
