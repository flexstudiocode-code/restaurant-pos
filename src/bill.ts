// ── Simple billing totals (no tax) ──────────────────────────────────────────
// Bills are plain totals:
// Subtotal (Σ qty × unitPrice) − Discount + Delivery + Service Charge,
// with optional round-off to the nearest rupee.
// All money is integer paise.

import type { BillingSettings, OrderLine } from './types';
import { roundOffDiff, percent } from './money';

export interface LineTotals {
  gross: number; // qty × unitPrice (customer-facing)
  net: number; // gross share after proportional discount
}

export interface BillSummary {
  lines: LineTotals[];
  foodGross: number; // Σ line gross before discount
  discount: number; // applied (capped to foodGross)
  netFood: number; // foodGross − discount
  deliveryCharge: number; // flat delivery fee (passthrough, not discounted)
  serviceCharge: number; // % of netFood
  grandTotal: number; // netFood + deliveryCharge + serviceCharge
  roundOff: number; // difference to nearest rupee (0 if disabled)
  payable: number; // final amount to collect (= grandTotal + roundOff)
}

export interface BuildBillInput {
  lines: OrderLine[];
  discount: number; // requested discount in paise (>= 0)
  billing: BillingSettings;
  deliveryCharge?: number; // flat delivery fee in paise (default 0)
}

export function buildBill({ lines, discount, billing, deliveryCharge = 0 }: BuildBillInput): BillSummary {
  const grosses = lines.map((l) => l.qty * l.unitPrice);
  const foodGross = grosses.reduce((s, g) => s + g, 0);

  const requested = Math.max(0, Math.round(discount));
  const applied = foodGross > 0 ? Math.min(requested, foodGross) : 0;
  const ratio = foodGross > 0 ? (foodGross - applied) / foodGross : 1;

  const lineObjs = grosses.map((g) => ({ gross: g, net: Math.round(g * ratio) }));
  const netFood = lineObjs.reduce((s, t) => s + t.net, 0);

  const scPct = Math.max(0, Math.min(50, billing.serviceChargePct));
  const serviceCharge = scPct > 0 ? percent(netFood, scPct) : 0;

  const delivery = Math.max(0, Math.round(Number(deliveryCharge) || 0));

  const grandTotal = netFood + delivery + serviceCharge;
  const roundOff = billing.roundOff ? roundOffDiff(grandTotal) : 0;
  const payable = grandTotal + roundOff;

  return {
    lines: lineObjs,
    foodGross,
    discount: applied,
    netFood,
    deliveryCharge: delivery,
    serviceCharge,
    grandTotal,
    roundOff,
    payable,
  };
}

/** Convenience: gross (customer-facing) total of the lines, no discount math. */
export function linesGross(lines: OrderLine[]): number {
  return lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
}

export { roundToRupee } from './money';
