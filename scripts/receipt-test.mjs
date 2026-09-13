// Tests for buildReceiptText (thermal / WhatsApp receipt formatting).
import { buildReceiptText, buildKotText, receiptHeaderStyle, wrapLine } from '../src/receipt.ts';

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

const state = {
  version: 1,
  profile: {
    name: 'Flex Restaurant', address: 'MG Road, Kochi', phone: '+91 98470 12345',
    gstin: '32ABCDE1234F1Z5', fssai: '11523999000123', invoicePrefix: 'INV-',
    upiId: '', upiName: '', footerNote: 'Thank you!', tableNames: ['1', '2'],
  },
  billing: {
    pricingMode: 'inclusive', serviceChargePct: 0, roundOff: true,
    defaultGstRate: 5, kotEnabled: true, kotCounter: 0, thermalWidth: '58',
  },
  auth: { adminPin: '0000', waiterPin: '2222', kitchenPin: '1111' },
  categories: [], items: [],
  orders: [], kots: [], expenses: [],
  invoiceCounter: 1, invoiceCounterDate: '2026-08-09',
  kotCounter: 1, kotCounterDate: '2026-08-09', lastSavedAt: 0,
};

const order = {
  id: 'o1', invoiceNo: 'INV-0001', kotNos: ['K001'], type: 'dine-in',
  tableIndex: 0, customerName: '', lines: [
    { id: 'l1', itemId: 'i1', name: 'Chicken Biryani', unitPrice: 22000, qty: 1, gstRate: 5, hsn: '9963', veg: false, note: '', kotPrinted: true },
    { id: 'l2', itemId: 'i2', name: 'Tea (Milk)', unitPrice: 2000, qty: 2, gstRate: 5, hsn: '9963', veg: true, note: 'less sugar', kotPrinted: true },
  ],
  discount: 0, serviceCharge: 0, status: 'paid',
  payments: [{ id: 'p1', method: 'cash', amount: 50000, receivedAt: 0 }],
  createdAt: 0, paidAt: 1754215200000, voidReason: '', staffName: 'Manager', closedBy: 'Manager',
};

const text = buildReceiptText(state, order, { width: 32 });

// All lines within the 32-char width
const tooWide = text.split('\n').filter((l) => l.length > 32);
check('no line wider than 32 chars', tooWide.length, 0);

// Delivery charge: shown when present, absent when 0/undefined, TOTAL adds it
{
  const dcOrder = {
    ...order,
    type: 'delivery',
    deliveryCharge: 3000,
  };
  const dcText = buildReceiptText(state, dcOrder, { width: 32 });
  includes('delivery line present', dcText, 'Delivery Charge');
  includes('delivery amount', dcText, '+ 30.00');
  // Base 260 (incl 5%) + 30 delivery = 290 total
  includes('delivery in TOTAL', dcText, '290.00');
  const totalLine = dcText.split('\n').find((l) => l.startsWith('TOTAL'));
  check('TOTAL line equals 290.00', totalLine?.trim().endsWith('290.00'), true);
  const noDc = buildReceiptText(state, order, { width: 32 });
  check('no delivery line when 0', noDc.includes('Delivery Charge'), false);
  // Legacy order without the field at all must not crash or print a line
  const legacy = { ...order };
  delete legacy.deliveryCharge;
  const legacyText = buildReceiptText(state, legacy, { width: 32 });
  check('legacy order without field ok', legacyText.includes('Delivery Charge'), false);
  const legacyTotal = legacyText.split('\n').find((l) => l.startsWith('TOTAL'));
  check('legacy total unchanged', legacyTotal?.trim().endsWith('260.00'), true);
}

// Header: restaurant name is split into two centred lines like the printed bill
includes('name title line', text, 'FLEX');
includes('name suffix line', text, 'RESTAURANT');
check('name is two lines', text.split('\n').filter((l) => l.trim() === 'FLEX').length, 1);
check('name suffix on own line', text.split('\n').filter((l) => l.trim() === 'RESTAURANT').length, 1);
includes('gstin', text, 'GSTIN: 32ABCDE1234F1Z5');
includes('invoice label', text, 'INV-0001');
includes('table label', text, 'Dine-in · Table 1');

