// ── GST billing engine ──────────────────────────────────────────────────────
// Handles intra-state (Kerala) supplies: CGST + SGST, each half of the slab.
// Prices may be stored exclusive or inclusive of GST (billing.pricingMode).
// All money is integer paise.

import type { BillingSettings, OrderLine, PricingMode } from './types';
import { roundToRupee, roundOffDiff, percent } from './money';

export interface LineTotals {
  gross: number; // what the customer pays for this line (incl. tax)
  taxable: number; // taxable value
  cgst: number;
  sgst: number;
  tax: number; // cgst + sgst
}

export interface SlabSummary {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
}

export interface BillSummary {
  lines: LineTotals[]; // parallel to order lines
  foodGross: number; // Σ line gross before discount
  foodTaxable: number;
  discount: number; // applied (may be less than requested if capped)
  netFood: number; // foodGross − discount
  deliveryCharge: number; // flat delivery fee (passes straight through; not discounted or taxed)
  serviceCharge: number;
  scTaxable: number; // = serviceCharge (service charge is part of taxable value)
  scCgst: number;
  scSgst: number;
  taxableTotal: number; // foodTaxable(after discount) + serviceCharge
  cgstTotal: number;
  sgstTotal: number;
  taxTotal: number;
  grandTotal: number; // netFood + deliveryCharge + serviceCharge + scTax
  roundOff: number; // difference to nearest rupee (0 if disabled)
  payable: number; // final amount to collect (= grandTotal + roundOff)
  slabs: SlabSummary[]; // per-rate tax summary for the invoice
}

/** Split an integer tax amount into CGST/SGST halves (extra paise goes to CGST). */
function splitTax(tax: number): [number, number] {
  const cgst = Math.ceil(tax / 2);
  return [cgst, tax - cgst];
}

/** Compute per-line totals for one line under the given pricing mode.
 *  When `gst` is false the bill is issued without tax (gross = taxable). */
function lineTotals(line: OrderLine, mode: PricingMode, gst: boolean): LineTotals {
  const gross = line.qty * line.unitPrice;
  const rate = line.gstRate;
  if (!gst || rate <= 0) {
    return { gross, taxable: gross, cgst: 0, sgst: 0, tax: 0 };
  }
  if (mode === 'inclusive') {
    // Menu price includes GST → derive taxable by backing out the tax.
    const taxable = Math.round((gross * 100) / (100 + rate));
    const tax = gross - taxable;
    const [cgst, sgst] = splitTax(tax);
    return { gross, taxable, cgst, sgst, tax };
  }
  // Exclusive: price is taxable value, GST added on top.
  const taxable = gross;
  const tax = Math.round((taxable * rate) / 100);
  const [cgst, sgst] = splitTax(tax);
  return { gross: taxable + tax, taxable, cgst, sgst, tax };
}

export interface BuildBillInput {
  lines: OrderLine[];
  discount: number; // requested discount in paise (>= 0)
  billing: BillingSettings;
  gstEnabled?: boolean; // default true — false issues the bill without GST
  deliveryCharge?: number; // flat delivery fee in paise (default 0)
}

export function buildBill({ lines, discount, billing, gstEnabled = true, deliveryCharge = 0 }: BuildBillInput): BillSummary {
  const mode = billing.pricingMode;
  const base = lines.map((l) => lineTotals(l, mode, gstEnabled));
  const foodGross = base.reduce((s, t) => s + t.gross, 0);

  // Apply discount proportionally across lines (reduces taxable value).
  const requested = Math.max(0, Math.round(discount));
  const applied = foodGross > 0 ? Math.min(requested, foodGross) : 0;
  const ratio = foodGross > 0 ? (foodGross - applied) / foodGross : 1;

  // After discounting, the customer-facing gross is known; back out the tax
  // the same way in both pricing modes (guarantees taxable + cgst + sgst = gross).
  const discounted = base.map((t, i) => {
    const rate = lines[i].gstRate;
    if (applied <= 0) return t;
    const g = Math.round(t.gross * ratio);
    if (!gstEnabled || rate === 0) return { gross: g, taxable: g, cgst: 0, sgst: 0, tax: 0 };
    const taxable = Math.round((g * 100) / (100 + rate));
    const tax = g - taxable;
    const [cgst, sgst] = splitTax(tax);
    return { gross: g, taxable, cgst, sgst, tax };
  });

  const netFood = discounted.reduce((s, t) => s + t.gross, 0);
  const foodTaxable = discounted.reduce((s, t) => s + t.taxable, 0);
  const cgstFood = discounted.reduce((s, t) => s + t.cgst, 0);
  const sgstFood = discounted.reduce((s, t) => s + t.sgst, 0);

  // Service charge (optional). CBIC: it is part of the taxable value, so GST
  // applies on it at the bill's weighted average rate.
  const scPct = Math.max(0, Math.min(50, billing.serviceChargePct));
  const serviceCharge = scPct > 0 ? percent(netFood, scPct) : 0;
  const avgRate =
    foodTaxable > 0 ? (100 * (cgstFood + sgstFood)) / foodTaxable : 0;
  const scTax = Math.round((serviceCharge * avgRate) / 100);
  const [scCgst, scSgst] = splitTax(scTax);

  // Delivery charge: a flat fee on delivery bills. It is not discounted and
  // carries no GST of its own (typical for restaurant delivery fees) — it is
  // added to the total after tax, like the round-off. `Number(…) || 0` keeps
  // legacy/undefined values (e.g. orders synced from older devices) safe.
  const delivery = Math.max(0, Math.round(Number(deliveryCharge) || 0));

  const taxableTotal = foodTaxable + serviceCharge;
  const cgstTotal = cgstFood + scCgst;
  const sgstTotal = sgstFood + scSgst;
  const taxTotal = cgstTotal + sgstTotal;

  const grandTotal = netFood + delivery + serviceCharge + scTax;

  // Per-slab summary (discounted line values already sum exactly). Empty
  // when the bill is issued without GST.
  const slabs: SlabSummary[] = [];
  if (gstEnabled) {
    const slabMap = new Map<number, SlabSummary>();
    const rateOf = (i: number) => lines[i].gstRate;
    discounted.forEach((t, i) => {
      const r = rateOf(i);
      const cur = slabMap.get(r) ?? { rate: r, taxable: 0, cgst: 0, sgst: 0 };
      cur.taxable += t.taxable;
      cur.cgst += t.cgst;
      cur.sgst += t.sgst;
      slabMap.set(r, cur);
    });
    slabs.push(...[...slabMap.values()].sort((a, b) => a.rate - b.rate));
    if (serviceCharge > 0) {
      // Represent service-charge tax as its own slab entry (rate = blended).
      slabs.push({
        rate: Math.round(avgRate * 100) / 100,
        taxable: serviceCharge,
        cgst: scCgst,
        sgst: scSgst,
      });
    }
  }

  const roundOff = billing.roundOff ? roundOffDiff(grandTotal) : 0;
  const payable = grandTotal + roundOff;

  return {
    lines: discounted,
    foodGross,
    foodTaxable,
    discount: applied,
    netFood,
    deliveryCharge: delivery,
    serviceCharge,
    scTaxable: serviceCharge,
    scCgst,
    scSgst,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    taxTotal,
    grandTotal,
    roundOff,
    payable,
    slabs,
  };
}

/** Convenience: gross (customer-facing) total of the lines, no discount/tax math. */
export function linesGross(lines: OrderLine[]): number {
  return lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
}

export { roundToRupee };
