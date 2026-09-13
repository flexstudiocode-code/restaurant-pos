// Builds a fixed-width plain-text receipt (like a real thermal receipt).
// Used by: WhatsApp sharing and the thermal (ESC/POS) raster printer.
// Layout mirrors the reference POS bill: a `Cashier :X` / `Covers: N` top
// row, a Dish/Qty/Amnt column header, item rows with a veg (*) / non-veg (#)
// marker and two-decimal amounts, then totals and a bottom detail block.

import { DEFAULT_BILL_LAYOUT, thermalWidthMm, type KOT, type Order, type State } from './types';
import { buildBill } from './gst';
import { fmtQty, fmtRec2 } from './money';
import { fmtDateTime, fmtTime, splitBillName } from './format';
import { tableLabel } from './selectors';
import { applyBillPlaceholders } from './billLayout';

export type ReceiptWidth = number; // 58mm → 32 chars, 80mm-class (≥70mm) → 48 chars

/** Receipt character width for a paper width in mm. */
export function receiptWidthFor(mm: number): ReceiptWidth {
  return mm >= 70 ? 48 : 32;
}

/** Character width for the thermal/USB raster at a given paper width and bill
 *  font-size setting: a larger font (higher fontSizePct) wraps the receipt at
 *  fewer characters per line, so the text stays on the paper and prints
 *  bigger. 100% = the normal width (32/48 chars). */
export function rasterWidthFor(mm: number, fontSizePct: number): number {
  const base = mm >= 70 ? 48 : 32;
  const pct = Math.min(150, Math.max(80, Math.round(fontSizePct) || 100));
  return Math.max(20, Math.round((base * 100) / pct));
}

export interface ReceiptHeaderStyle {
  /** Leading lines rendered in the script name font (e.g. MEADOWS PARK). */
  scriptLines: number;
  /** Lines right after the script lines, rendered as the sans-serif subtitle
   *  (e.g. “RESTAURANT”) — mirrors the on-screen two-line bill header. */
  subLines: number;
  /** Body-font lines that follow and are centred (address, phone, GSTIN,
   *  FSSAI, custom header lines and the TAX INVOICE label) — mirroring the
   *  centred on-screen header block under the restaurant name. */
  centerLines: number;
}

/** How the bill-header lines are styled on raster printers, matching the
 *  header block that buildReceiptText emits (same conditions, same order), so
 *  the raster centres exactly the lines the screen centres. Keys match
 *  RasterOptions so the value can be passed straight through. */
export function receiptHeaderStyle(state: State, order: Order): ReceiptHeaderStyle {
  const p = state.profile;
  const layout = state.billing.billLayout ?? DEFAULT_BILL_LAYOUT;
  const { main, suffix } = splitBillName(p.name);
  let scriptLines = 0;
  let subLines = 0;
  let centerLines = 0;
  if (layout.showRestaurantName) {
    if (main) scriptLines = 1;
    if (suffix) subLines = 1;
    if (p.address) centerLines++;
    if (p.phone) centerLines++;
    if (p.gstin) centerLines++;
    if (p.fssai) centerLines++;
  }
  for (const line of layout.headerLines) {
    if (applyBillPlaceholders(line, state, order).trim()) centerLines++;
  }
  if (layout.showTaxInvoiceLabel) centerLines++;
  return { scriptLines, subLines, centerLines };
}

// Column widths: amount (right) + qty+marker (centred), name takes the rest.
const AMNT_W = 8;
const QTY_W = 4;

function center(text: string, w: number): string {
  const t = text.length >= w ? text.slice(0, w) : text;
  const pad = Math.max(0, Math.floor((w - t.length) / 2));
  return ' '.repeat(pad) + t;
}

/** Center without truncating — used for the restaurant-name header lines,
 *  which the thermal raster re-fits to the paper by font size (and WhatsApp
 *  simply wraps). Truncating them here would print a clipped name on the
 *  roll whenever the font-size setting narrows the character width. */
function centerNoTrunc(text: string, w: number): string {
  const pad = Math.max(0, Math.floor((w - text.length) / 2));
  return ' '.repeat(pad) + text;
}

function centerStr(text: string, w: number): string {
  const t = text.length >= w ? text.slice(0, w) : text;
  const left = Math.max(0, Math.floor((w - t.length) / 2));
  return ' '.repeat(left) + t + ' '.repeat(Math.max(0, w - t.length - left));
}

function row(left: string, right: string, w: number): string {
  const r = right.slice(0, w - 1);
  const maxL = w - r.length - 1;
  const l = left.slice(0, Math.max(1, maxL));
  const fill = Math.max(1, w - l.length - r.length);
  return l + ' '.repeat(fill) + r;
}

function sep(w: number): string {
  return '-'.repeat(w);
}

function rightAlign(text: string, w: number): string {
  return text.length >= w ? text.slice(0, w) : ' '.repeat(w - text.length) + text;
}

