import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { isDesktop } from '../desktop';
import { isEditableTarget } from '../shortcuts';
import { buildBill } from '../bill';
import { fmt } from '../money';
import { fmtDay, todayKey } from '../format';
import { DEFAULT_BILL_LAYOUT, thermalWidthMm } from '../types';
import { billFontStyle } from '../billLayout';
import { EmptyState, Chips } from '../components/ui';
import { buildZReport, buildZReportText } from '../zreport';
import { connectThermal, printRaster, useThermal, dotsForMm } from '../thermal';
import { printViaUsb, useUsbPrinter } from '../usbThermal';
import { IconPrint } from '../components/icons';

type Range = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

type SettleDay = { bills: number; cash: number; upi: number; card: number; expenses: number };

function rangeKey(r: Range): string {
  return r === 'today' ? 'Today' : r === 'yesterday' ? 'Yesterday' : r === 'week' ? 'Last 7 days' : r === 'month' ? 'This month' : 'Custom';
}

export function ReportsScreen() {
  const { state, notify } = useStore();
  const [range, setRange] = useState<Range>('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [zOpen, setZOpen] = useState(false);
  const [zPrintedAt, setZPrintedAt] = useState(() => Date.now());

  const { start, end } = useMemo(() => {
    const now = new Date();
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start: Date;
    let end: Date;
    switch (range) {
      case 'today':
        start = s; end = new Date(now); break;
      case 'yesterday': {
        start = new Date(s); start.setDate(start.getDate() - 1);
        end = new Date(s); break;
      }
      case 'week': {
        start = new Date(s); start.setDate(start.getDate() - 6);
        end = new Date(now); break;
      }
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now); break;
      case 'custom': {
        const a = from ? new Date(from + 'T00:00:00') : new Date(s);
        const b = to ? new Date(to + 'T23:59:59') : new Date(now);
        start = isNaN(a.getTime()) ? s : a;
        end = isNaN(b.getTime()) ? now : b;
        break;
      }
    }
    return { start, end };
  }, [range, from, to]);

  const report = useMemo(() => {
    const paidOrders = state.orders.filter(
      (o) => o.status === 'paid' && o.paidAt !== null && o.paidAt >= start.getTime() && o.paidAt <= end.getTime()
    );
    let sales = 0;
    let discounts = 0;
    let deliveryCharges = 0;
    let serviceCharges = 0;
    let itemsSold = 0;
    const payMix: Record<string, number> = { cash: 0, upi: 0, card: 0 };
    const catSales = new Map<string, number>();
    const itemSales = new Map<string, { qty: number; rev: number }>();
    let expenses = 0;
    const expenseCats = new Map<string, number>();
    const settlement = new Map<string, SettleDay>();

    for (const e of state.expenses) {
      if (e.createdAt >= start.getTime() && e.createdAt <= end.getTime()) {
        expenses += e.amount;
        expenseCats.set(e.category, (expenseCats.get(e.category) ?? 0) + e.amount);
        const dk = todayKey(new Date(e.createdAt));
        const day = settlement.get(dk) ?? { bills: 0, cash: 0, upi: 0, card: 0, expenses: 0 };
        day.expenses += e.amount;
        settlement.set(dk, day);
      }
    }


    for (const o of paidOrders) {
      if (o.paidAt === null) continue
      const bill = buildBill({
        lines: o.lines,
        discount: o.discount,
        billing: state.billing,
        deliveryCharge: o.deliveryCharge,
      });
      sales += bill.payable;
      discounts += bill.discount;
      deliveryCharges += bill.deliveryCharge;
      serviceCharges += bill.serviceCharge;
      // Attribute each payment against the bill; cash over-tender (change) is not sales.
      let remaining = bill.payable;
      const byMethod: Record<string, number> = {};
      for (const p of o.payments) {
        const alloc = Math.min(p.amount, Math.max(0, remaining));
        payMix[p.method] = (payMix[p.method] ?? 0) + alloc;
        byMethod[p.method] = (byMethod[p.method] ?? 0) + alloc;
        remaining -= alloc;
      }
      const dk = todayKey(new Date(o.paidAt));
      const day = settlement.get(dk) ?? { bills: 0, cash: 0, upi: 0, card: 0, expenses: 0 };
      day.bills += 1;
      day.cash += byMethod.cash ?? 0;
      day.upi += byMethod.upi ?? 0;
      day.card += byMethod.card ?? 0;
      settlement.set(dk, day);
      for (const l of o.lines) {
        itemsSold += l.qty;
        const cat = state.categories.find((c) => c.id === state.items.find((i) => i.id === l.itemId)?.categoryId);
        catSales.set(cat?.name ?? 'Other', (catSales.get(cat?.name ?? 'Other') ?? 0) + l.qty * l.unitPrice);
        const cur = itemSales.get(l.name) ?? { qty: 0, rev: 0 };
        cur.qty += l.qty;
        cur.rev += l.qty * l.unitPrice;
        itemSales.set(l.name, cur);
      }
    }

    const topItems = [...itemSales.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 10);
    const topCats = [...catSales.entries()].sort((a, b) => b[1] - a[1]);
    const expenseList = [...expenseCats.entries()].sort((a, b) => b[1] - a[1]);
    return {
      count: paidOrders.length,
      sales,
      avg: paidOrders.length ? sales / paidOrders.length : 0,
      discounts, deliveryCharges, serviceCharges, itemsSold,
      payMix, topItems, topCats,
      settlement,
      expenses, expenseList, profit: sales - expenses,
    };
  }, [state, start, end]);

  const settleDays = [...report.settlement.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const settleTotals = settleDays.reduce(
    (t, [, d]) => {
      t.bills += d.bills; t.cash += d.cash; t.upi += d.upi; t.card += d.card; t.expenses += d.expenses;
      return t;
    },
    { bills: 0, cash: 0, upi: 0, card: 0, expenses: 0 }
  );

  const exportCsv = () => {
    const rows: string[][] = [
      ['Invoice', 'Date', 'Type', 'Table/Customer', 'Items', 'Subtotal', 'Discount', 'Delivery charge', 'Service charge', 'Total', 'Paid via'],
    ];
    for (const o of state.orders) {
      if (o.status !== 'paid' || o.paidAt === null) continue;
      if (o.paidAt < start.getTime() || o.paidAt > end.getTime()) continue;
      const bill = buildBill({
        lines: o.lines,
        discount: o.discount,
        billing: state.billing,
        deliveryCharge: o.deliveryCharge,
      });
      const table = o.type === 'dine-in' && o.tableIndex !== null ? `Table ${state.profile.tableNames[o.tableIndex]}` : o.type === 'takeaway' ? 'Takeaway' : o.customerName || 'Delivery';
      const methods = o.payments.map((p) => `${p.method} ₹${(p.amount / 100).toFixed(2)}`).join(' + ');
      rows.push([
        o.invoiceNo,
        new Date(o.paidAt).toLocaleString('en-IN'),
        o.type,
        table,
        String(o.lines.reduce((s, l) => s + l.qty, 0)),
        (bill.foodGross / 100).toFixed(2),
        (bill.discount / 100).toFixed(2),
        (bill.deliveryCharge / 100).toFixed(2),
        (bill.serviceCharge / 100).toFixed(2),
        (bill.payable / 100).toFixed(2),
        methods,
      ]);
    }
    // Append an expenses + profit block to the CSV.
    const expRows: string[][] = [['']];
    const rangeExpenses = state.expenses.filter(
      (e) => e.createdAt >= start.getTime() && e.createdAt <= end.getTime()
    );
    if (rangeExpenses.length > 0) {
      expRows.push(['EXPENSES']);
      expRows.push(['Date', 'Category', 'Note', 'Amount']);
      for (const e of rangeExpenses) {
        expRows.push([
          new Date(e.createdAt).toLocaleString('en-IN'),
          e.category,
          e.note,
          (e.amount / 100).toFixed(2),
        ]);
      }
      const expTotal = rangeExpenses.reduce((s, e) => s + e.amount, 0);
      expRows.push(['', '', 'Total expenses', (expTotal / 100).toFixed(2)]);
      expRows.push(['', '', 'Net profit', ((report.sales - expTotal) / 100).toFixed(2)]);
    }
    const csv =
      rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n') +
      '\n' +
      expRows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-report-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Report exported as CSV', 'ok');
  };

  return (
    <div>
      <div className="section" style={{ paddingBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>Sales report</div>
      </div>

      <Chips style={{ padding: '0 14px 8px' }}>
        {(['today', 'yesterday', 'week', 'month', 'custom'] as Range[]).map((r) => (
          <button key={r} className={`chip ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>
            {rangeKey(r)}
          </button>
        ))}
      </Chips>

      {range === 'custom' && (
        <div className="row" style={{ gap: 8, padding: '0 14px 10px' }}>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}

      <div className="small muted" style={{ padding: '0 14px 6px' }}>
        {fmtDay(start)} → {fmtDay(end)}
      </div>

      <div className="stat-grid" style={{ paddingTop: 4 }}>
        <div className="stat-card">
          <div className="v">{fmt(report.sales)}</div>
          <div className="k">Net sales</div>
        </div>
        <div className="stat-card">
          <div className="v">{fmt(report.expenses)}</div>
          <div className="k">Expenses</div>
        </div>
        <div className="stat-card" style={report.profit < 0 ? { background: 'var(--danger-soft)' } : undefined}>
          <div className="v" style={report.profit < 0 ? { color: 'var(--danger)' } : undefined}>
            {fmt(report.profit)}
          </div>
          <div className="k">Profit</div>
        </div>
        <div className="stat-card">
          <div className="v">{report.count}</div>
          <div className="k">Bills</div>
        </div>
        <div className="stat-card">
          <div className="v">{fmt(report.avg)}</div>
          <div className="k">Avg bill</div>
        </div>
        <div className="stat-card">
          <div className="v">{report.itemsSold}</div>
          <div className="k">Items sold</div>
        </div>
      </div>

      {report.count === 0 ? (
        <EmptyState icon="📊" text="No sales in this period." />
      ) : (
        <>
          <div className="panel">
            <div className="list-row"><div className="list-title">Payment methods</div></div>
            {(['cash', 'upi', 'card'] as const).map((m) => {
              const amt = report.payMix[m] ?? 0;
              const pct = report.sales > 0 ? Math.round((amt / report.sales) * 100) : 0;
              return (
                <div className="list-row" key={m}>
                  <div className="grow list-title" style={{ textTransform: 'capitalize' }}>{m}</div>
                  <div className="list-sub" style={{ width: 44 }}>{pct}%</div>
                  <div className="bold mono">{fmt(amt)}</div>
                </div>
              );
            })}
          </div>

          <div className="panel">
            <div className="list-row"><div className="list-title">Adjustments</div></div>
            {report.discounts > 0 && (
              <div className="list-row">
                <div className="grow">Discounts given</div><div className="bold mono">−{fmt(report.discounts)}</div>
              </div>
            )}
            {report.deliveryCharges > 0 && (
              <div className="list-row">
                <div className="grow">Delivery charges collected</div><div className="bold mono">{fmt(report.deliveryCharges)}</div>
              </div>
            )}
            {report.serviceCharges > 0 && (
              <div className="list-row">
                <div className="grow">Service charge</div><div className="bold mono">{fmt(report.serviceCharges)}</div>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="list-row"><div className="list-title">Sales by category</div></div>
            {report.topCats.map(([name, amt]) => (
              <div className="list-row" key={name}>
                <div className="grow">{name}</div>
                <div className="bold mono">{fmt(amt)}</div>
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="list-row"><div className="list-title">Settlement</div></div>
            <div className="list-row">
              <div className="grow list-sub">Date</div>
              <div className="list-sub" style={{ width: 30, textAlign: 'right' }}>Bills</div>
              <div className="list-sub" style={{ width: 66, textAlign: 'right' }}>Cash</div>
              <div className="list-sub" style={{ width: 66, textAlign: 'right' }}>UPI</div>
              <div className="list-sub" style={{ width: 66, textAlign: 'right' }}>Card</div>
              <div className="list-sub" style={{ width: 76, textAlign: 'right' }}>Expenses</div>
              <div className="list-sub" style={{ width: 66, textAlign: 'right' }}>Net</div>
            </div>
            {settleDays.map(([dk, d]) => (
              <div className="list-row" key={dk}>
                <div className="grow">{new Date(dk).toLocaleDateString('en-IN')}</div>
                <div className="bold mono" style={{ width: 30, textAlign: 'right' }}>{d.bills}</div>
                <div className="bold mono" style={{ width: 66, textAlign: 'right' }}>{fmt(d.cash)}</div>
                <div className="bold mono" style={{ width: 66, textAlign: 'right' }}>{fmt(d.upi)}</div>
                <div className="bold mono" style={{ width: 66, textAlign: 'right' }}>{fmt(d.card)}</div>
                <div className="bold mono" style={{ width: 76, textAlign: 'right' }}>{fmt(d.expenses)}</div>
                <div className="bold mono" style={{ width: 66, textAlign: 'right' }}>{fmt(d.cash + d.upi + d.card - d.expenses)}</div>
              </div>
            ))}
            <div className="list-row">
              <div className="grow bold">Total</div>
              <div className="bold mono" style={{ width: 30, textAlign: 'right' }}>{settleTotals.bills}</div>
              <div className="bold mono" style={{ width: 66, textAlign: 'right' }}>{fmt(settleTotals.cash)}</div>
              <div className="bold mono" style={{ width: 66, textAlign: 'right' }}>{fmt(settleTotals.upi)}</div>
              <div className="bold mono" style={{ width: 66, textAlign: 'right' }}>{fmt(settleTotals.card)}</div>
              <div className="bold mono" style={{ width: 76, textAlign: 'right' }}>{fmt(settleTotals.expenses)}</div>
              <div className="bold mono" style={{ width: 66, textAlign: 'right' }}>{fmt(settleTotals.cash + settleTotals.upi + settleTotals.card - settleTotals.expenses)}</div>
            </div>
          </div>

          {report.expenseList.length > 0 && (
            <div className="panel">
              <div className="list-row"><div className="list-title">Expenses by category</div></div>
              {report.expenseList.map(([name, amt]) => (
                <div className="list-row" key={name}>
                  <div className="grow">{name}</div>
                  <div className="bold mono">−{fmt(amt)}</div>
                </div>
              ))}
              <div className="list-row">
                <div className="grow bold">Total expenses</div>
                <div className="bold mono">−{fmt(report.expenses)}</div>
              </div>
              <div className="list-row" style={{ background: 'var(--ok-soft)' }}>
                <div className="grow bold">Profit (sales − expenses)</div>
                <div className="bold mono">{fmt(report.profit)}</div>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="list-row"><div className="list-title">Top items</div></div>
            {report.topItems.map(([name, d], i) => (
              <div className="list-row" key={name}>
                <div className="list-sub" style={{ width: 26 }}>#{i + 1}</div>
                <div className="grow">{name}</div>
                <div className="list-sub">×{d.qty}</div>
                <div className="bold mono">{fmt(d.rev)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ padding: '0 14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="btn btn-primary btn-block" onClick={() => { setZPrintedAt(Date.now()); setZOpen(true); }}>
          🧾 End-of-day Z-report
        </button>
        <button className="btn btn-ghost btn-block" onClick={exportCsv}>
          ⬇️ Export CSV
        </button>
      </div>

      {zOpen && (
        <ZReportModal
          // Noon of the chosen day is inside its business day for ANY rollover
          // time (00:00 would fall into the previous day with a 00:30 rollover).
          day={range === 'yesterday' ? new Date(start.getTime() + 12 * 60 * 60 * 1000) : new Date()}
          printedAt={zPrintedAt}
          onClose={() => setZOpen(false)}
        />
      )}
    </div>
  );
}

/** Modal Z-report with the same print paths as the receipt (system Print,
 *  Bluetooth thermal, desktop USB). Re-renders live data on open. */
function ZReportModal({ day, printedAt, onClose }: { day: Date; printedAt: number; onClose: () => void }) {
  const { state, notify } = useStore();
  const thermal = useThermal();
  const usb = useUsbPrinter();

  const z = useMemo(
    () => buildZReport(state, day),
    // Snapshot at open: printedAt pins the "printed HH:MM" line; state still
    // updates live so the cashier sees the freshest numbers before printing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, day.getTime()]
  );

  const billLayout = state.billing.billLayout ?? DEFAULT_BILL_LAYOUT;
  const mm = thermalWidthMm(state.billing.thermalWidth, state.billing.thermalCustomWidth);
  const dots = dotsForMm(mm);
  const width = mm >= 70 ? 48 : 32;
  const zText = useMemo(() => buildZReportText(state, z, width), [state, z, width]);
  const printedLabel = printedAt
    ? `${day.toLocaleDateString('en-IN')} · printed ${new Date(printedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
    : day.toLocaleDateString('en-IN');

  // System Print: tag the body so the @media print rules isolate the Z-report
  // (the receipt's own print CSS would otherwise hide everything). afterprint
  // removes the tag; the timeout covers WebViews that never fire the event.
  const handleSystemPrint = () => {
    document.body.classList.add('z-printing');
    const cleanup = () => {
      document.body.classList.remove('z-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.setTimeout(cleanup, 2000);
    window.print();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isEditableTarget(e)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleThermal = async () => {
    if (!thermal.connected) {
      const res = await connectThermal();
      if (!res.ok) {
        notify(res.error ?? 'Could not connect to printer', 'err');
        return;
      }
    }
    const err = await printRaster(zText, dots, { scriptLines: 0, centerLines: 3, fontWeight: 400 });
    if (err) notify(err, 'err');
    else notify('Z-report sent to thermal printer', 'ok');
  };

  const handleUsb = async () => {
    const res = await printViaUsb(zText, dots, { scriptLines: 0, centerLines: 3, fontWeight: 400 });
    if (res.ok) notify('Z-report sent to USB printer', 'ok');
    else notify(res.error ?? 'Could not print', 'err');
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="row" style={{ marginBottom: 10, gap: 8 }}>
          <div className="grow">
            <div className="bold" style={{ fontSize: 16 }}>End-of-day Z-report</div>
            <div className="small muted">{printedLabel}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary grow" onClick={handleSystemPrint}>
            <IconPrint width={16} height={16} /> Print
          </button>
          <button className="btn btn-ghost grow" disabled={thermal.busy} onClick={() => void handleThermal()}>
            🖨 {thermal.connected ? 'Thermal ✓' : 'Thermal'}
          </button>
          {isDesktop() && (
            <button className="btn btn-ghost grow" disabled={usb.busy} onClick={() => void handleUsb()}>
              🔌 {usb.selected ? 'USB ✓' : 'USB'}
            </button>
          )}
        </div>

        <div className="zreport-print receipt-shell" style={billFontStyle(billLayout)} data-print-size={billLayout.printSize}>
          <ZReportBody z={z} />
        </div>

        <style>{zReportPrintCss}</style>
      </div>
    </div>
  );
}

/** On-screen Z-report body (mirrors the plain-text layout). */
function ZReportBody({ z }: { z: ReturnType<typeof buildZReport> }) {
  // Cash in drawer can go negative (expenses exceed cash) — keep the minus
  // sign in front of the currency symbol, not after it.
  const money = (p: number) => (p < 0 ? '-₹' : '₹') + Math.abs(p / 100).toFixed(2);
  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="r-line"><span className="l">{k}</span><span className="r">{v}</span></div>
  );
  return (
    <div style={{ fontFamily: 'var(--mono)' }}>
      <div className="r-head">
        <div className="r-sub">Z-REPORT (END OF DAY)</div>
      </div>
      <div className="r-sep" />
      <Row k="Bills" v={String(z.bills)} />
      <Row k="Gross sales" v={money(z.gross)} />
      <div className="r-sep" />
      <div className="r-line small"><span className="l">SALES BY PAYMENT</span><span className="r" /></div>
      <Row k="Cash" v={money(z.cash)} />
      <Row k="UPI" v={money(z.upi)} />
      <Row k="Card" v={money(z.card)} />
      <div className="r-sep" />
      <div className="r-line small"><span className="l">ADJUSTMENTS</span><span className="r" /></div>
      {z.discounts > 0 && <Row k="Discounts" v={'-' + money(z.discounts)} />}
      {z.deliveryCharges > 0 && <Row k="Delivery charges" v={'+' + money(z.deliveryCharges)} />}
      {z.serviceCharges > 0 && <Row k="Service charge" v={'+' + money(z.serviceCharges)} />}
      {z.roundOff !== 0 && <Row k="Round off" v={money(z.roundOff)} />}
      <div className="r-sep" />
      <div className="r-line small"><span className="l">CASH</span><span className="r" /></div>
      <Row k="Cash collected" v={money(z.cash)} />
      {z.expenses > 0 && <Row k="Cash expenses" v={'-' + money(z.expenses)} />}
      <div className="r-line r-tot"><span className="l">CASH IN DRAWER</span><span className="r">{money(z.cashInDrawer)}</span></div>
      <div className="r-sep" />
      <div className="r-line small"><span className="l">VOIDS</span><span className="r">{z.voidCount ? `${z.voidCount} · ${money(z.voidTotal)}` : 'None'}</span></div>
      {z.voidedBills.slice(0, 10).map((v, i) => (
        <div className="r-line small" key={i}>
          <span className="l">{v.invoiceNo} · {v.reason}</span>
          <span className="r">{money(v.total)}</span>
        </div>
      ))}
      <div className="r-sep" />
      <div className="r-line small"><span className="l">BILLS</span><span className="r" /></div>
      {z.paidBills.map((b, i) => (
        <div className="r-line" key={i}>
          <span className="l">{b.invoiceNo} · {b.methods}</span>
          <span className="r">{money(b.total)}</span>
        </div>
      ))}
    </div>
  );
}

/** Print CSS: prints only the Z-report body when its print class is present. */
const zReportPrintCss = `
@media print {
  body.z-printing * { visibility: hidden !important; }
  body.z-printing .zreport-print, body.z-printing .zreport-print * { visibility: visible !important; }
  body.z-printing .modal-overlay { position: static !important; display: block !important; padding: 0 !important; background: none !important; }
  body.z-printing .modal { max-height: none !important; overflow: visible !important; padding: 0 !important; box-shadow: none !important; max-width: 100% !important; }
  body.z-printing .zreport-print { position: absolute; left: 0; top: 0; width: 100%; background: #fff; color: #000; padding: 0 !important; max-width: 100% !important; margin: 0 !important; }
}
`;
