import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { DEFAULT_BILL_LAYOUT, type BillLayout, type Order, type OrderLine, type State } from '../types';
import { buildBill } from '../bill';
import { invoiceLabel } from '../format';
import { billFontSizePct, billFontStyle } from '../billLayout';
import { ReceiptBody } from './ReceiptScreen';
import { Chips, Switch } from '../components/ui';
import { IconBack } from '../components/icons';

const PLACEHOLDER_HINT =
  'Available: {name} {address} {phone} {fssai} {invoice} {date} {time} {cashier} {covers} {table} {type}';

/** An order to preview with: the latest paid bill, or a demo built from the
 *  current menu when there is no paid bill yet. */
function previewOrder(state: State): Order {
  const paid = [...state.orders]
    .filter((o) => o.status === 'paid')
    .sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
  if (paid.length > 0) return paid[0];
  const items = state.items.filter((i) => i.available).slice(0, 3);
  const lines: OrderLine[] = items.map((i, idx) => ({
    id: 'demo-' + idx,
    itemId: i.id,
    name: i.name,
    unitPrice: i.price,
    qty: 1,
    veg: i.veg,
    note: '',
    kotPrinted: false,
  }));
  const now = Date.now();
  return {
    id: 'demo',
    invoiceNo: state.invoiceCounter > 0 ? invoiceLabel(state.profile.invoicePrefix, state.invoiceCounter) : 'INV-0001',
    kotNos: [],
    type: 'dine-in',
    tableIndex: 0,
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    orderNote: '',
    lines,
    discount: 0,
    serviceCharge: 0,
    deliveryCharge: 0,
    status: 'paid',
    payments: [],
    createdAt: now,
    paidAt: now,
    voidReason: '',
    staffName: 'Manager',
    closedBy: 'Manager',
    updatedAt: now,
  };
}

function TextLinesEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (lines: string[]) => void;
  placeholder: string;
}) {
  return (
    <textarea
      className="textarea"
      style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 13 }}
      rows={4}
      value={value.join('\n')}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.split('\n'))}
    />
  );
}

const SECTION_TOGGLES: { key: keyof BillLayout; label: string; sub: string }[] = [
  { key: 'showRestaurantName', label: 'Restaurant name header', sub: 'MEADOWS PARK in script with RESTAURANT below' },
  { key: 'showInvoiceLabel', label: '“INVOICE” label', sub: 'Show the invoice type line under the header' },
  { key: 'showColumnHeaders', label: 'Dish / Qty / Amnt column headers', sub: 'The header row above the items' },
  { key: 'showMarkers', label: 'Veg (*) / non-veg (#) markers', sub: 'Item marker next to the quantity' },
  { key: 'showInvoiceDetails', label: 'Invoice, date & customer details', sub: 'Invoice No, Date, Type and customer block' },
  { key: 'showPayments', label: 'Payments & change', sub: 'Cash / UPI / card amounts and change' },
  { key: 'showFooter', label: 'Footer (thanks) lines', sub: 'The closing message at the bottom' },
];

