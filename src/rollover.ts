// End-of-day rollover math: business-day boundaries and daily counter resets.
// Pure functions, unit-tested in scripts/rollover-test.mjs.

import type { State } from './types';
import { todayKey } from './format';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minutes since midnight for an 'HH:MM' 24h time (defaults to 00:00). */
export function rolloverMinutes(t: string | undefined): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? '');
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return 0;
  return Math.min(23, Math.max(0, h)) * 60 + Math.min(59, Math.max(0, min));
}

/** The 'YYYY-MM-DD' key of the business day containing `now`. Before the
 *  rollover time each day, the previous business day still runs (e.g. with a
 *  00:30 rollover, 00:15 still belongs to yesterday). */
export function businessDayKey(rolloverTime: string, now: Date): string {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins >= rolloverMinutes(rolloverTime)) return todayKey(now);
  return todayKey(new Date(now.getTime() - DAY_MS));
}

/** Ensure counters are current for the business day (invoice/KOT numbers reset
 *  at each rollover). A counter date AHEAD of the current business day is fine
 *  (a manual early "start next day"); only stale dates get reset. */
export function withCounters(s: State, now = new Date()): State {
  const cur = businessDayKey(s.billing.rolloverTime, now);
  const invoiceStale = s.invoiceCounterDate < cur;
  const kotStale = s.kotCounterDate < cur;
  if (!invoiceStale && !kotStale) return s;
  return {
    ...s,
    invoiceCounter: invoiceStale ? 0 : s.invoiceCounter,
    invoiceCounterDate: invoiceStale ? cur : s.invoiceCounterDate,
    kotCounter: kotStale ? 0 : s.kotCounter,
    kotCounterDate: kotStale ? cur : s.kotCounterDate,
  };
}
