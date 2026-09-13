import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { orderById, tableLabel } from '../selectors';
import type { Order } from '../types';
import { buildBill } from '../gst';
import { fmt, fmtQty } from '../money';
import { fmtDateTime, todayKey } from '../format';
import { buildReceiptText, whatsappShareUrl } from '../receipt';
import { openExternal } from '../openExternal';
import { Sheet, EmptyState } from '../components/ui';
import { IconPrint, IconTrash } from '../components/icons';

type Filter = 'today' | 'open' | 'paid' | 'void';

/** Date-range filter for the Paid tab: daily / weekly / monthly / all. */
type PaidRange = 'daily' | 'weekly' | 'monthly' | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start-of-range timestamp for a paid-range filter (local calendar).
 *  Daily = today 00:00 · Weekly = Monday 00:00 · Monthly = 1st 00:00. */
function paidRangeStart(range: PaidRange, now = new Date()): number {
  if (range === 'all') return 0;
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === 'daily') return dayStart;
  if (range === 'weekly') return dayStart - ((now.getDay() + 6) % 7) * DAY_MS;
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function paidRangeLabel(range: PaidRange): string {
  if (range === 'daily') return 'today';
  if (range === 'weekly') return 'this week';
  if (range === 'monthly') return 'this month';
  return 'all time';
}

