// Tests for the end-of-day rollover math (business-day keys + counter resets).
import { rolloverMinutes, businessDayKey, withCounters } from '../src/rollover.ts';

let failures = 0;
function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) {
    failures++;
    console.log(`✗ ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

const t = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);

// ── rolloverMinutes ──────────────────────────────────────────────────────────
check('00:00 → 0', rolloverMinutes('00:00'), 0);
check('00:30 → 30', rolloverMinutes('00:30'), 30);
check('23:59 → 1439', rolloverMinutes('23:59'), 1439);
check('12:05 → 725', rolloverMinutes('12:05'), 725);
check('garbage → 0', rolloverMinutes('abc'), 0);
check('undefined → 0', rolloverMinutes(undefined), 0);

// ── businessDayKey ───────────────────────────────────────────────────────────
check('midnight rollover: 00:15 belongs to today', businessDayKey('00:00', t(2026, 8, 12, 0, 15)), '2026-08-12');
check('midnight rollover: 23:59 belongs to today', businessDayKey('00:00', t(2026, 8, 12, 23, 59)), '2026-08-12');
check('00:30 rollover: 00:15 is still yesterday', businessDayKey('00:30', t(2026, 8, 12, 0, 15)), '2026-08-11');
check('00:30 rollover: 00:30 starts the new day', businessDayKey('00:30', t(2026, 8, 12, 0, 30)), '2026-08-12');
check('00:30 rollover: noon is today', businessDayKey('00:30', t(2026, 8, 12, 12, 0)), '2026-08-12');
check('23:00 rollover: 22:59 is yesterday', businessDayKey('23:00', t(2026, 8, 12, 22, 59)), '2026-08-11');
check('23:00 rollover: 23:00 starts the new day', businessDayKey('23:00', t(2026, 8, 12, 23, 0)), '2026-08-12');

// ── withCounters ─────────────────────────────────────────────────────────────
const base = {
  billing: { rolloverTime: '00:00' },
  invoiceCounter: 7,
  invoiceCounterDate: '2026-08-11',
  kotCounter: 3,
  kotCounterDate: '2026-08-11',
};

const reset = withCounters({ ...base, invoiceCounterDate: '2026-08-11' }, t(2026, 8, 12, 9, 0));
check('stale invoice counter resets to 0', reset.invoiceCounter, 0);
check('stale invoice counter date moves to cur', reset.invoiceCounterDate, '2026-08-12');
check('stale kot counter resets to 0', reset.kotCounter, 0);

const fresh = withCounters({ ...base, invoiceCounterDate: '2026-08-12' }, t(2026, 8, 12, 9, 0));
check('current counters are kept', fresh.invoiceCounter, 7);

const future = withCounters({ ...base, invoiceCounterDate: '2026-08-13' }, t(2026, 8, 12, 9, 0));
check('future (manual early rollover) counter kept', future.invoiceCounter, 7);
check('future date kept', future.invoiceCounterDate, '2026-08-13');

const partial = withCounters(
  { ...base, invoiceCounterDate: '2026-08-12', kotCounterDate: '2026-08-10' },
  t(2026, 8, 12, 9, 0)
);
check('invoice side untouched when fresh', partial.invoiceCounter, 7);
check('kot side resets when stale', partial.kotCounter, 0);
check('kot side date moves', partial.kotCounterDate, '2026-08-12');

// ── auto-rollover trigger decision (lastRolloverDate < current business day) ─
check('rollover due when last rollover was yesterday', '2026-08-11' < businessDayKey('00:00', t(2026, 8, 12, 0, 1)), true);
check('no rollover again same day', '2026-08-12' < businessDayKey('00:00', t(2026, 8, 12, 9, 0)), false);
check('no rollover after manual early rollover', '2026-08-13' < businessDayKey('00:00', t(2026, 8, 12, 9, 0)), false);
check('00:30 day still pending before 00:30', '2026-08-11' < businessDayKey('00:30', t(2026, 8, 12, 0, 15)), false);
check('00:30 day due at 00:30', '2026-08-11' < businessDayKey('00:30', t(2026, 8, 12, 0, 30)), true);

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nAll rollover tests passed ✅');
