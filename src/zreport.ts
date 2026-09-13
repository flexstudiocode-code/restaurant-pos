// End-of-day Z-report: aggregates a settled business day into a compact
// plain-text summary (sales by payment method, discounts, voids, cash to
// hand over) for the thermal/USB printers and the system Print dialog.
// Pure functions only — unit-tested in scripts/zreport-test.mjs.

import type { State } from './types';
import { buildBill } from './bill';
import { fmtRec2 } from './money';
import { fmtDate, fmtTime } from './format';
import { businessDayKey, rolloverMinutes } from './rollover';

export interface ZReport {
  /** Business-day key the report covers (e.g. '2026-09-12'). */
  day: string;
  bills: number;
  gross: number; // Σ bill payables (incl. delivery charge, excl. nothing)
  food: number; // Σ netFood (pre-tax food value after discount)
  discounts: number;
  deliveryCharges: number;
  serviceCharges: number;
  roundOff: number;
  /** Cash actually collected (cash payment allocations on paid bills). */
  cash: number;
  upi: number;
  card: number;
  /** bills − cash − upi − card: what was paid by methods not listed (0 today). */
  other: number;
  voidCount: number;
  voidTotal: number;
  /** ≈ money in the drawer: opening float + cash collected − cash expenses. */
  cashInDrawer: number;
  expenses: number;
  paidBills: { invoiceNo: string; time: number; total: number; methods: string }[];
  voidedBills: { invoiceNo: string; time: number; total: number; reason: string }[];
}

