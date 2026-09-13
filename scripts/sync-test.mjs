// Unit tests for the LAN sync merge logic. Run: node scripts/sync-test.mjs
import {
  mergeOrders,
  mergeKots,
  renumberCollisions,
  diffOrdersToPush,
  diffKotsToPush,
} from '../src/syncMerge.ts';

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`✗ ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

const order = (over = {}) => ({
  id: 'o1',
  invoiceNo: '',
  kotNos: [],
  type: 'dine-in',
  tableIndex: 0,
  customerName: '',
  customerPhone: '',
  customerAddress: '',
  orderNote: '',
  lines: [],
  discount: 0,
  serviceCharge: 0,
  status: 'open',
  payments: [],
  createdAt: 1000,
  paidAt: null,
  voidReason: '',
  staffName: 'Waiter',
  closedBy: null,
  updatedAt: 1000,
  ...over,
});

const kot = (over = {}) => ({
  id: 'k1',
  orderId: 'o1',
  kotNo: 1,
  tableLabel: 'Table 1',
  orderType: 'dine-in',
  items: [],
  orderNote: '',
  status: 'pending',
  createdAt: 1000,
  readyAt: null,
  servedAt: null,
  updatedAt: 1000,
  ...over,
});

// 1. mergeOrders: new ids appended, same id keeps the newer copy
{
  const local = [order({ id: 'a', updatedAt: 100 })];
  const incoming = [order({ id: 'a', updatedAt: 200, customerName: 'Newer' }), order({ id: 'b', updatedAt: 50 })];
  const merged = mergeOrders(local, incoming);
  check('merge keeps newer copy', merged.find((o) => o.id === 'a').customerName, 'Newer');
  check('merge appends new id', merged.map((o) => o.id).sort(), ['a', 'b']);
  check('merge keeps local when newer', mergeOrders(local, [order({ id: 'a', updatedAt: 50, customerName: 'Older' })])[0].customerName, '');
}

// 2. mergeKots: same LWW behaviour
{
  const merged = mergeKots([kot({ id: 'k', updatedAt: 100 })], [kot({ id: 'k', updatedAt: 300, status: 'ready' })]);
  check('kot LWW ready', merged[0].status, 'ready');
  check('kot LWW older ignored', mergeKots([kot({ id: 'k', updatedAt: 300, status: 'served' })], [kot({ id: 'k', updatedAt: 200, status: 'ready' })])[0].status, 'served');
}

// 3. renumberCollisions: same-day invoice collision renumbers the later one
{
  // Timestamps at the start of today: same calendar day as now, but far enough
  // in the past that Date.now() (set on the renumbered copy) is strictly greater.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sameDay = today.getTime();
  const paid = (id, invoiceNo, paidAt) =>
    order({ id, invoiceNo, status: 'paid', paidAt, updatedAt: paidAt });
  const res = renumberCollisions(
    [paid('x', 'INV-0001', sameDay), paid('y', 'INV-0001', sameDay + 1)],
    5,
    'INV-'
  );
  check('first keeps its number', res.orders.find((o) => o.id === 'x').invoiceNo, 'INV-0001');
  check('second renumbered', res.orders.find((o) => o.id === 'y').invoiceNo, 'INV-0006');
  check('counter advanced', res.counter, 6);
  check('renumbered order bumped updatedAt', res.orders.find((o) => o.id === 'y').updatedAt > sameDay, true);
}

// 4. renumberCollisions: different days do NOT collide (numbers reset daily)
{
  const d1 = new Date(2026, 0, 1, 12).getTime();
  const d2 = new Date(2026, 0, 2, 12).getTime();
  const res = renumberCollisions(
    [order({ id: 'x', invoiceNo: 'INV-0001', status: 'paid', paidAt: d1, updatedAt: d1 }),
     order({ id: 'y', invoiceNo: 'INV-0001', status: 'paid', paidAt: d2, updatedAt: d2 })],
    3,
    'INV-'
  );
  check('different days no renumber', res.orders.map((o) => o.invoiceNo), ['INV-0001', 'INV-0001']);
  check('counter untouched', res.counter, 3);
}

// 5. renumberCollisions: open orders and duplicates of the same order are untouched
{
  const t = new Date().getTime();
  const res = renumberCollisions(
    [order({ id: 'o', invoiceNo: '', status: 'open', updatedAt: t }), order({ id: 'o', invoiceNo: 'INV-0001', status: 'paid', paidAt: t, updatedAt: t + 1 })],
    2,
    'INV-'
  );
  check('same order twice keeps its number', res.orders.filter((o) => o.invoiceNo === 'INV-0001').length, 1);
}

// 5b. renumberCollisions: the counter advances past invoice numbers seen from
// other devices, so the hub never reissues a number already in use (the waiter
// billed INV-0006 while the hub's counter was only 5).
{
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const t = d.getTime();
  const paid = (id, invoiceNo, paidAt) => order({ id, invoiceNo, status: 'paid', paidAt, updatedAt: paidAt });
  const res = renumberCollisions([paid('waiter', 'INV-0006', t)], 5, 'INV-');
  check('hub counter skips past seen invoice', res.counter, 6);
  check('seen invoice untouched', res.orders[0].invoiceNo, 'INV-0006');
  const res2 = renumberCollisions([paid('a', 'INV-0010', t), paid('b', 'INV-0010', t + 1)], 5, 'INV-');
  check('collision renumbers past the seen number', res2.orders.find((o) => o.id === 'b').invoiceNo, 'INV-0011');
  check('collision counter ends above seen number', res2.counter, 11);
}

// 6. diffOrdersToPush: push what the hub lacks or has older
{
  const local = [order({ id: 'a', updatedAt: 100 }), order({ id: 'b', updatedAt: 100 })];
  const hubHas = [order({ id: 'a', updatedAt: 50 }), order({ id: 'c', updatedAt: 100 })];
  const toPush = diffOrdersToPush(local, hubHas);
  check('push local-only and newer-local', toPush.map((o) => o.id).sort(), ['a', 'b']);
  check('push empty when hub is newer', diffOrdersToPush(local, [order({ id: 'a', updatedAt: 200 })]).length, 1);
}

// 7. diffKotsToPush
{
  const toPush = diffKotsToPush([kot({ id: 'k1' })], [kot({ id: 'k2' })]);
  check('kot diff pushes local-only', toPush.map((k) => k.id), ['k1']);
}

if (failures > 0) {
  console.log(`\n${failures} sync test(s) failed ❌`);
  process.exit(1);
} else {
  console.log('\nAll sync tests passed ✅');
}
