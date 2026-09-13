// Tests for the end-of-day Z-report (scripts/zreport-test.mjs).
// Covers aggregation (payment mix, cash in drawer, voids), the plain-text
// builder, and the rollover-time day boundary.
import { buildZReport, buildZReportText } from '../src/zreport.ts';

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
function includes(name, haystack, needle) {
  const ok = haystack.includes(needle);
  if (!ok) {
    failures++;
    console.log(`✗ ${name}: missing ${JSON.stringify(needle)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

const state = (over = {}) => ({
  version: 1,
  profile: {
    name: 'Flex Restaurant', address: 'MG Road, Kochi', phone: '+91 98470 12345',
    fssai: '11523999000123', invoicePrefix: 'INV-',
    upiId: '', upiName: '', footerNote: '', tableNames: ['1', '2'],
  },
  billing: {
    serviceChargePct: 0, roundOff: false,
    kotEnabled: true, kotCounter: 0, thermalWidth: '80',
    rolloverTime: '00:00',
  },
  auth: { users: [], settingsPin: '1234' },
  categories: [], items: [],
  orders: [], kots: [], expenses: [],
  invoiceCounter: 1, invoiceCounterDate: '2026-09-12',
  kotCounter: 0, kotCounterDate: '2026-09-12', lastSavedAt: 0,
  ...over,
});

const line = (price, qty) => ({
  id: 'l' + Math.random(), itemId: 'i', name: 'x', unitPrice: price, qty,
  veg: true, note: '', kotPrinted: true,
});

const noon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).getTime();

// ── 1. Basic aggregation: payment mix, tax, discounts ──────────────────────
{
  const s = state({
    orders: [
      {
        id: 'o1', invoiceNo: 'INV-0001', kotNos: [], type: 'dine-in',
        tableIndex: 0, customerName: '', customerPhone: '', customerAddress: '', orderNote: '',
        lines: [line(10000, 2)], // 200 excl 5% → 210 payable
        discount: 0, serviceCharge: 0, deliveryCharge: 0, status: 'paid',
        payments: [{ id: 'p1', method: 'cash', amount: 21000, receivedAt: noon(2026, 9, 12) }],
        createdAt: noon(2026, 9, 12), paidAt: noon(2026, 9, 12), voidReason: '',
        staffName: 'M', closedBy: 'M', updatedAt: noon(2026, 9, 12),
      },
      {
        id: 'o2', invoiceNo: 'INV-0002', kotNos: [], type: 'delivery',
        tableIndex: null, customerName: 'Anu', customerPhone: '', customerAddress: '', orderNote: '',
        lines: [line(22000, 1)],
        discount: 0, serviceCharge: 0, deliveryCharge: 3000, status: 'paid',
        payments: [{ id: 'p2', method: 'upi', amount: 26100, receivedAt: noon(2026, 9, 12) }],
        createdAt: noon(2026, 9, 12), paidAt: noon(2026, 9, 12), voidReason: '',
        staffName: 'M', closedBy: 'M', updatedAt: noon(2026, 9, 12),
      },
    ],
  });
  const z = buildZReport(s, new Date(2026, 8, 12, 20, 0));
  check('bills', z.bills, 2);
  check('gross (200 + 220 + 30 dc)', z.gross, 20000 + 22000 + 3000);
  check('cash', z.cash, 20000);
  check('upi', z.upi, 25000);
  check('card', z.card, 0);
  check('delivery total', z.deliveryCharges, 3000);
  check('cash in drawer', z.cashInDrawer, 20000);
  check('no voids', z.voidCount, 0);
  check('bills list has both', z.paidBills.length, 2);
}

// ── 2. Expenses reduce cash in drawer ─────────────────────────────────────
{
  const s = state({
    orders: [
      {
        id: 'o1', invoiceNo: 'INV-0001', kotNos: [], type: 'dine-in',
        tableIndex: 0, customerName: '', customerPhone: '', customerAddress: '', orderNote: '',
        lines: [line(10000, 1)], discount: 0, serviceCharge: 0, deliveryCharge: 0,
        status: 'paid',
        payments: [{ id: 'p1', method: 'cash', amount: 10500, receivedAt: noon(2026, 9, 12) }],
        createdAt: noon(2026, 9, 12), paidAt: noon(2026, 9, 12), voidReason: '',
        staffName: 'M', closedBy: 'M', updatedAt: noon(2026, 9, 12),
      },
    ],
    expenses: [
      { id: 'e1', amount: 2500, category: 'Miscellaneous', note: 'gas', createdAt: noon(2026, 9, 12) },
    ],
  });
  const z = buildZReport(s, new Date(2026, 8, 12, 20, 0));
  check('expenses tracked', z.expenses, 2500);
  check('drawer = cash − expenses', z.cashInDrawer, 10000 - 2500);
}

// ── 3. Opening float ──────────────────────────────────────────────────────
{
  const s = state();
  const z = buildZReport(s, new Date(2026, 8, 12, 20, 0), 50000);
  check('float only day', z.cashInDrawer, 50000);
}

// ── 4. Voids: counted and listed, excluded from sales ─────────────────────
{
  const s = state({
    orders: [
      {
        id: 'v1', invoiceNo: '', kotNos: [], type: 'dine-in',
        tableIndex: 3, customerName: '', customerPhone: '', customerAddress: '', orderNote: '',
        lines: [line(5000, 2)], discount: 0, serviceCharge: 0, deliveryCharge: 0,
        status: 'void', payments: [], createdAt: noon(2026, 9, 12), paidAt: null,
        voidReason: 'wrong order', staffName: 'W', closedBy: null, updatedAt: noon(2026, 9, 12),
      },
      {
        id: 'v2', invoiceNo: 'INV-0009', kotNos: [], type: 'takeaway',
        tableIndex: null, customerName: '', customerPhone: '', customerAddress: '', orderNote: '',
        lines: [line(8000, 1)], discount: 0, serviceCharge: 0, deliveryCharge: 0,
        status: 'void', payments: [{ id: 'p', method: 'cash', amount: 8400, receivedAt: noon(2026, 9, 12) }],
        createdAt: noon(2026, 9, 12), paidAt: noon(2026, 9, 12), voidReason: 'refund',
        staffName: 'M', closedBy: 'M', updatedAt: noon(2026, 9, 12),
      },
    ],
  });
  const z = buildZReport(s, new Date(2026, 8, 12, 20, 0));
  check('void count', z.voidCount, 2);
  // Measured on the same basis as sales: the bill payable.
  check('void total', z.voidTotal, 10000 + 8000);
  check('voids not in sales', z.bills, 0);
  check('void reasons kept', z.voidedBills[0].reason, 'wrong order');
}

// ── 5. Only bills of the requested day are included ───────────────────────
{
  const s = state({
    orders: [
      paidOrder('a', noon(2026, 9, 11), 5000),
      paidOrder('b', noon(2026, 9, 12), 7000),
      paidOrder('c', noon(2026, 9, 13), 9000),
    ],
  });
  const z = buildZReport(s, new Date(2026, 8, 12, 20, 0));
  check('one day only: bills', z.bills, 1);
  check('one day only: gross', z.gross, 7000);
}

// ── 6. Rollover time: 00:30 keeps 00:15 in YESTERDAY's report ─────────────
{
  const s = state({ billing: { ...state().billing, rolloverTime: '00:30' } });
  s.orders = [paidOrder('late', new Date(2026, 8, 13, 0, 15).getTime(), 10000)];
  const dayReport = buildZReport(s, new Date(2026, 8, 12, 20, 0)); // Sep 12 evening
  check('rollover: bill lands on previous day', dayReport.bills, 1);
  const nextDay = buildZReport(s, new Date(2026, 8, 13, 12, 0));
  check('rollover: next day is empty', nextDay.bills, 0);
}

// ── 7. Over-tender (change) is not counted as sales ───────────────────────
{
  const s = state({
    orders: [
      {
        id: 'o1', invoiceNo: 'INV-0001', kotNos: [], type: 'dine-in',
        tableIndex: 0, customerName: '', customerPhone: '', customerAddress: '', orderNote: '',
        lines: [line(20000, 1)], discount: 0, serviceCharge: 0, deliveryCharge: 0,
        status: 'paid',
        payments: [{ id: 'p1', method: 'cash', amount: 50000, receivedAt: noon(2026, 9, 12) }],
        createdAt: noon(2026, 9, 12), paidAt: noon(2026, 9, 12), voidReason: '',
        staffName: 'M', closedBy: 'M', updatedAt: noon(2026, 9, 12),
      },
    ],
  });
  const z = buildZReport(s, new Date(2026, 8, 12, 20, 0));
  check('gross = payable only', z.gross, 20000);
  check('cash = tender allocation, not over-tender', z.cash, 20000);
  check('drawer matches cash', z.cashInDrawer, 20000);
}

// ── 8. Plain-text output ──────────────────────────────────────────────────
{
  const s = state({
    orders: [paidOrder('b', noon(2026, 9, 12), 7000)],
    expenses: [{ id: 'e1', amount: 1000, category: 'Miscellaneous', note: '', createdAt: noon(2026, 9, 12) }],
  });
  const z = buildZReport(s, new Date(2026, 8, 12, 20, 0), 20000);
  const text = buildZReportText(s, z, 48);
  includes('title', text, 'Z-REPORT (END OF DAY)');
  includes('restaurant name', text, 'FLEX RESTAURANT');
  includes('payment section', text, 'SALES BY PAYMENT');
  includes('cash line', text, 'Cash');
  includes('drawer line', text, 'CASH IN DRAWER');
  includes('voids section', text, 'VOIDS');
  includes('bills section', text, 'BILLS');
  const tooWide = text.split('\n').filter((l) => l.length > 48);
  check('no line wider than 48 chars', tooWide.length, 0);
  const text32 = buildZReportText(s, z, 32);
  const tooWide32 = text32.split('\n').filter((l) => l.length > 32);
  check('no line wider than 32 chars', tooWide32.length, 0);
}

function paidOrder(id, at, foodPaise) {
  return {
    id, invoiceNo: 'INV-' + id, kotNos: [], type: 'dine-in',
    tableIndex: 0, customerName: '', customerPhone: '', customerAddress: '', orderNote: '',
    lines: [line(foodPaise, 1)], discount: 0, serviceCharge: 0, deliveryCharge: 0,
    status: 'paid',
    payments: [{ id: 'p-' + id, method: 'cash', amount: foodPaise, receivedAt: at }],
    createdAt: at, paidAt: at, voidReason: '',
    staffName: 'M', closedBy: 'M', updatedAt: at,
  };
}

console.log(failures === 0 ? '\nAll Z-report tests passed ✅' : `\n${failures} test(s) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
