// Pure merge logic for LAN sync between devices. No React, no I/O — unit-tested
// in scripts/sync-test.mjs.
//
// Model: every device keeps its own full copy of the data. When connected to a
// hub, devices converge by merging by id with last-write-wins on `updatedAt`.
// Orders/KOTs flow both ways; menu/settings/profile are hub-authoritative
// (only the admin edits them) and are replaced wholesale on clients.

import type { Category, KOT, MenuItem, Order } from './types';
import { invoiceLabel, todayKey } from './format';

/** Merge incoming orders into local by id, keeping the newer copy (LWW). */
export function mergeOrders(local: Order[], incoming: Order[]): Order[] {
  const byId = new Map<string, Order>();
  for (const o of local) byId.set(o.id, o);
  for (const o of incoming) {
    const existing = byId.get(o.id);
    if (!existing || (existing.updatedAt ?? existing.createdAt) < (o.updatedAt ?? o.createdAt)) {
      byId.set(o.id, o);
    }
  }
  return [...byId.values()];
}

/** Merge incoming KOTs into local by id, keeping the newer copy (LWW). */
export function mergeKots(local: KOT[], incoming: KOT[]): KOT[] {
  const byId = new Map<string, KOT>();
  for (const k of local) byId.set(k.id, k);
  for (const k of incoming) {
    const existing = byId.get(k.id);
    if (!existing || (existing.updatedAt ?? existing.createdAt) < (k.updatedAt ?? k.createdAt)) {
      byId.set(k.id, k);
    }
  }
  return [...byId.values()];
}

/** Parse the numeric part of an invoice label, e.g. 'INV-0007' -> 7. */
function parseInvoiceNo(label: string, prefix: string): number | null {
  if (!label.startsWith(prefix)) return null;
  const n = Number(label.slice(prefix.length));
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Invoice numbers are assigned locally on each device, so two devices can hand
 * out the same number on the same day. The hub is the authority: when a paid
 * order's invoice number collides with an earlier one (same day), the later
 * order is renumbered from the hub's counter. Returns the corrected orders and
 * the new counter value (the origin device must bump its counter past it).
 *
 * The counter also advances past any invoice number seen here, so the hub can
 * never hand out a number that is already in use on a connected device.
 */
export function renumberCollisions(
  orders: Order[],
  counter: number,
  prefix: string
): { orders: Order[]; counter: number } {
  const seen = new Map<string, string>(); // `${day}|${invoiceNo}` -> orderId (first claimant)
  let c = counter;
  const result = orders.map((o) => {
    if (o.status !== 'paid' || !o.invoiceNo) return o;
    const num = parseInvoiceNo(o.invoiceNo, prefix);
    if (num !== null) c = Math.max(c, num);
    const day = todayKey(new Date(o.paidAt ?? o.createdAt));
    const key = `${day}|${o.invoiceNo}`;
    const first = seen.get(key);
    if (first && first !== o.id) {
      c += 1;
      const corrected: Order = { ...o, invoiceNo: invoiceLabel(prefix, c), updatedAt: Date.now() };
      seen.set(`${day}|${corrected.invoiceNo}`, o.id);
      return corrected;
    }
    seen.set(key, o.id);
    return o;
  });
  return { orders: result, counter: c };
}

/**
 * Which local orders should a client push to the hub on (re)connect? Those the
 * hub doesn't have, or that are newer locally than the hub's copy.
 */
export function diffOrdersToPush(local: Order[], hubOrders: Order[]): Order[] {
  const hubById = new Map(hubOrders.map((o) => [o.id, o]));
  return local.filter((o) => {
    const h = hubById.get(o.id);
    return !h || (h.updatedAt ?? h.createdAt) < (o.updatedAt ?? o.createdAt);
  });
}

/** Same as diffOrdersToPush, for KOTs. */
export function diffKotsToPush(local: KOT[], hubKots: KOT[]): KOT[] {
  const hubById = new Map(hubKots.map((k) => [k.id, k]));
  return local.filter((k) => {
    const h = hubById.get(k.id);
    return !h || (h.updatedAt ?? h.createdAt) < (k.updatedAt ?? k.createdAt);
  });
}

/** Menu snapshot for the wire (categories + items). */
export function menuSnapshot(categories: Category[], items: MenuItem[]) {
  return { categories, items };
}