export function OrdersScreen() {
  const { state, setScreen } = useStore();
  const [filter, setFilter] = useState<Filter>('today');
  const [paidRange, setPaidRange] = useState<PaidRange>('all');
  const [detailId, setDetailId] = useState<string | null>(null);

  const orders = useMemo(() => {
    const today = todayKey();
    const rangeStart = paidRangeStart(paidRange);
    return [...state.orders]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((o) => {
        switch (filter) {
          case 'open': return o.status === 'open';
          case 'paid':
            return o.status === 'paid' && o.paidAt !== null && o.paidAt >= rangeStart;
          case 'void': return o.status === 'void';
          case 'today':
            return o.status !== 'void' && todayKey(new Date(o.createdAt)) === today;
        }
      });
  }, [state.orders, filter, paidRange]);

  const counts = useMemo(() => {
    const today = todayKey();
    return {
      today: state.orders.filter((o) => o.status !== 'void' && todayKey(new Date(o.createdAt)) === today).length,
      open: state.orders.filter((o) => o.status === 'open').length,
      paid: state.orders.filter((o) => o.status === 'paid').length,
      void: state.orders.filter((o) => o.status === 'void').length,
    };
  }, [state.orders]);

  // Sales summary for the current Paid view (count + total collected).
  const paidSummary = useMemo(() => {
    const rangeStart = paidRangeStart(paidRange);
    const bills = state.orders.filter((o) => o.status === 'paid' && o.paidAt !== null && o.paidAt >= rangeStart);
    const sales = bills.reduce((sum, o) => {
      const bill = buildBill({
        lines: o.lines,
        discount: o.discount,
        billing: state.billing,
        gstEnabled: o.gstEnabled,
        deliveryCharge: o.deliveryCharge,
      });
      return sum + bill.payable;
    }, 0);
    return { count: bills.length, sales };
  }, [state.orders, state.billing, paidRange]);

  return (
    <div>
      <div className="seg" style={{ margin: '12px 14px' }}>
        <button className={filter === 'today' ? 'active' : ''} onClick={() => setFilter('today')}>
          Today ({counts.today})
        </button>
        <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>
          Open ({counts.open})
        </button>
        <button className={filter === 'paid' ? 'active' : ''} onClick={() => setFilter('paid')}>
          Paid ({counts.paid})
        </button>
        <button className={filter === 'void' ? 'active' : ''} onClick={() => setFilter('void')}>
          Void ({counts.void})
        </button>
      </div>

      {filter === 'paid' && (
        <>
          <div className="chips wrap" style={{ margin: '0 14px 8px' }}>
            {(['daily', 'weekly', 'monthly', 'all'] as const).map((r) => (
              <button
                key={r}
                className={`chip ${paidRange === r ? 'active' : ''}`}
                onClick={() => setPaidRange(r)}
              >
                {r === 'daily' ? 'Daily' : r === 'weekly' ? 'Weekly' : r === 'monthly' ? 'Monthly' : 'All'}
              </button>
            ))}
          </div>
          {paidRange !== 'all' && (
            <div className="card" style={{ margin: '0 14px 10px', padding: '10px 14px' }}>
              <div className="sum-row" style={{ padding: '1px 0' }}>
                <span className="k">{paidRangeLabel(paidRange)}</span>
                <span className="v">{paidSummary.count} bill(s) · {fmt(paidSummary.sales)}</span>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ padding: '0 14px' }}>
        {orders.length === 0 && <EmptyState icon="📋" text="No orders in this view." />}
        {orders.map((o) => (
          <button
            key={o.id}
            className="list-row"
            style={{ width: '100%', textAlign: 'left', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8, boxShadow: 'var(--shadow)', cursor: 'pointer' }}
            onClick={() => setDetailId(o.id)}
          >
            <div className="grow">
              <div className="list-title">
                {o.status === 'open' ? 'Open order' : o.invoiceNo || '—'} · {tableLabel(state, o)}
              </div>
              <div className="list-sub">
                {fmtDateTime(o.createdAt)} · {o.lines.reduce((s, l) => s + l.qty, 0)} item(s)
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <OrderAmount order={o} />
              <StatusBadge status={o.status} />
            </div>
          </button>
        ))}
      </div>

      <Sheet open={!!detailId} onClose={() => setDetailId(null)}>
        {detailId && <OrderDetail orderId={detailId} onClose={() => setDetailId(null)} onReprint={() => { setDetailId(null); setScreen({ name: 'receipt', orderId: detailId }); }} />}
      </Sheet>
    </div>
  );
}

function OrderAmount({ order }: { order: Order }) {
  const { state } = useStore();
  if (order.status === 'void') return null;
  const bill = buildBill({
    lines: order.lines,
    discount: order.discount,
    billing: state.billing,
    gstEnabled: order.gstEnabled,
    deliveryCharge: order.deliveryCharge,
  });
  return <div className="bold mono">{fmt(bill.payable)}</div>;
}

function StatusBadge({ status }: { status: Order['status'] }) {
  if (status === 'paid') return <div><span className="badge badge-ok">Paid</span></div>;
  if (status === 'open') return <div><span className="badge badge-primary">Open</span></div>;
  return <div><span className="badge badge-danger">Void</span></div>;
}

function OrderDetail({ orderId, onClose, onReprint }: { orderId: string; onClose: () => void; onReprint: () => void }) {
  const { state, voidOrder, user, setScreen, repeatOrder } = useStore();
  const order = orderById(state, orderId);
  const [reason, setReason] = useState('');
  const [confirmVoid, setConfirmVoid] = useState(false);

  if (!order) return null;
  const bill = buildBill({
    lines: order.lines,
    discount: order.discount,
    billing: state.billing,
    gstEnabled: order.gstEnabled,
    deliveryCharge: order.deliveryCharge,
  });
  const isAdmin = user?.role === 'admin';

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <div>
          <div className="bold" style={{ fontSize: 16 }}>
            {order.status === 'open' ? 'Open order' : `Bill ${order.invoiceNo}`} · {tableLabel(state, order)}
          </div>
          <div className="small muted">{fmtDateTime(order.createdAt)}</div>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {order.kotNos.length > 0 && (
        <div className="small muted" style={{ margin: '4px 0 8px' }}>
          KOT: {order.kotNos.join(', ')}
        </div>
      )}

      {(order.customerName || order.customerPhone || order.customerAddress) && (
        <div className="card" style={{ padding: 10, margin: '8px 0' }}>
          {order.customerName && <div className="small">👤 {order.customerName}</div>}
          {order.customerPhone && <div className="small">📞 {order.customerPhone}</div>}
          {order.customerAddress && <div className="small muted">📍 {order.customerAddress}</div>}
        </div>
      )}

      <div style={{ margin: '8px 0' }}>
        {order.lines.map((l, i) => (
          <div className="cart-line" key={i}>
            <div className="grow">
              <div className="cl-name">{l.name}</div>
              {l.note && <div className="cl-note">“{l.note}”</div>}
            </div>
            <span className="muted small">×{fmtQty(l.qty)}</span>
            <div className="cl-amt">{fmt(l.qty * l.unitPrice)}</div>
          </div>
        ))}
      </div>

      <div className="sum-row">
        <span className="k">Subtotal</span><span className="v">{fmt(bill.foodTaxable)}</span>
      </div>
      {bill.discount > 0 && (
        <div className="sum-row"><span className="k">Discount</span><span className="v">−{fmt(bill.discount)}</span></div>
      )}
      {bill.deliveryCharge > 0 && (
        <div className="sum-row"><span className="k">Delivery charge</span><span className="v">{fmt(bill.deliveryCharge)}</span></div>
      )}
      {bill.serviceCharge > 0 && (
        <div className="sum-row"><span className="k">Service charge</span><span className="v">{fmt(bill.serviceCharge)}</span></div>
      )}
      <div className="sum-row"><span className="k">CGST + SGST</span><span className="v">{fmt(bill.taxTotal)}</span></div>
      {bill.roundOff !== 0 && (
        <div className="sum-row"><span className="k">Round off</span><span className="v">{fmt(bill.roundOff)}</span></div>
      )}
      <div className="sum-row total">
        <span className="k">Total</span><span className="v">{fmt(bill.payable)}</span>
      </div>

      {order.payments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {order.payments.map((pay, i) => (
            <div className="sum-row" key={i}>
              <span className="k" style={{ textTransform: 'capitalize' }}>{pay.method}</span>
              <span className="v">{fmt(pay.amount)}</span>
            </div>
          ))}
          {order.payments.reduce((s, p) => s + p.amount, 0) - bill.payable > 0 && (
            <div className="sum-row" style={{ color: 'var(--ok)' }}>
              <span className="k">Change</span>
              <span className="v">{fmt(order.payments.reduce((s, p) => s + p.amount, 0) - bill.payable)}</span>
            </div>
          )}
        </div>
      )}

      {order.voidReason && (
        <div className="small muted" style={{ marginTop: 8 }}>
          Void reason: {order.voidReason}
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        {order.status === 'open' && (
          <button
            className="btn btn-primary grow"
            onClick={() => {
              onClose();
              setScreen({ name: 'order', orderId: order.id });
            }}
          >
            ✏️ Resume order
          </button>
        )}
        {order.status === 'paid' && order.lines.length > 0 && (
          <button
            className="btn btn-primary grow"
            onClick={() => {
              const copy = repeatOrder(order.id);
              if (copy) {
                onClose();
                setScreen({ name: 'order', orderId: copy.id });
              }
            }}
          >
            🔁 Repeat order
          </button>
        )}
        {order.status !== 'void' && order.status !== 'open' && (
          <>
            <button className="btn btn-ghost grow" onClick={onReprint}>
              <IconPrint width={16} height={16} /> Reprint
            </button>
            <button
              className="btn btn-ghost grow"
              onClick={() => {
                void openExternal(whatsappShareUrl(buildReceiptText(state, order)));
              }}
            >
              💬 Share
            </button>
          </>
        )}
        {isAdmin && order.status !== 'void' && (
          <button className="btn btn-danger grow" onClick={() => setConfirmVoid(true)}>
            <IconTrash width={16} height={16} /> Void
          </button>
        )}
        <button className="btn btn-ghost grow" onClick={onClose}>Close</button>
      </div>

      {confirmVoid && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--danger)', borderRadius: 10, background: 'var(--danger-soft)' }}>
          <div className="bold" style={{ marginBottom: 6 }}>Void this {order.status === 'paid' ? 'paid bill (refund)' : 'open order'}?</div>
          <input
            className="input"
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button
              className="btn btn-danger grow"
              disabled={reason.trim().length < 3}
              onClick={() => {
                voidOrder(order.id, reason.trim());
                onClose();
              }}
            >
              Confirm void
            </button>
            <button className="btn btn-ghost grow" onClick={() => setConfirmVoid(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