export function BillDesignScreen() {
  const { state, setScreen, updateBilling, notify } = useStore();
  const saved = state.billing.billLayout ?? DEFAULT_BILL_LAYOUT;
  const [layout, setLayout] = useState<BillLayout>(() => ({
    ...saved,
    headerLines: [...saved.headerLines],
    footerLines: [...saved.footerLines],
  }));

  const order = useMemo(() => previewOrder(state), [state]);
  const bill = buildBill({
    lines: order.lines,
    discount: order.discount,
    billing: state.billing,
    deliveryCharge: order.deliveryCharge,
  });
  const change = Math.max(0, order.payments.reduce((s, p) => s + p.amount, 0) - bill.payable);

  const dirty = JSON.stringify(layout) !== JSON.stringify(saved);
  const save = () => {
    updateBilling({ billLayout: layout });
    notify('Bill design saved', 'ok');
  };

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="row" style={{ padding: '10px 14px', gap: 8 }}>
        <button className="icon-btn" onClick={() => setScreen({ name: 'tab' })}>
          <IconBack />
        </button>
        <div className="grow">
          <div className="bold" style={{ fontSize: 15 }}>Bill design</div>
          <div className="small muted">Live preview — applies to print, thermal, USB & WhatsApp</div>
        </div>
      </div>

      <div className="receipt-screen" style={{ padding: '0 14px 14px' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="receipt-shell" data-print-size={layout.printSize} style={billFontStyle(layout)}>
            <ReceiptBody order={order} billPayable={bill.payable} change={change} layout={layout} />
          </div>
        </div>
      </div>

      <div className="card" style={{ margin: '0 14px 12px' }}>
        <div className="section-title" style={{ marginTop: 0 }}>Header lines</div>
        <TextLinesEditor
          value={layout.headerLines}
          onChange={(headerLines) => setLayout({ ...layout, headerLines })}
          placeholder={'MEADOWS PARK RESTAURANT\nOpen 7:00 AM - 11:00 PM'}
        />
        <div className="small muted" style={{ marginTop: 6 }}>
          One line per row, centred under the restaurant name. {PLACEHOLDER_HINT}
        </div>
      </div>

      <div className="card" style={{ margin: '0 14px 12px' }}>
        <div className="section-title" style={{ marginTop: 0 }}>Footer lines</div>
        <TextLinesEditor
          value={layout.footerLines}
          onChange={(footerLines) => setLayout({ ...layout, footerLines })}
          placeholder={'Thank you! Please visit again.'}
        />
        <div className="small muted" style={{ marginTop: 6 }}>
          Leave empty to keep the restaurant&apos;s footer note. {PLACEHOLDER_HINT}
        </div>
      </div>

      <div className="card" style={{ margin: '0 14px 12px' }}>
        <div className="section-title" style={{ marginTop: 0 }}>Sections</div>
        {SECTION_TOGGLES.map((t) => (
          <Switch
            key={t.key}
            on={Boolean(layout[t.key])}
            onChange={(v) => setLayout({ ...layout, [t.key]: v })}
            label={t.label}
            sub={t.sub}
          />
        ))}
      </div>

      <div className="card" style={{ margin: '0 14px 12px' }}>
        <div className="section-title" style={{ marginTop: 0 }}>Font size</div>
        <div className="small muted" style={{ marginBottom: 8 }}>
          How big the bill text is — on screen, in the Print dialog and on the thermal/USB printer
          (on the paper roll the receipt re-wraps so the larger text still fits the roll width).
        </div>
        <div className="row" style={{ gap: 12 }}>
          <input
            type="range"
            min={80}
            max={150}
            step={5}
            value={billFontSizePct(layout)}
            style={{ flex: 1 }}
            onChange={(e) => setLayout({ ...layout, fontSizePct: Number(e.target.value) })}
          />
          <span className="bold mono" style={{ width: 48, textAlign: 'right' }}>
            {billFontSizePct(layout)}%
          </span>
        </div>
        <div className="small muted" style={{ margin: '2px 0 8px' }}>
          80% smaller · 100% normal · 150% largest
        </div>
        <div className="section-title" style={{ marginTop: 10 }}>Font thickness</div>
        <Chips wrap>
          {(['regular', 'bold', 'extrabold'] as const).map((w) => (
            <button
              key={w}
              className={`chip ${(layout.fontWeight ?? 'regular') === w ? 'active' : ''}`}
              onClick={() => setLayout({ ...layout, fontWeight: w })}
            >
              {w === 'regular' ? 'Regular' : w === 'bold' ? 'Bold' : 'Extra bold'}
            </button>
          ))}
        </Chips>
      </div>

      <div className="row" style={{ padding: '0 14px' }}>
        <button className="btn btn-primary grow" disabled={!dirty} onClick={save}>
          Save bill design
        </button>
      </div>
    </div>
  );
}