/** The `Dish | Qty | Amnt` column header row. */
function colHeader(w: number): string {
  const nameW = w - AMNT_W - QTY_W;
  return 'Dish'.padEnd(nameW) + centerStr('Qty', QTY_W) + rightAlign('Amnt', AMNT_W);
}

/** One item row: truncated name, centred `qty marker`, right-aligned amount.
 *  `marker` may be '' when the layout hides veg/non-veg markers. */
function itemRow(name: string, qty: string, marker: string, amnt: string, w: number): string {
  const nameW = w - AMNT_W - QTY_W;
  return name.slice(0, nameW).padEnd(nameW) + centerStr(marker ? `${qty} ${marker}` : qty, QTY_W) + rightAlign(amnt, AMNT_W);
}

export function buildReceiptText(
  state: State,
  order: Order,
  opts: { width?: ReceiptWidth; showTaxSummary?: boolean } = {}
): string {
  const w =
    opts.width ??
    receiptWidthFor(thermalWidthMm(state.billing.thermalWidth, state.billing.thermalCustomWidth));
  const showTax = opts.showTaxSummary ?? true;
  const p = state.profile;
  // Older orders without the field are treated as GST-enabled.
  const isGst = order.gstEnabled !== false;
  const bill = buildBill({
    lines: order.lines,
    discount: order.discount,
    billing: state.billing,
    gstEnabled: isGst,
    deliveryCharge: order.deliveryCharge,
  });
  const paid = order.payments.reduce((s, x) => s + x.amount, 0);
  const change = Math.max(0, paid - bill.payable);
  const cashier = order.closedBy || order.staffName;
  const covers = order.lines.reduce((s, l) => s + l.qty, 0);
  const scPct = state.billing.serviceChargePct;
  const layout = state.billing.billLayout ?? DEFAULT_BILL_LAYOUT;

  const out: string[] = [];

  // Header — same two-line restaurant name as the printed bill: the title
  // (e.g. MEADOWS PARK) on its own line, the trailing word (e.g. RESTAURANT)
  // centred below it, then the centred detail block (address, GSTIN, custom
  // header lines, TAX INVOICE). Hidden entirely if the user turned it off in
  // Bill design. The name lines are never truncated — the thermal raster
  // re-fits them to the paper by font size.
  if (layout.showRestaurantName) {
    const { main: nameMain, suffix: nameSuffix } = splitBillName(p.name);
    if (nameMain) out.push(centerNoTrunc(nameMain.toUpperCase(), w));
    if (nameSuffix) out.push(centerNoTrunc(nameSuffix.toUpperCase(), w));
    if (p.address) out.push(center(p.address, w));
    if (p.phone) out.push(center(`Ph: ${p.phone}`, w));
    if (p.gstin) out.push(center(`GSTIN: ${p.gstin}`, w));
    if (p.fssai) out.push(center(`FSSAI Lic No: ${p.fssai}`, w));
  }
  // User-written header lines, e.g. 'Open 7:00 AM - 11:00 PM' or '{name}'.
  for (const line of layout.headerLines) {
    const text = applyBillPlaceholders(line, state, order).trim();
    if (text) out.push(center(text, w));
  }
  if (layout.showTaxInvoiceLabel) out.push(center(isGst ? 'TAX INVOICE' : 'INVOICE', w));
  out.push(sep(w));

  // Top row — same line as the reference bill.
  out.push(row(`Cashier :${cashier}`, `Covers: ${covers}`, w));
  out.push(sep(w));

  // Column headers + items
  if (layout.showColumnHeaders) {
    out.push(colHeader(w));
    out.push(sep(w));
  }
  for (const l of order.lines) {
    const marker = layout.showMarkers ? (l.veg ? '*' : '#') : '';
    out.push(itemRow(l.name, fmtQty(l.qty), marker, fmtRec2(l.qty * l.unitPrice), w));
    if (l.note) out.push('  (' + l.note.slice(0, w - 4) + ')');
  }
  out.push(sep(w));

  // Totals — two-decimal amounts, right-aligned, like the reference.
  // Subtotal is the pre-tax taxable value so the bill visibly adds up
  // (Subtotal + Service Charge + CGST + SGST + Round Off = TOTAL).
  out.push(row('Subtotal', fmtRec2(bill.foodTaxable), w));
  if (bill.discount > 0) out.push(row('Discount', '-' + fmtRec2(bill.discount), w));
  if (bill.deliveryCharge > 0) {
    out.push(row('Delivery Charge', `+ ${fmtRec2(bill.deliveryCharge)}`, w));
  }
  if (bill.serviceCharge > 0) {
    // Built with row() so the line fits the wrap width even at large font
    // sizes — a raw string would overflow the paper and force the whole
    // receipt to shrink (the font-size setting silently stops working).
    out.push(row(`Service Charge @${scPct.toFixed(2)} :`, `+ ${fmtRec2(bill.serviceCharge)}`, w));
  }
  if (bill.taxTotal > 0) {
    out.push(row('CGST', fmtRec2(bill.cgstTotal), w));
    out.push(row('SGST', fmtRec2(bill.sgstTotal), w));
  }
  if (bill.roundOff !== 0) out.push(row('Round Off', fmtRec2(bill.roundOff), w));
  out.push(row('TOTAL', fmtRec2(bill.payable), w));

  // Detail block — invoice/date/customer details sit below the totals,
  // keeping the top of the bill clean like the reference layout.
  if (layout.showInvoiceDetails) {
    out.push(sep(w));
    out.push(row('Invoice No', order.invoiceNo || '-', w));
    out.push(row('Date', order.paidAt ? fmtDateTime(order.paidAt) : fmtDateTime(order.createdAt), w));
    out.push(row('Type', order.type === 'dine-in' ? `Dine-in · ${tableLabel(state, order)}` : order.type === 'takeaway' ? 'Takeaway' : 'Delivery', w));
    if (order.customerName) out.push(row('Customer', order.customerName, w));
    if (order.customerPhone) out.push(row('Phone', order.customerPhone, w));
    if (order.customerAddress) {
      const addrW = Math.max(8, w - 9); // leave room for the 'Address ' prefix
      for (const part of order.customerAddress.split('\n')) {
        const words = part.split(/\s+/).filter(Boolean);
        let line = '';
        for (const word of words) {
          if (line && line.length + 1 + word.length > addrW) {
            out.push(row('Address', line, w));
            line = '';
          }
          line = line ? line + ' ' + word : word;
          if (line.length > addrW) {
            // single over-long word: hard-slice it
            while (line.length > addrW) {
              out.push(row('Address', line.slice(0, addrW), w));
              line = line.slice(addrW);
            }
          }
        }
        if (line) out.push(row('Address', line, w));
      }
    }
  }

  // Tax summary (kept to two lines so it fits the narrowest receipt)
  if (showTax && layout.showTaxSummary && bill.slabs.length > 0) {
    out.push(sep(w));
    for (const s of bill.slabs) {
      out.push(center(`GST ${s.rate}% on ${fmtRec2(s.taxable)}`, w));
      out.push(row('', `CGST ${fmtRec2(s.cgst)} + SGST ${fmtRec2(s.sgst)}`, w));
    }
  }

  // Payments
  if (layout.showPayments) {
    out.push(sep(w));
    for (const pay of order.payments) {
      out.push(row(pay.method.toUpperCase(), fmtRec2(pay.amount), w));
    }
    if (change > 0) out.push(row('Change', fmtRec2(change), w));
  }

  // Footer — user-written lines, else the profile footer note, then thanks.
  if (layout.showFooter) {
    out.push(sep(w));
    const custom = layout.footerLines.map((l) => applyBillPlaceholders(l, state, order).trim()).filter(Boolean);
    if (custom.length > 0) {
      for (const line of custom) out.push(center(line, w));
    } else if (p.footerNote) {
      out.push(center(p.footerNote, w));
    }
    out.push(center('Thank you for dining with us!', w));
  }

  return out.join('\n');
}