// Reference-style layout: Cashier/Covers top row + Dish/Qty/Amnt columns
includes('cashier row', text, 'Cashier :Manager');
includes('covers row', text, 'Covers: 3');
includes('dish column header', text, 'Dish');
includes('qty column header', text, 'Qty');
includes('amnt column header', text, 'Amnt');

// Items + totals — name first, centred `qty marker`, two-decimal amount
includes('item name', text, 'Chicken Biryani');
includes('non-veg marker', text, '1 #');
includes('veg marker', text, '2 *');
includes('item note', text, '(less sugar)');
includes('item amount', text, '40.00');
includes('subtotal', text, 'Subtotal');
includes('cgst', text, 'CGST');
includes('sgst', text, 'SGST');
includes('total', text, 'TOTAL');
includes('tax summary', text, 'GST 5% on 247.62');
includes('payment', text, 'CASH');
includes('change', text, 'Change');
includes('footer', text, 'Thank you!');

// Bill design layout overrides (header/footer lines, section toggles)
const customLayout = {
  version: 1,
  headerLines: ['{name}', 'Open 7:00 AM - 11:00 PM'],
  footerLines: ['Visit again!'],
  showRestaurantName: false,
  showTaxInvoiceLabel: false,
  showColumnHeaders: false,
  showMarkers: false,
  showInvoiceDetails: false,
  showTaxSummary: false,
  showPayments: false,
  showFooter: true,
  printSize: 'medium',
};
const customState = { ...state, billing: { ...state.billing, billLayout: customLayout } };
const custom = buildReceiptText(customState, order, { width: 32 });
includes('custom header line', custom, 'Open 7:00 AM - 11:00 PM');
includes('custom header {name}', custom, 'Flex Restaurant');
check('custom hides restaurant block', custom.includes('FSSAI Lic No:'), false);
check('custom hides TAX INVOICE label', custom.includes('TAX INVOICE'), false);
check('custom hides column headers', custom.includes('Amnt'), false);
check('custom hides markers', custom.includes('#'), false);
check('custom hides invoice details', custom.includes('INV-0001'), false);
check('custom hides payments', custom.includes('CASH'), false);
check('custom hides tax summary', custom.includes('GST 5% on'), false);
includes('custom footer line', custom, 'Visit again!');
check('custom replaces footer note', custom.includes('Thank you!'), false);
includes('custom total present', custom, 'TOTAL');

// 80mm width produces wider lines
const wide = buildReceiptText(state, order, { width: 48 });
check('80mm lines fit 48', wide.split('\n').filter((l) => l.length > 48).length, 0);

// Delivery order with customer info appears on the receipt
const delState = { ...state, profile: { ...state.profile, tableNames: [] } };
const delOrder = {
  ...order, invoiceNo: 'INV-0007', type: 'delivery', tableIndex: null,
  customerName: 'Anand Kumar', customerPhone: '+91 98765 43210',
  customerAddress: 'Flat 4B, Lotus Residency, MG Road', kotNos: [],
};
const delText = buildReceiptText(delState, delOrder, { width: 32 });
includes('delivery type', delText, 'Delivery');
includes('delivery customer', delText, 'Anand Kumar');
includes('delivery phone', delText, '+91 98765 43210');
includes('delivery address', delText, 'Residency, MG Road');
check('delivery lines fit 32', delText.split('\n').filter((l) => l.length > 32).length, 0);

// Takeaway label on KOT-style receipt uses the customer name
const tko = buildReceiptText({ ...delState, profile: { ...delState.profile } }, { ...delOrder, type: 'takeaway', customerAddress: '' }, { width: 32 });
includes('takeaway label', tko, 'Takeaway');