function emptyZ(day: string): ZReport {
  return {
    day,
    bills: 0, gross: 0, food: 0, discounts: 0, deliveryCharges: 0,
    serviceCharges: 0, roundOff: 0,
    cash: 0, upi: 0, card: 0, other: 0,
    voidCount: 0, voidTotal: 0,
    cashInDrawer: 0, expenses: 0,
    paidBills: [], voidedBills: [],
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** [start, end) epoch-ms window of the business day `day` for a rollover time.
 *  Business day D runs from D 00:00 + rollover to D+1 00:00 + rollover. */
function businessDayWindow(rolloverTime: string, day: string): [number, number] {
  const [y, m, d] = day.split('-').map(Number);
  const base = new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
  const offset = rolloverMinutes(rolloverTime) * 60_000;
  return [base + offset, base + DAY_MS + offset];
}

/**
 * Build the Z-report for the business day containing `ref`, respecting the
 * configured rollover time (same day boundaries as the app's end-of-day: a
 * 00:30 rollover means 00:15 still belongs to yesterday's report).
 * `openingFloatPaise` is the cash in the drawer at the start of the day.
 */
export function buildZReport(state: State, ref: Date, openingFloatPaise = 0): ZReport {
  const day = businessDayKey(state.billing.rolloverTime, ref);
  const [start, end] = businessDayWindow(state.billing.rolloverTime, day);
  const z = emptyZ(day);

  const paidOrders = state.orders.filter(
    (o) => o.status === 'paid' && o.paidAt !== null && o.paidAt >= start && o.paidAt < end
  );

  for (const o of paidOrders) {
    const bill = buildBill({
      lines: o.lines,
      discount: o.discount,
      billing: state.billing,
      deliveryCharge: o.deliveryCharge,
    });
    z.bills += 1;
    z.gross += bill.payable;
    z.food += bill.netFood;
    z.discounts += bill.discount;
    z.deliveryCharges += bill.deliveryCharge;
    z.serviceCharges += bill.serviceCharge;
    z.roundOff += bill.roundOff;

    // Attribute each payment against the payable (over-tender is change,
    // not sales — same allocation rule as ReportsScreen).
    let remaining = bill.payable;
    for (const p of o.payments) {
      const alloc = Math.min(p.amount, Math.max(0, remaining));
      if (p.method === 'cash') z.cash += alloc;
      else if (p.method === 'upi') z.upi += alloc;
      else if (p.method === 'card') z.card += alloc;
      else z.other += alloc;
      remaining -= alloc;
    }

    const methods =
      o.payments.length > 0
        ? o.payments.map((p) => p.method.toUpperCase()).join(' + ')
        : '—';
    z.paidBills.push({ invoiceNo: o.invoiceNo || '-', time: o.paidAt ?? o.createdAt, total: bill.payable, methods });
  }

  // Voids are attributed to the day they were raised/settled and measured on
  // the same basis as sales (bill payable), so a voided bill reconciles
  // against the gross figure it would otherwise have contributed.
  const voided = state.orders.filter((o) => {
    if (o.status !== 'void') return false;
    const at = o.paidAt ?? o.createdAt;
    return at >= start && at < end;
  });
  for (const o of voided) {
    const total = buildBill({
      lines: o.lines,
      discount: o.discount,
      billing: state.billing,
      deliveryCharge: o.deliveryCharge,
    }).payable;
    z.voidCount += 1;
    z.voidTotal += total;
    z.voidedBills.push({
      invoiceNo: o.invoiceNo || '—',
      time: o.paidAt ?? o.createdAt,
      total,
      reason: o.voidReason || '—',
    });
  }

  const dayExpenses = state.expenses.filter(
    (e) => e.createdAt >= start && e.createdAt < end
  );
  for (const e of dayExpenses) z.expenses += e.amount;

  z.paidBills.sort((a, b) => a.time - b.time);
  z.voidedBills.sort((a, b) => a.time - b.time);
  z.other = z.gross - z.cash - z.upi - z.card;
  z.cashInDrawer = openingFloatPaise + z.cash - z.expenses;
  return z;
}

function center(text: string, w: number): string {
  const t = text.length >= w ? text.slice(0, w) : text;
  const pad = Math.max(0, Math.floor((w - t.length) / 2));
  return ' '.repeat(pad) + t;
}

function row(left: string, right: string, w: number): string {
  const r = right.slice(0, w - 1);
  const maxL = w - r.length - 1;
  const l = left.slice(0, Math.max(1, maxL));
  const fill = Math.max(1, w - l.length - r.length);
  return l + ' '.repeat(fill) + r;
}

/** Plain-text Z-report for the thermal/USB raster and WhatsApp. */
export function buildZReportText(state: State, z: ZReport, w = 48): string {
  const p = state.profile;
  const out: string[] = [];
  out.push(center((p.name || 'RESTAURANT').toUpperCase(), w));
  out.push(center('Z-REPORT (END OF DAY)', w));
  const [dayStart] = businessDayWindow(state.billing.rolloverTime, z.day);
  out.push(center(`Day: ${fmtDate(dayStart)}  ·  printed ${fmtTime(Date.now())}`, w));
  out.push('-'.repeat(w));

  out.push(row('Bills', String(z.bills), w));
  out.push(row('Gross sales', fmtRec2(z.gross), w));
  out.push('');
  out.push(center('— SALES BY PAYMENT —', w));
  out.push(row('Cash', fmtRec2(z.cash), w));
  out.push(row('UPI', fmtRec2(z.upi), w));
  out.push(row('Card', fmtRec2(z.card), w));
  if (z.other !== 0) out.push(row('Other', fmtRec2(z.other), w));
  out.push('');
  out.push(center('— ADJUSTMENTS —', w));
  out.push(row('Discounts', '-' + fmtRec2(z.discounts), w));
  if (z.deliveryCharges > 0) out.push(row('Delivery charges', '+' + fmtRec2(z.deliveryCharges), w));
  if (z.serviceCharges > 0) out.push(row('Service charge', '+' + fmtRec2(z.serviceCharges), w));
  if (z.roundOff !== 0) out.push(row('Round off', fmtRec2(z.roundOff), w));
  out.push('');
  out.push(center('— CASH —', w));
  out.push(row('Cash collected', fmtRec2(z.cash), w));
  if (z.expenses > 0) out.push(row('Cash expenses', '-' + fmtRec2(z.expenses), w));
  out.push(row('CASH IN DRAWER', fmtRec2(z.cashInDrawer), w));
  out.push('');
  out.push(center('— VOIDS —', w));
  if (z.voidCount === 0) {
    out.push(center('None', w));
  } else {
    out.push(row(`Voids (${z.voidCount})`, fmtRec2(z.voidTotal), w));
    for (const v of z.voidedBills.slice(0, 10)) {
      out.push(row(`  ${v.invoiceNo} ${fmtTime(v.time)}`, fmtRec2(v.total), w));
      out.push(center(`    ${v.reason.slice(0, Math.max(8, w - 4))}`, w));
    }
    if (z.voidedBills.length > 10) {
      out.push(center(`  … ${z.voidedBills.length - 10} more`, w));
    }
  }
  out.push('');
  out.push(center('— BILLS —', w));
  for (const b of z.paidBills) {
    out.push(row(`  ${b.invoiceNo} ${fmtTime(b.time)} ${b.methods}`, fmtRec2(b.total), w));
  }
  out.push('-'.repeat(w));
  out.push(center('End of report', w));
  return out.join('\n');
}
