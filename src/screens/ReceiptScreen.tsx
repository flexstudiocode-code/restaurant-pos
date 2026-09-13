import { useEffect } from 'react';
import { useStore } from '../store';
import { isDesktop } from '../desktop';
import { isEditableTarget } from '../shortcuts';
import { orderById, tableLabel } from '../selectors';
import { DEFAULT_BILL_LAYOUT, thermalWidthMm, type BillLayout, type Order } from '../types';
import { buildBill } from '../bill';
import { fmtQty, fmtRec2 } from '../money';
import { fmtDateTime, splitBillName } from '../format';
import { applyBillPlaceholders, billFontStyle, billWeightNumber } from '../billLayout';
import { buildReceiptText, rasterWidthFor, receiptHeaderStyle, whatsappShareUrl } from '../receipt';
import { connectThermal, printRaster, useThermal, dotsForMm } from '../thermal';
import { printViaUsb, useUsbPrinter, usbCut } from '../usbThermal';
import { openExternal } from '../openExternal';
import { IconBack, IconPrint, IconPlus } from '../components/icons';

export function ReceiptScreen({ orderId }: { orderId: string }) {
  const { state, setScreen, newOrder, notify } = useStore();
  const thermal = useThermal();
  const usb = useUsbPrinter();
  const order = orderById(state, orderId);

  // Desktop: Alt+P prints the receipt without touching the mouse.
  useEffect(() => {
    if (!isDesktop()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'p' && !isEditableTarget(e)) {
        e.preventDefault();
        window.print();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!order || order.status === 'void') {
    return (
      <div className="empty-state">
        <div className="big">🧾</div>
        <div>Order not found.</div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setScreen({ name: 'tab' })}>
          Back to tables
        </button>
      </div>
    );
  }

  const bill = buildBill({
    lines: order.lines,
    discount: order.discount,
    billing: state.billing,
    deliveryCharge: order.deliveryCharge,
  });
  const paid = order.payments.reduce((s, p) => s + p.amount, 0);
  const change = Math.max(0, paid - bill.payable);

  // Bill design → font size & thickness: the on-screen/print preview scales
  // via CSS custom properties, and the thermal/USB raster prints the body at
  // the chosen weight, wrapping at fewer chars per line so a bigger font
  // still fits the paper roll.
  const billLayout = state.billing.billLayout ?? DEFAULT_BILL_LAYOUT;
  const mm = thermalWidthMm(state.billing.thermalWidth, state.billing.thermalCustomWidth);
  const dots = dotsForMm(mm);
  const headerStyle = receiptHeaderStyle(state, order);
  const printStyle = { ...headerStyle, fontWeight: billWeightNumber(billLayout) };
  const receiptText = buildReceiptText(state, order, {
    width: rasterWidthFor(mm, billLayout.fontSizePct),
  });
  const handleThermal = async () => {
    if (!thermal.connected) {
      const res = await connectThermal();
      if (!res.ok) {
        notify(res.error ?? 'Could not connect to printer', 'err');
        return;
      }
    }
    const err = await printRaster(receiptText, dots, printStyle);
    if (err) notify(err, 'err');
    else notify('Sent to thermal printer', 'ok');
  };

  const handleUsb = async () => {
    const res = await printViaUsb(receiptText, dots, printStyle);
    if (res.ok) notify('Sent to USB printer', 'ok');
    else notify(res.error ?? 'Could not print', 'err');
  };

  const handleCut = async () => {
    const res = await usbCut();
    if (res.ok) notify('Paper cut', 'ok');
    else notify(res.error ?? 'Could not cut paper', 'err');
  };

  const handleWhatsApp = () => {
    const url = whatsappShareUrl(
      buildReceiptText(state, order, { width: 32 })
    );
    void openExternal(url);
  };

  const openNewAtTable = () => {
    if (order.type === 'dine-in' && order.tableIndex !== null) {
      const o = newOrder('dine-in', order.tableIndex);
      setScreen({ name: 'order', orderId: o.id });
    } else {
      setScreen({ name: 'tab' });
    }
  };

  return (
    <div>
      <div className="row" style={{ padding: '10px 14px', gap: 8 }}>
        <button className="icon-btn" onClick={() => setScreen({ name: 'tab' })}>
          <IconBack />
        </button>
        <div className="grow">
          <div className="bold" style={{ fontSize: 15 }}>Payment complete</div>
          <div className="small muted">Bill {order.invoiceNo} · {tableLabel(state, order)}</div>
        </div>
      </div>

      <div style={{ padding: '0 14px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary grow" onClick={() => window.print()}>
          <IconPrint width={17} height={17} /> Print
        </button>
        <button
          className="btn btn-ghost grow"
          disabled={thermal.busy}
          onClick={() => void handleThermal()}
          title="Print to a Bluetooth ESC/POS thermal printer"
        >
          🖨 {thermal.connected ? 'Thermal ✓' : 'Thermal'}
        </button>
        {isDesktop() && (
          <button
            className="btn btn-ghost grow"
            disabled={usb.busy}
            onClick={() => void handleUsb()}
            title="Print to a USB thermal printer connected to this computer"
          >
            🔌 {usb.selected ? 'USB ✓' : 'USB'}
          </button>
        )}
        {isDesktop() && (
          <button
            className="btn btn-ghost grow"
            disabled={usb.busy}
            onClick={() => void handleCut()}
            title="Cut the paper on the USB printer (e.g. a receipt still hanging out)"
          >
            ✂️ Cut
          </button>
        )}
        <button className="btn btn-ghost grow" onClick={handleWhatsApp}>
          💬 WhatsApp
        </button>
      </div>

      <div className="receipt-screen" style={{ padding: '6px 14px 30px' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            className="receipt-shell"
            data-print-size={state.billing.billLayout?.printSize ?? 'medium'}
            style={billFontStyle(state.billing.billLayout)}
          >
            <ReceiptBody order={order} billPayable={bill.payable} change={change} />
          </div>
        </div>
      </div>

      <div style={{ padding: '0 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="btn btn-primary btn-block" onClick={openNewAtTable}>
          <IconPlus width={17} height={17} />
          {order.type === 'dine-in' ? 'Next customer at this table' : 'New order'}
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => setScreen({ name: 'tab' })}>
          Back to tables
        </button>
      </div>
    </div>
  );
}

export function ReceiptBody({
  order,
  billPayable,
  change,
  layout: layoutProp,
}: {
  order: Order;
  billPayable: number;
  change: number;
  /** Override the saved layout (used by the Bill design preview). */
  layout?: BillLayout;
}) {
  const { state } = useStore();
  const p = state.profile;
  const bill = buildBill({
    lines: order.lines,
    discount: order.discount,
    billing: state.billing,
    deliveryCharge: order.deliveryCharge,
  });
  const layout = layoutProp ?? state.billing.billLayout ?? DEFAULT_BILL_LAYOUT;
  const { main, suffix } = splitBillName(p.name);
  const cashier = order.closedBy || order.staffName;
  const covers = order.lines.reduce((s, l) => s + l.qty, 0);
  const scPct = state.billing.serviceChargePct;

  return (
    <>
      <div className="r-head">
        {layout.showRestaurantName && (
          <>
            <div className="r-name">
              {main && <span className="r-name-main">{main}</span>}
              {suffix && <span className="r-name-sub">{suffix}</span>}
            </div>
            <div className="r-sub">{p.address}</div>
            {p.phone && <div className="r-sub">Ph: {p.phone}</div>}
            {p.fssai && <div className="r-sub">FSSAI Lic No: {p.fssai}</div>}
          </>
        )}
        {layout.headerLines.map((line, i) => {
          const text = applyBillPlaceholders(line, state, order).trim();
          return text ? (
            <div className="r-sub" key={i}>{text}</div>
          ) : null;
        })}
        {layout.showInvoiceLabel && (
          <div className="r-sub" style={{ marginTop: 4 }}>INVOICE</div>
        )}
      </div>

      <div className="r-sep" />
      <div className="r-line">
        <span className="l">Cashier :{cashier}</span>
        <span className="r">Covers: {covers}</span>
      </div>
      <div className="r-sep" />

      {layout.showColumnHeaders && (
        <>
          <div className="r-cols">
            <span className="cn">Dish</span>
            <span className="cq">Qty</span>
            <span className="ca">Amnt</span>
          </div>
          <div className="r-sep" />
        </>
      )}

      {order.lines.map((l, i) => (
        <div className="r-item" key={i}>
          <span className="n">
            {l.name}
            {l.note ? ` (${l.note})` : ''}
          </span>
          <span className="m">
            {fmtQty(l.qty)}{' '}
            {layout.showMarkers && (
              <b className={l.veg ? 'mk-veg' : 'mk-nonveg'}>{l.veg ? '*' : '#'}</b>
            )}
          </span>
          <span className="a">{fmtRec2(l.qty * l.unitPrice)}</span>
        </div>
      ))}
      <div className="r-sep" />

      <div className="r-line">
        <span className="l">Subtotal</span>
        <span className="r">{fmtRec2(bill.foodGross)}</span>
      </div>
      {bill.discount > 0 && (
        <div className="r-line">
          <span className="l">Discount</span>
          <span className="r">-{fmtRec2(bill.discount)}</span>
        </div>
      )}
      {bill.deliveryCharge > 0 && (
        <div className="r-line">
          <span className="l">Delivery charge</span>
          <span className="r">+ {fmtRec2(bill.deliveryCharge)}</span>
        </div>
      )}
      {bill.serviceCharge > 0 && (
        <div className="r-line">
          <span className="l">Service Charge @{scPct.toFixed(2)} :</span>
          <span className="r">+ {fmtRec2(bill.serviceCharge)}</span>
        </div>
      )}
      {bill.roundOff !== 0 && (
        <div className="r-line">
          <span className="l">Round Off</span>
          <span className="r">{fmtRec2(bill.roundOff)}</span>
        </div>
      )}
      <div className="r-line r-tot">
        <span className="l">TOTAL</span>
        <span className="r">{fmtRec2(billPayable)}</span>
      </div>

      {layout.showInvoiceDetails && (
        <>
          <div className="r-sep" />
          <div className="r-line">
            <span className="l">Invoice No</span>
            <span className="r">{order.invoiceNo || '—'}</span>
          </div>
          <div className="r-line">
            <span className="l">Date</span>
            <span className="r">{order.paidAt ? fmtDateTime(order.paidAt) : fmtDateTime(order.createdAt)}</span>
          </div>
          <div className="r-line">
            <span className="l">Type</span>
            <span className="r">
              {order.type === 'dine-in'
                ? `Dine-in · ${tableLabel(state, order)}`
                : order.type === 'takeaway'
                  ? 'Takeaway'
                  : 'Delivery'}
            </span>
          </div>
          {order.customerName && (
            <div className="r-line">
              <span className="l">Customer</span>
              <span className="r">{order.customerName}</span>
            </div>
          )}
          {order.customerPhone && (
            <div className="r-line">
              <span className="l">Phone</span>
              <span className="r">{order.customerPhone}</span>
            </div>
          )}
          {order.customerAddress && (
            <div className="r-line">
              <span className="l">Address</span>
              <span className="r">{order.customerAddress}</span>
            </div>
          )}
        </>
      )}

      {layout.showPayments && (
        <>
          <div className="r-sep" />
          {order.payments.map((pay, i) => (
            <div className="r-line" key={i}>
              <span className="l" style={{ textTransform: 'uppercase' }}>
                {pay.method} {i === 0 && order.payments.length > 1 ? 'paid' : ''}
              </span>
              <span className="r">{fmtRec2(pay.amount)}</span>
            </div>
          ))}
          {change > 0 && (
            <div className="r-line">
              <span className="l">Change</span>
              <span className="r">{fmtRec2(change)}</span>
            </div>
          )}
        </>
      )}

      {layout.showFooter && (
        <div className="r-foot">
          <div className="r-sep" />
          {layout.footerLines.filter((l) => applyBillPlaceholders(l, state, order).trim()).length > 0 ? (
            layout.footerLines.map((line, i) => {
              const text = applyBillPlaceholders(line, state, order).trim();
              return text ? <div key={i}>{text}</div> : null;
            })
          ) : (
            <div>{p.footerNote}</div>
          )}
          <div>Thank you for dining with us!</div>
        </div>
      )}
    </>
  );
}