// Default order is a tax invoice; a GST-off order is a plain invoice with no tax lines
includes('gst invoice label', text, 'TAX INVOICE');
const noGstOrder = { ...order, gstEnabled: false };
const noGstText = buildReceiptText(state, noGstOrder, { width: 32 });
includes('no-gst invoice label', noGstText, 'INVOICE');
check('no-gst omits CGST line', noGstText.includes('CGST'), false);
check('no-gst omits SGST line', noGstText.includes('SGST'), false);
check('no-gst omits tax summary', noGstText.includes('GST 5% on'), false);
includes('no-gst total present', noGstText, 'TOTAL');

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nAll receipt tests passed.');
check('80mm wider than 58mm', wide.split('\n')[0].length > text.split('\n')[0].length, true);

// Total math sanity: 220 + 2×20 = 260 payable; cash 500 → change 240.
includes('change calc', text, '240.00');

// ── Header style must match the lines buildReceiptText actually emits ──────
// The raster centres `scriptLines` script + `subLines` sans + `centerLines`
// body lines, so the count must line up exactly with the text layout.
function headerInvariant(s, o, w) {
  const t = buildReceiptText(s, o, { width: w });
  const lines = t.split('\n');
  const st = receiptHeaderStyle(s, o);
  const after = lines.slice(st.scriptLines + st.subLines + st.centerLines);
  // The line right after the centred header block is the first separator.
  check('header invariant: separator after header block', after[0] ?? '', '-'.repeat(w));
}
headerInvariant(state, order, 32);
headerInvariant(customState, order, 32);
headerInvariant(state, order, 48);
headerInvariant(delState, delOrder, 32);
const noNameState = { ...state, billing: { ...state.billing, billLayout: { ...customLayout, showRestaurantName: true } } };
headerInvariant(noNameState, order, 32);

// ── wrapLine / buildKotText ────────────────────────────────────────────────
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('wrapLine wraps long line', eq(wrapLine('one two three four five', 10), ['one two', 'three four', 'five']), true);
check('wrapLine hard-slices long word', eq(wrapLine('abcdefghijklmnop', 6), ['abcdef', 'ghijkl', 'mnop']), true);
check('wrapLine honours newlines', eq(wrapLine('a b\nc d', 10), ['a b', 'c d']), true);

const kot = {
  id: 'k1', orderId: 'o1', kotNo: 7, tableLabel: 'Table 2', orderType: 'dine-in',
  items: [
    { name: 'Chicken Biryani', qty: 1, note: 'less spicy' },
    { name: 'Kerala Style Beef Roast with Malabar Parotta', qty: 2, note: '' },
  ],
  orderNote: 'Extra tissue please', status: 'pending',
  createdAt: 1754215200000, readyAt: null, servedAt: null, updatedAt: 0,
};
const kotText = buildKotText(kot, 'Flex Restaurant', 32);
includes('kot header name', kotText, 'Flex Restaurant');
includes('kot number + table', kotText, 'KOT #007 · Table 2');
includes('kot time', kotText, 'Time:');
includes('kot order note', kotText, 'NOTE: Extra tissue please');
includes('kot item note inline', kotText, '(less spicy)');
includes('kot wrapped long item', kotText, 'Kerala Style Beef Roast');
check('kot lines fit width', kotText.split('\n').filter((l) => l.length > 32).length, 0);
check('kot separator is 32 dashes', kotText.split('\n').filter((l) => l === '-'.repeat(32)).length, 2);

// ── Service-charge row must fit the wrap width at large font sizes ────────
const scState = { ...state, billing: { ...state.billing, serviceChargePct: 10 } };
const scText = buildReceiptText(scState, order, { width: 32 });
includes('service charge row', scText, 'Service Charge');
const scNarrow = buildReceiptText(scState, order, { width: 21 }); // 58mm @ 150%
check('service charge fits 21 chars', scNarrow.split('\n').filter((l) => l.length > 21).length, 0);

// ── Long restaurant name is not truncated in the receipt text (the raster
//    re-fits it to the paper by font size; WhatsApp wraps) ────────────────
const longNameState = { ...state, profile: { ...state.profile, name: 'Meadows Park Family Restaurant' } };
const longNameText = buildReceiptText(longNameState, order, { width: 21 });
includes('long restaurant name kept whole', longNameText, 'MEADOWS PARK FAMILY');


console.log(failures === 0 ? '\nAll receipt tests passed ✅' : `\n${failures} test(s) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
