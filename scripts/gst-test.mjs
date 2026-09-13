// Math tests for the GST engine. Run: node scripts/gst-test.mjs
import { buildBill } from '../src/gst.ts';

let failures = 0;
function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) {
    failures++;
    console.log(`✗ ${name}: got ${actual}, want ${expected}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

const billing = (over = {}) => ({
  pricingMode: 'inclusive',
  serviceChargePct: 0,
  roundOff: true,
  defaultGstRate: 5,
  kotEnabled: true,
  kotCounter: 0,
  ...over,
});

const line = (price, qty, rate, note = '') => ({
  id: 'l', itemId: 'i', name: 'x', unitPrice: price, qty, gstRate: rate,
  hsn: '9963', veg: true, note, kotPrinted: false,
});

// 1. Inclusive 5%: ₹220 → taxable 209.52, CGST 5.24, SGST 5.24
{
  const b = buildBill({ lines: [line(22000, 1, 5)], discount: 0, billing: billing() });
  check('inc 5% gross', b.foodGross, 22000);
  check('inc 5% taxable', b.lines[0].taxable, 20952);
  check('inc 5% cgst', b.lines[0].cgst, 524);
  check('inc 5% sgst', b.lines[0].sgst, 524);
  check('inc 5% payable', b.payable, 22000);
}

// 2. Exclusive 5%: ₹220 taxable → 231 total
{
  const b = buildBill({ lines: [line(22000, 1, 5)], discount: 0, billing: billing({ pricingMode: 'exclusive' }) });
  check('exc 5% taxable', b.lines[0].taxable, 22000);
  check('exc 5% tax', b.lines[0].tax, 1100);
  check('exc 5% gross', b.lines[0].gross, 23100);
  check('exc 5% payable', b.payable, 23100);
}

// 3. 0% slab
{
  const b = buildBill({ lines: [line(10000, 2, 0)], discount: 0, billing: billing() });
  check('0% gross', b.foodGross, 20000);
  check('0% tax', b.taxTotal, 0);
  check('0% payable', b.payable, 20000);
}

// 4. Multi-item with discount: ₹220 + ₹20, 10% off
{
  const b = buildBill({ lines: [line(22000, 1, 5), line(2000, 1, 5)], discount: 2400, billing: billing() });
  check('disc gross', b.foodGross, 24000);
  check('disc applied', b.discount, 2400);
  check('disc netFood', b.netFood, 21600);
  // internal consistency: taxable + cgst + sgst per line == gross per line
  let ok = true;
  for (const t of b.lines) if (t.taxable + t.cgst + t.sgst !== t.gross) ok = false;
  check('disc per-line consistency', ok, true);
  check('disc slabs taxable sum', b.slabs.reduce((s, x) => s + x.taxable, 0), b.taxableTotal);
  check('disc payable', b.payable, 21600);
}

// 5. Service charge 10% on ₹240
{
  const b = buildBill({ lines: [line(22000, 1, 5), line(2000, 1, 5)], discount: 0, billing: billing({ serviceChargePct: 10 }) });
  check('sc amount', b.serviceCharge, 2400);
  // GST on SC at blended 5%: 2400 * 5% = 120 → cgst 60 + sgst 60
  check('sc cgst', b.scCgst, 60);
  check('sc sgst', b.scSgst, 60);
  check('sc grand', b.grandTotal, 24000 + 2400 + 120);
  // ₹265.20 rounds to ₹265.00 (round-off −₹0.20)
  check('sc roundOff', b.roundOff, -20);
  check('sc payable', b.payable, 26500);
}

// 6. Rounding: 240.50 → payable 241
{
  const b = buildBill({ lines: [line(24050, 1, 5)], discount: 0, billing: billing() });
  check('round off diff', b.roundOff, 50);
  check('round payable', b.payable, 24100);
}

// 7. Multi-rate order: 5% + 18%
{
  const b = buildBill({ lines: [line(10000, 1, 5), line(50000, 1, 18)], discount: 0, billing: billing() });
  const l0 = b.lines[0], l1 = b.lines[1];
  check('mr 5% taxable', l0.taxable, Math.round(10000 * 100 / 105));
  check('mr 18% taxable', l1.taxable, Math.round(50000 * 100 / 118));
  check('mr slabs', b.slabs.length, 2);
  check('mr slab sum', b.slabs.reduce((s, x) => s + x.taxable, 0), b.foodTaxable);
  check('mr cgst+s gst == tax', b.cgstTotal + b.sgstTotal, b.taxTotal);
  // payable must be exactly the inclusive sum (no drift)
  check('mr payable', b.payable, 60000);
}

// 8. Empty cart
{
  const b = buildBill({ lines: [], discount: 0, billing: billing() });
  check('empty payable', b.payable, 0);
  check('empty slabs', b.slabs.length, 0);
}

// 9. Discount bigger than total → capped
{
  const b = buildBill({ lines: [line(5000, 1, 5)], discount: 999999, billing: billing() });
  check('cap discount', b.discount, 5000);
  check('cap payable', b.payable, 0);
}

// 10. Odd tax split (3 paise → CGST 2, SGST 1)
{
  const b = buildBill({ lines: [line(60, 1, 5)], discount: 0, billing: billing() }); // 60 paise incl
  const t = b.lines[0];
  check('odd split cgst+sgst', t.cgst + t.sgst, t.tax);
  check('odd split cgst>=sgst', t.cgst >= t.sgst, true);
}

// 11. Exclusive with discount keeps consistency
// Item ₹200 @12% → customer pays ₹224; ₹5 discount → pays ₹219 (gross incl. tax)
{
  const b = buildBill({ lines: [line(10000, 2, 12)], discount: 500, billing: billing({ pricingMode: 'exclusive' }) });
  let ok = true;
  for (const t of b.lines) if (t.taxable + t.cgst + t.sgst !== t.gross) ok = false;
  check('exc-disc per-line consistency', ok, true);
  check('exc-disc base gross', b.foodGross, 22400);
  check('exc-disc netFood', b.netFood, 21900);
  check('exc-disc taxable', b.taxableTotal, Math.round(21900 * 100 / 112));
  check('exc-disc tax total', b.taxTotal, 21900 - Math.round(21900 * 100 / 112));
  check('exc-disc payable', b.payable, 21900);
}

// 12. qty>1
{
  const b = buildBill({ lines: [line(1500, 3, 5)], discount: 0, billing: billing() });
  check('qty gross', b.foodGross, 4500);
  check('qty taxable', b.lines[0].taxable, Math.round(4500 * 100 / 105));
}

// 13. Rounding disabled
{
  const b = buildBill({ lines: [line(24050, 1, 5)], discount: 0, billing: billing({ roundOff: false }) });
  check('no-round payable', b.payable, 24050);
  check('no-round diff', b.roundOff, 0);
}

// 14. GST disabled on the bill — no tax anywhere, totals = gross amounts
{
  const b = buildBill({ lines: [line(22000, 1, 5), line(2000, 1, 5)], discount: 2400, billing: billing(), gstEnabled: false });
  check('off gross', b.foodGross, 24000);
  check('off tax total', b.taxTotal, 0);
  check('off cgst', b.cgstTotal, 0);
  check('off sgst', b.sgstTotal, 0);
  check('off slabs empty', b.slabs.length, 0);
  check('off netFood', b.netFood, 21600);
  check('off per-line consistency', b.lines.every((t) => t.taxable + t.cgst + t.sgst === t.gross), true);
  check('off payable', b.payable, 21600);
}

// 15. GST off in exclusive mode — customer pays the pre-GST price (no tax on top)
{
  const b = buildBill({ lines: [line(22000, 1, 5)], discount: 0, billing: billing({ pricingMode: 'exclusive', serviceChargePct: 10 }), gstEnabled: false });
  check('off-exc payable', b.payable, 24200); // 220 + 10% SC, no GST
  check('off-exc service charge', b.serviceCharge, 2200);
  check('off-exc sc tax', b.scCgst + b.scSgst, 0);
  check('off-exc slabs empty', b.slabs.length, 0);
}

// 16. Delivery charge: added after tax, not discounted, no GST of its own
{
  // ₹240 food @5% exclusive → customer-facing gross 252; ₹40 delivery → 292
  const b = buildBill({ lines: [line(24000, 1, 5)], discount: 0, billing: billing({ pricingMode: 'exclusive' }), deliveryCharge: 4000 });
  check('dc amount', b.deliveryCharge, 4000);
  check('dc netFood', b.netFood, 25200);
  check('dc tax', b.taxTotal, 1200); // GST on food only
  check('dc payable', b.payable, 25200 + 4000);
}

// 17. Delivery charge is not discounted and carries no tax
{
  // ₹220 incl 5% (gross 220), ₹20 discount, ₹50 delivery
  const b = buildBill({ lines: [line(22000, 1, 5)], discount: 2000, billing: billing(), deliveryCharge: 5000 });
  check('dc-disc netFood', b.netFood, 20000);
  check('dc-disc delivery', b.deliveryCharge, 5000);
  check('dc-disc payable', b.payable, 20000 + 5000);
  // GST is on the discounted food (190.48 taxable), NOT on delivery
  const expectTax = 20000 - Math.round((20000 * 100) / 105);
  check('dc-disc tax', b.taxTotal, expectTax);
}

// 18. Delivery charge + service charge stack (SC % applies to food only,
//     inclusive mode: food gross 200, SC 20, SC-GST 1, delivery 30)
{
  const b = buildBill({ lines: [line(20000, 1, 5)], discount: 0, billing: billing({ serviceChargePct: 10 }), deliveryCharge: 3000 });
  check('dc-sc service', b.serviceCharge, 2000);
  check('dc-sc delivery', b.deliveryCharge, 3000);
  check('dc-sc payable', b.payable, 25100);
}

// 19. Delivery charge defaults to 0 / tolerates undefined (synced legacy orders)
{
  const b = buildBill({ lines: [line(10000, 1, 5)], discount: 0, billing: billing(), deliveryCharge: undefined });
  check('dc undefined', b.deliveryCharge, 0);
  const b2 = buildBill({ lines: [line(10000, 1, 5)], discount: 0, billing: billing() });
  check('dc omitted', b2.deliveryCharge, 0);
  const b3 = buildBill({ lines: [line(10000, 1, 5)], discount: 0, billing: billing(), deliveryCharge: NaN });
  check('dc NaN → 0', b3.deliveryCharge, 0);
  const b4 = buildBill({ lines: [line(10000, 1, 5)], discount: 0, billing: billing(), deliveryCharge: -500 });
  check('dc negative → 0', b4.deliveryCharge, 0);
}

// 20. Round-off still works with a delivery charge (paise total rounds)
{
  // 220 excl 5% = 231.00, delivery 0.50 → 231.50 → rounds to 232.00
  const b = buildBill({ lines: [line(22000, 1, 5)], discount: 0, billing: billing({ pricingMode: 'exclusive' }), deliveryCharge: 50 });
  check('dc roundOff diff', b.roundOff, 50);
  check('dc roundOff payable', b.payable, 23200);
}

console.log(failures === 0 ? '\nAll GST tests passed ✅' : `\n${failures} test(s) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