/** WhatsApp deep-link URL with the receipt as the message. */
export function whatsappShareUrl(receiptText: string): string {
  return 'https://wa.me/?text=' + encodeURIComponent(receiptText);
}

/** Word-wrap a plain-text line so no single line exceeds `w` characters.
 *  Long words are hard-sliced; newlines are honoured. */
export function wrapLine(text: string, w: number): string[] {
  const out: string[] = [];
  for (const part of text.split('\n')) {
    let line = '';
    for (const word of part.split(/\s+/).filter(Boolean)) {
      if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= w) {
        line += ' ' + word;
      } else {
        out.push(line);
        line = word;
      }
      if (line.length > w) {
        // single over-long word: hard-slice it
        while (line.length > w) {
          out.push(line.slice(0, w));
          line = line.slice(w);
        }
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Build the plain-text kitchen ticket (KOT) used by the thermal/USB raster
 *  printers. `width` is the character width to wrap lines at (see
 *  rasterWidthFor), so a long item name wraps onto extra lines instead of
 *  shrinking the font of the whole ticket. */
export function buildKotText(kot: KOT, restaurantName: string, width: number): string {
  const w = Math.max(20, Math.round(width));
  const lines: string[] = [
    restaurantName,
    `KOT #${String(kot.kotNo).padStart(3, '0')} · ${kot.tableLabel}`,
    `Time: ${fmtTime(kot.createdAt)}`,
  ];
  if (kot.orderNote) lines.push(...wrapLine(`NOTE: ${kot.orderNote}`, w));
  lines.push('-'.repeat(w));
  for (const it of kot.items) {
    lines.push(...wrapLine(`${fmtQty(it.qty)}× ${it.name}${it.note ? ` (${it.note})` : ''}`, w));
  }
  lines.push('-'.repeat(w));
  return lines.join('\n');
}

export { rightAlign };
