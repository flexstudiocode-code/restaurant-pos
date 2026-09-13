import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../store';
import { isDesktop } from '../desktop';
import { isEditableTarget } from '../shortcuts';
import { orderById, tableLabel } from '../selectors';
import type { MenuItem, Order, Payment, PaymentMethod } from '../types';
import { buildBill } from '../gst';
import { fmt, rupeesToPaise, fmtQty } from '../money';
import { payWithRazorpay } from '../razorpay';
import { Modal, Sheet, EmptyState, Prompt, Chips, Switch } from '../components/ui';
import {
  IconBack,
  IconTrash,
  IconCash,
  IconUpi,
  IconCard,
  IconQr,
  IconCheck,
} from '../components/icons';

const QUICK_CASH = [0, 100, 200, 500, 1000, 2000];

export function OrderScreen({ orderId }: { orderId: string }) {
  const store = useStore();
  const { state, setScreen } = store;
  const order = orderById(state, orderId);
  const [phase, setPhase] = useState<'order' | 'checkout'>('order');
  const [catId, setCatId] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    if (!order) setScreen({ name: 'tab' });
  }, [order, setScreen]);

  if (!order) return null;

  const bill = buildBill({
    lines: order.lines,
    discount: order.discount,
    billing: state.billing,
    gstEnabled: order.gstEnabled,
    deliveryCharge: order.deliveryCharge,
  });

  return phase === 'checkout' ? (
    <Checkout
      order={order}
      onBack={() => setPhase('order')}
      onDone={() => setScreen({ name: 'receipt', orderId: order.id })}
    />
  ) : (
    <MenuCart
      order={order}
      catId={catId}
      setCatId={setCatId}
      query={query}
      setQuery={setQuery}
      cartOpen={cartOpen}
      setCartOpen={setCartOpen}
      bill={bill}
      onCheckout={() => setPhase('checkout')}
    />
  );
}

// ── Phase 1: menu + cart ──────────────────────────────────────────────────
function MenuCart(props: {
  order: Order;
  catId: string;
  setCatId: (c: string) => void;
  query: string;
  setQuery: (q: string) => void;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
  bill: ReturnType<typeof buildBill>;
  onCheckout: () => void;
}) {
  const { state, addItem, changeQty, removeLine, sendToKitchen, setLineNote, setCustomerInfo, setOrderNote, setScreen } = useStore();
  const { order, catId, setCatId, query, setQuery, cartOpen, setCartOpen, bill, onCheckout } = props;
  const [noteFor, setNoteFor] = useState<{ lineId: string; name: string; note: string } | null>(null);
  const [orderNoteOpen, setOrderNoteOpen] = useState(false);

  const categories = useMemo(
    () => [...state.categories].sort((a, b) => a.sort - b.sort),
    [state.categories]
  );
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.items
      .filter((i) => (catId === 'all' ? true : i.categoryId === catId))
      .filter((i) => (q ? i.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.sort - b.sort);
  }, [state.items, catId, query]);

  // ── Desktop keyboard-first ordering ────────────────────────────────────
  // Highlighted item (↑/↓/Enter act on it), quick search, and the keyboard
  // variant-size picker.
  const [hl, setHl] = useState(0);
  const [kbVariant, setKbVariant] = useState<MenuItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Keep the highlight inside the filtered list whenever the list changes.
  useEffect(() => setHl(0), [items]);

  // Scroll the highlighted item into view.
  useEffect(() => {
    if (!isDesktop() || items.length === 0) return;
    const el = document.querySelector(`[data-order-item="${items[Math.min(hl, items.length - 1)]?.id}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [hl, items]);

  // `/` focuses search; with search focused, ↑/↓ pick an item and Enter adds
  // it (keeping focus so items can be added back-to-back). Alt+P → checkout.
  useEffect(() => {
    if (!isDesktop()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        if (order.lines.length > 0) {
          e.preventDefault();
          onCheckout();
        }
        return;
      }
      const inSearch = document.activeElement === searchRef.current;
      if (!inSearch) {
        if (e.key === '/' && !isEditableTarget(e)) {
          e.preventDefault();
          setHl(0);
          searchRef.current?.focus();
        }
        return;
      }
      if (kbVariant) return; // size sheet open — Esc/Enter belong to it
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHl((h) => Math.min(h + 1, Math.max(0, items.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHl((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[hl];
        if (!it) return;
        if (it.variants.length > 0) setKbVariant(it);
        else addItem(order.id, it.id, 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        searchRef.current?.blur();
        setQuery('');
        setHl(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, hl, kbVariant, order.id, order.lines.length, addItem, onCheckout, setQuery]);

  const cartContent = (
    <>
      {order.type !== 'dine-in' && (
        <>
          <div className="field">
            <label>Customer name (optional)</label>
            <input
              className="input"
              value={order.customerName}
              placeholder={order.type === 'delivery' ? 'Delivery to…' : 'Name for takeaway'}
              onChange={(e) => setCustomerInfo(order.id, { name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Phone (optional)</label>
            <input
              className="input"
              inputMode="tel"
              value={order.customerPhone}
              placeholder="+91 …"
              onChange={(e) => setCustomerInfo(order.id, { phone: e.target.value })}
            />
          </div>
          {order.type === 'delivery' && (
            <div className="field">
              <label>Delivery address (optional)</label>
              <textarea
                className="textarea"
                rows={2}
                value={order.customerAddress}
                placeholder="House no, street, area…"
                onChange={(e) => setCustomerInfo(order.id, { address: e.target.value })}
              />
            </div>
          )}
        </>
      )}
      {order.lines.length === 0 ? (
        <EmptyState icon="🧾" text="No items yet. Tap items from the menu to add them." />
      ) : (
        <>
          {order.lines.map((l) => {
            const amt = l.qty * l.unitPrice;
            return (
              <div className="cart-line" key={l.id}>
                <div className="grow">
                  <div className="cl-name">{l.name}</div>
                  {l.note && <div className="cl-note">“{l.note}”</div>}
                </div>
                <div className="mini-stepper">
                  <button onClick={() => changeQty(order.id, l.id, -1)}>−</button>
                  <span>{fmtQty(l.qty)}</span>
                  <button onClick={() => changeQty(order.id, l.id, 1)}>+</button>
                </div>
                <div className="cl-amt">{fmt(amt)}</div>
                <button
                  className="icon-btn"
                  onClick={() => setNoteFor({ lineId: l.id, name: l.name, note: l.note ?? '' })}
                  title="Add note"
                >
                  ✏️
                </button>
                <button className="icon-btn" onClick={() => removeLine(order.id, l.id)} title="Remove">
                  <IconTrash width={17} height={17} />
                </button>
              </div>
            );
          })}
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => sendToKitchen(order.id)}
          >
            🔥 Send to kitchen {order.lines.some((l) => !l.kotPrinted) ? '' : '(all sent)'}
          </button>
        </>
      )}
    </>
  );

  const bottomBar = (
    <div className="row" style={{ gap: 10 }}>
      <button className="btn btn-ghost grow" onClick={() => setCartOpen(true)}>
        🧾 Cart · {order.lines.length}
      </button>
      <button
        className="btn btn-primary grow"
        disabled={order.lines.length === 0}
        onClick={onCheckout}
      >
        Pay {fmt(bill.payable)}
      </button>
    </div>
  );

  return (
    <div className="order-layout two-pane">
      <div className="order-main">
        <div className="row" style={{ padding: '10px 14px 2px', gap: 8 }}>
          <button
            className={isDesktop() ? 'btn btn-ghost btn-sm' : 'icon-btn'}
            onClick={() => setScreen({ name: 'tab' })}
            title="Back to tables"
          >
            <IconBack />
            {isDesktop() && <span>Back to tables</span>}
          </button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold" style={{ fontSize: 15 }}>
              {tableLabel(state, order)}
            </div>
            <div className="small muted">
              {order.type === 'dine-in' ? 'Dine-in' : order.type === 'takeaway' ? 'Takeaway' : 'Delivery'} ·{' '}
              {order.lines.length} item(s) · {fmt(bill.netFood)}
            </div>
            {order.orderNote && <div className="small" style={{ color: 'var(--accent)' }}>📝 {order.orderNote}</div>}
          </div>
          <button
            className="icon-btn"
            title="Note for kitchen / rider"
            onClick={() => setOrderNoteOpen(true)}
          >
            📝
          </button>
          <button className="btn btn-accent btn-sm" onClick={() => sendToKitchen(order.id)}>
            🔥 KOT
          </button>
        </div>

        <div style={{ padding: '8px 14px 0' }}>
          <input
            ref={searchRef}
            className="input"
            placeholder="🔍 Search menu…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div style={{ padding: '10px 14px 4px' }}>
          <select
            className="select"
            value={catId}
            onChange={(e) => setCatId(e.target.value)}
            aria-label="Category"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="menu-grid">
          {items.map((it, i) => (
            <ItemCard
              key={it.id}
              itemId={it.id}
              order={order}
              addItem={addItem}
              changeQty={changeQty}
              removeLine={removeLine}
              highlighted={isDesktop() && i === hl}
            />
          ))}
          {items.length === 0 && <EmptyState icon="🍽" text="No menu items found." />}
        </div>
        <div className="mobile-cartbar">{bottomBar}</div>
      </div>

      <div className="order-cart desktop-cart">
        {cartContent}
        <div style={{ height: 10 }} />
        {bottomBar}
      </div>

      <Sheet open={cartOpen} onClose={() => setCartOpen(false)}>
        {cartContent}
        <div style={{ height: 10 }} />
        {bottomBar}
      </Sheet>

      {kbVariant && (
        <VariantSheet
          item={kbVariant}
          order={order}
          addItem={addItem}
          changeQty={changeQty}
          removeLine={removeLine}
          onClose={() => setKbVariant(null)}
        />
      )}

      <Prompt
        open={noteFor !== null}
        title={`Note for ${noteFor?.name ?? 'item'}`}
        placeholder="e.g. less spicy, extra gravy"
        multiline
        initial={noteFor?.note ?? ''}
        onClose={() => setNoteFor(null)}
        onSubmit={(v) => {
          if (noteFor) setLineNote(order.id, noteFor.lineId, v);
          setNoteFor(null);
        }}
      />
      <Prompt
        open={orderNoteOpen}
        title="Note for kitchen / rider"
        placeholder="Shown on the KOT"
        multiline
        initial={order.orderNote ?? ''}
        onClose={() => setOrderNoteOpen(false)}
        onSubmit={(v) => {
          setOrderNote(order.id, v);
          setOrderNoteOpen(false);
        }}
      />
    </div>
  );
}

function ItemCard({
  itemId,
  order,
  addItem,
  changeQty,
  removeLine,
  highlighted = false,
}: {
  itemId: string;
  order: Order;
  addItem: (orderId: string, itemId: string, qty: number, variantId?: string) => void;
  changeQty: (orderId: string, lineId: string, delta: number) => void;
  removeLine: (orderId: string, lineId: string) => void;
  highlighted?: boolean;
}) {
  const { state } = useStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return null;
  const line = order.lines.find((l) => l.itemId === item.id);
  const itemQty = order.lines.filter((l) => l.itemId === item.id).reduce((s, l) => s + l.qty, 0);
  const soldOut = item.stock !== null && item.stock <= 0;
  const hasVariants = item.variants.length > 0;
  return (
    <div
      data-order-item={item.id}
      className={`item-card ${!item.available ? 'unavailable' : ''} ${hasVariants ? 'has-variants' : ''} ${highlighted ? 'keyboard-hl' : ''}`}
    >
      <div className="i-photo">
        {item.photo ? <img src={item.photo} alt={item.name} loading="lazy" /> : <span className="i-photo-ph">🍽</span>}
      </div>
      <div className="i-name">
        <span className={`veg-dot ${item.veg ? '' : 'nonveg'}`} />
        <span>{item.name}</span>
      </div>
      <div className="i-price">{fmt(item.price)}</div>
      <div className="i-meta">{item.gstRate}% GST</div>
      {hasVariants ? (
        <>
          <button
            className="sizes-btn"
            disabled={!item.available || soldOut}
            onClick={() => setPickerOpen(true)}
          >
            Sizes · {itemQty > 0 ? `${itemQty}×` : '+'}
          </button>
          {pickerOpen && (
            <VariantSheet
              item={item}
              order={order}
              addItem={addItem}
              changeQty={changeQty}
              removeLine={removeLine}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </>
      ) : line ? (
        <div className="qty-pill">
          <button onClick={() => changeQty(order.id, line.id, -1)}>−</button>
          <span>{fmtQty(line.qty)}</span>
          <button onClick={() => changeQty(order.id, line.id, 1)}>+</button>
        </div>
      ) : (
        <button
          className="add-btn"
          disabled={!item.available || soldOut}
          onClick={() => addItem(order.id, item.id, 1)}
        >
          +
        </button>
      )}
    </div>
  );
}

/** Size/portion picker sheet, shared by the mouse flow and the desktop
 *  keyboard flow (Enter on a highlighted item with variants opens this). */
function VariantSheet({
  item,
  order,
  addItem,
  changeQty,
  removeLine,
  onClose,
}: {
  item: MenuItem;
  order: Order;
  addItem: (orderId: string, itemId: string, qty: number, variantId?: string) => void;
  changeQty: (orderId: string, lineId: string, delta: number) => void;
  removeLine: (orderId: string, lineId: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open onClose={onClose}>
      <div className="bold" style={{ fontSize: 16, marginBottom: 2 }}>{item.name}</div>
      <div className="small muted" style={{ marginBottom: 10 }}>Choose a size</div>
      {item.variants.map((v) => {
        const vLine = order.lines.find((l) => l.itemId === item.id && l.variantId === v.id);
        const vQty = vLine?.qty ?? 0;
        return (
          <div className="size-row" key={v.id}>
            <div className="grow">
              <div className="cl-name">{v.label}</div>
              <div className="cl-amt">{fmt(v.price)}</div>
            </div>
            {vLine && vQty > 0 ? (
              <div className="mini-stepper">
                <button
                  onClick={() => (vQty === 1 ? removeLine(order.id, vLine.id) : changeQty(order.id, vLine.id, -1))}
                  title="Remove one"
                >
                  −
                </button>
                <span>{fmtQty(vQty)}</span>
                <button onClick={() => addItem(order.id, item.id, 1, v.id)} title="Add one">+</button>
              </div>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  addItem(order.id, item.id, 1, v.id);
                  onClose();
                }}
              >
                Add
              </button>
            )}
          </div>
        );
      })}
    </Sheet>
  );
}

// ── Phase 2: checkout ─────────────────────────────────────────────────────
function Checkout({
  order,
  onBack,
  onDone,
}: {
  order: Order;
  onBack: () => void;
  onDone: () => void;
}) {
  const { state, payOrder, setDiscount, setDeliveryCharge, setGstEnabled, splitOrder, notify, setScreen } = useStore();
  const bill = buildBill({
    lines: order.lines,
    discount: order.discount,
    billing: state.billing,
    gstEnabled: order.gstEnabled,
    deliveryCharge: order.deliveryCharge,
  });
  const payable = bill.payable;

  const [payments, setPayments] = useState<Payment[]>([]);
  const [cashTender, setCashTender] = useState('');
  const [upiAmt, setUpiAmt] = useState('');
  const [cardAmt, setCardAmt] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [payingOnline, setPayingOnline] = useState(false);
  const [discountPct, setDiscountPct] = useState('');
  const [deliveryChargeInput, setDeliveryChargeInput] = useState(
    order.deliveryCharge > 0 ? (order.deliveryCharge / 100).toFixed(2) : ''
  );
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitSel, setSplitSel] = useState<Set<string>>(new Set());

  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const due = Math.max(0, payable - paid);
  const change = Math.max(0, paid - payable);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const cashRef = useRef<HTMLInputElement>(null);

  // Desktop: land straight in the cash field so the cashier can type the
  // amount and press Enter without touching the mouse.
  useEffect(() => {
    if (isDesktop()) cashRef.current?.focus();
  }, []);

  // UPI QR
  useEffect(() => {
    if (!showQr || !qrRef.current) return;
    const upi = state.profile.upiId.trim();
    if (!upi) return;
    const uri = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(state.profile.upiName || state.profile.name)}&am=${(payable / 100).toFixed(2)}&tn=${encodeURIComponent(order.invoiceNo || 'Bill')}&cu=INR`;
    QRCode.toCanvas(qrRef.current, uri, { width: 220, margin: 1, color: { dark: '#111111', light: '#ffffff' } }).catch(() => {
      /* ignore */
    });
  }, [showQr, payable, order.invoiceNo, state.profile]);

  const completeWith = (ps: Payment[]) => {
    const label = payOrder(order.id, ps);
    if (label) {
      notify(`Bill ${label} paid`, 'ok');
      onDone();
    }
  };

  const handleCashTender = () => {
    const t = rupeesToPaise(cashTender);
    if (t === null || t <= 0) {
      notify('Enter a valid amount', 'err');
      return;
    }
    if (t >= due) {
      completeWith([...payments, { id: crypto.randomUUID(), method: 'cash', amount: t, receivedAt: Date.now() }]);
    } else {
      setPayments([...payments, { id: crypto.randomUUID(), method: 'cash', amount: t, receivedAt: Date.now() }]);
      setCashTender('');
      if (isDesktop()) cashRef.current?.focus(); // partial payment → keep typing
    }
  };

  const handleOther = (method: 'upi' | 'card', explicitAmt?: number) => {
    let amt = explicitAmt;
    if (amt === undefined) {
      const raw = method === 'upi' ? upiAmt : cardAmt;
      const parsed = rupeesToPaise(raw);
      if (parsed === null || parsed <= 0) {
        notify('Enter a valid amount', 'err');
        return;
      }
      amt = parsed;
    }
    if (amt > due) {
      notify('Amount exceeds balance due', 'err');
      return;
    }
    const next = [...payments, { id: crypto.randomUUID(), method, amount: amt, receivedAt: Date.now() }];
    if (amt === due) {
      completeWith(next);
    } else {
      setPayments(next);
      if (method === 'upi') setUpiAmt('');
      else setCardAmt('');
    }
  };

  const setDiscountPctInput = (v: string) => {
    setDiscountPct(v);
    const pct = Number(v);
    if (!Number.isFinite(pct) || pct < 0) return;
    const gross = order.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    setDiscount(order.id, Math.round((gross * Math.min(100, pct)) / 100));
  };

  const removePayment = (id: string) => setPayments((ps) => ps.filter((p) => p.id !== id));

  const canSplit = order.type === 'dine-in' && order.tableIndex !== null && order.lines.length >= 2;
  const splitTotal = order.lines
    .filter((l) => splitSel.has(l.id))
    .reduce((s, l) => s + l.qty * l.unitPrice, 0);

  const confirmSplit = () => {
    const moved = [...splitSel];
    if (moved.length === 0 || moved.length === order.lines.length) {
      notify('Choose some (not all) items to move to the other bill', 'err');
      return;
    }
    const newOrder = splitOrder(order.id, moved);
    if (newOrder) {
      setSplitOpen(false);
      setSplitSel(new Set());
      setPayments([]);
      setCashTender('');
      setDiscountPct('');
      setDeliveryChargeInput('');
      setScreen({ name: 'order', orderId: newOrder.id });
    }
  };

  const gw = state.gateway;
  const gwConfigured =
    gw.enabled && gw.keyId.trim().length > 0 && gw.serverUrl.trim().length > 0;

  // Online card / UPI via Razorpay Checkout. Only runs when the device is
  // online; the signature is verified by the payment helper server before the
  // bill is marked paid (see razorpay.ts). Falls back to the manual methods.
  const handleOnlinePay = async () => {
    if (!navigator.onLine) {
      notify('No internet — use UPI QR, cash or card', 'err');
      return;
    }
    setPayingOnline(true);
    try {
      const result = await payWithRazorpay(gw, {
        amountPaise: due,
        receipt: `POS-${order.id.slice(0, 8)}`,
        name: state.profile.name,
        description: `Bill for ${tableLabel(state, order)}`,
      });
      const pay: Payment = {
        id: crypto.randomUUID(),
        method: result.method,
        amount: due,
        receivedAt: Date.now(),
        ref: result.paymentId,
        gateway: 'razorpay',
      };
      completeWith([...payments, pay]);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Online payment failed', 'err');
      setPayingOnline(false);
    }
  };

  const methodIcon = (m: PaymentMethod) =>
    m === 'cash' ? <IconCash width={18} height={18} /> : m === 'upi' ? <IconUpi width={18} height={18} /> : <IconCard width={18} height={18} />;

  return (
    <div style={{ padding: '10px 14px 20px', maxWidth: 560, margin: '0 auto', width: '100%', minWidth: 0 }}>
      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <button
          className={isDesktop() ? 'btn btn-ghost btn-sm' : 'icon-btn'}
          onClick={onBack}
          title="Back to order"
        >
          <IconBack />
          {isDesktop() && <span>Back to order</span>}
        </button>
        <h2 style={{ margin: 0, fontSize: 17 }}>Checkout — {tableLabel(state, order)}</h2>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginTop: 0 }}>GST</div>
        <Switch
          on={order.gstEnabled}
          onChange={(v) => setGstEnabled(order.id, v)}
          label="Charge GST on this bill"
          sub={
            state.billing.pricingMode === 'inclusive'
              ? 'Prices already include GST — switching off just removes the CGST + SGST lines from the bill.'
              : 'Switching off removes GST (CGST + SGST) from this bill\'s total.'
          }
        />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginTop: 0 }}>Bill summary</div>
        <div className="sum-row">
          <span className="k">Subtotal ({order.lines.length} items)</span>
          <span className="v">{fmt(bill.foodTaxable)}</span>
        </div>
        {bill.discount > 0 && (
          <div className="sum-row">
            <span className="k">Discount</span>
            <span className="v" style={{ color: 'var(--danger)' }}>−{fmt(bill.discount)}</span>
          </div>
        )}
        {bill.deliveryCharge > 0 && (
          <div className="sum-row">
            <span className="k">Delivery charge</span>
            <span className="v">{fmt(bill.deliveryCharge)}</span>
          </div>
        )}
        {bill.serviceCharge > 0 && (
          <div className="sum-row">
            <span className="k">Service charge ({state.billing.serviceChargePct}%)</span>
            <span className="v">{fmt(bill.serviceCharge)}</span>
          </div>
        )}
        {bill.taxTotal > 0 && (
          <div className="sum-row">
            <span className="k">CGST + SGST</span>
            <span className="v">{fmt(bill.cgstTotal + bill.sgstTotal)}</span>
          </div>
        )}
        {bill.roundOff !== 0 && (
          <div className="sum-row">
            <span className="k">Round off</span>
            <span className="v">{fmt(bill.roundOff)}</span>
          </div>
        )}
        <div className="sum-row total">
          <span className="k">Total</span>
          <span className="v">{fmt(payable)}</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginTop: 0 }}>Discount</div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            type="number"
            min="0"
            max="100"
            placeholder="%"
            value={discountPct}
            onChange={(e) => setDiscountPctInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            style={{ width: 90 }}
          />
          <input
            className="input grow"
            placeholder="Flat ₹ amount"
            value={order.discount > 0 ? (order.discount / 100).toFixed(2) : ''}
            onChange={(e) => {
              setDiscountPct('');
              const p = rupeesToPaise(e.target.value);
              setDiscount(order.id, p ?? 0);
            }}
          />
          <button className="btn btn-ghost btn-sm" onClick={() => { setDiscount(order.id, 0); setDiscountPct(''); }}>
            Clear
          </button>
        </div>
      </div>

      {order.type === 'delivery' && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Delivery charge</div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input grow"
              inputMode="decimal"
              placeholder="Delivery fee (₹)"
              value={deliveryChargeInput}
              onChange={(e) => {
                setDeliveryChargeInput(e.target.value);
                const p = rupeesToPaise(e.target.value);
                setDeliveryCharge(order.id, p ?? 0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <button
              className="btn btn-ghost btn-sm"
              disabled={order.deliveryCharge === 0}
              onClick={() => {
                setDeliveryChargeInput('');
                setDeliveryCharge(order.id, 0);
              }}
            >
              Clear
            </button>
          </div>
          <div className="small muted" style={{ marginTop: 5 }}>
            Flat fee added to the bill total (not discounted, no GST of its own).
          </div>
        </div>
      )}

      {canSplit && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Split bill</div>
          <p className="small muted" style={{ margin: '0 0 10px' }}>
            Separate this table's bill into two checks (e.g. "separate bills please").
          </p>
          <button className="btn btn-ghost btn-block" onClick={() => setSplitOpen(true)}>
            ✂️ Split into two bills
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginTop: 0 }}>Payment</div>
        {isDesktop() && (
          <div className="small muted" style={{ margin: '-4px 0 8px' }}>
            ⌨ Type the amount and press Enter to pay
          </div>
        )}

        {payments.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {payments.map((p) => (
              <div className="row row-between" key={p.id} style={{ padding: '5px 0' }}>
                <span className="row" style={{ gap: 8 }}>
                  {methodIcon(p.method)}
                  <span className="small" style={{ textTransform: 'capitalize' }}>{p.method}</span>
                </span>
                <span className="row" style={{ gap: 8 }}>
                  <b className="mono">{fmt(p.amount)}</b>
                  <button className="icon-btn" onClick={() => removePayment(p.id)}>
                    <IconTrash width={15} height={15} />
                  </button>
                </span>
              </div>
            ))}
            <div className="sum-row total">
              <span className="k">Balance due</span>
              <span className="v">{fmt(due)}</span>
            </div>
            {change > 0 && (
              <div className="sum-row" style={{ color: 'var(--ok)' }}>
                <span className="k">Change to return</span>
                <span className="v">{fmt(change)}</span>
              </div>
            )}
          </div>
        )}

        {due > 0 ? (
          <>
            <div className="section-title" style={{ marginTop: 0 }}>Cash</div>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <input
                ref={cashRef}
                className="input grow"
                inputMode="decimal"
                placeholder="Cash received"
                value={cashTender}
                onChange={(e) => setCashTender(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCashTender();
                }}
              />
              <button className="btn btn-primary" onClick={handleCashTender}>
                {rupeesToPaise(cashTender) !== null && rupeesToPaise(cashTender)! >= due ? 'Complete' : 'Add'}
              </button>
            </div>
            <Chips style={{ padding: 0, marginBottom: 12 }}>
              {QUICK_CASH.map((q) => (
                <button
                  key={q}
                  className="chip"
                  onClick={() => setCashTender(q === 0 ? (due / 100).toFixed(2) : String(q))}
                >
                  {q === 0 ? 'Exact' : `₹${q}`}
                </button>
              ))}
            </Chips>

            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <button
                className="btn btn-ghost grow"
                onClick={() => { setUpiAmt((due / 100).toFixed(2)); handleOther('upi', due); }}
              >
                <IconUpi width={18} height={18} /> UPI exact
              </button>
              <button
                className="btn btn-ghost grow"
                onClick={() => { setCardAmt((due / 100).toFixed(2)); handleOther('card', due); }}
              >
                <IconCard width={18} height={18} /> Card exact
              </button>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input grow"
                inputMode="decimal"
                placeholder="UPI amount"
                value={upiAmt}
                onChange={(e) => setUpiAmt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleOther('upi');
                }}
              />
              <button className="btn btn-ghost" onClick={() => handleOther('upi')}>Add UPI</button>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <input
                className="input grow"
                inputMode="decimal"
                placeholder="Card amount"
                value={cardAmt}
                onChange={(e) => setCardAmt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleOther('card');
                }}
              />
              <button className="btn btn-ghost" onClick={() => handleOther('card')}>Add Card</button>
            </div>
            {state.profile.upiId.trim() && (
              <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => setShowQr(true)}>
                <IconQr width={18} height={18} /> Show UPI QR ({payable / 100})
              </button>
            )}
            {gwConfigured && (
              <button
                className="btn btn-accent btn-block"
                style={{ marginTop: 10 }}
                disabled={payingOnline}
                onClick={() => void handleOnlinePay()}
              >
                {payingOnline ? '⏳ Opening payment…' : '💳 Pay online (card / UPI)'}
              </button>
            )}
          </>
        ) : (
          <button className="btn btn-primary btn-block" style={{ fontSize: 16 }} onClick={() => completeWith(payments)}>
            <IconCheck width={18} height={18} /> Complete Payment
          </button>
        )}
      </div>

      <Modal open={showQr} onClose={() => setShowQr(false)} title="Scan to pay via UPI">
        <div style={{ textAlign: 'center' }}>
          <canvas ref={qrRef} style={{ width: 220, height: 220, maxWidth: '100%' }} />
          <div className="bold" style={{ marginTop: 10 }}>{state.profile.name}</div>
          <div className="muted small">{state.profile.upiId}</div>
          <div className="bold" style={{ fontSize: 20, marginTop: 6 }}>{fmt(payable)}</div>
          <p className="small muted">
            Customer scans with any UPI app (GPay, PhonePe, Paytm…) and pays straight to the restaurant's UPI
            account — no gateway or extra fees.
          </p>
        </div>
      </Modal>

      <Sheet open={splitOpen} onClose={() => setSplitOpen(false)}>
        <div className="bold" style={{ fontSize: 16, marginBottom: 2 }}>Split into two bills</div>
        <div className="small muted" style={{ marginBottom: 10 }}>
          Tick the items that should move to the <b>new</b> bill. At least one item must stay on this bill.
        </div>
        {order.lines.map((l) => {
          const sel = splitSel.has(l.id);
          return (
            <button
              key={l.id}
              className="cart-line"
              style={{ width: '100%', textAlign: 'left', background: 'none', border: sel ? '1px solid var(--primary)' : '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', marginBottom: 6 }}
              onClick={() => {
                setSplitSel((prev) => {
                  const next = new Set(prev);
                  if (next.has(l.id)) next.delete(l.id);
                  else next.add(l.id);
                  return next;
                });
              }}
            >
              <span
                style={{
                  width: 20, height: 20, borderRadius: 5, border: '2px solid var(--border)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
                  background: sel ? 'var(--primary)' : 'transparent', color: '#fff', fontSize: 13,
                }}
              >
                {sel ? '✓' : ''}
              </span>
              <div className="grow">
                <div className="cl-name">{l.name}</div>
                <div className="cl-note">×{fmtQty(l.qty)}{l.note ? ` · “${l.note}”` : ''}</div>
              </div>
              <div className="cl-amt">{fmt(l.qty * l.unitPrice)}</div>
            </button>
          );
        })}
        <div className="sum-row total">
          <span className="k">Moving to new bill</span>
          <span className="v">{fmt(splitTotal)}</span>
        </div>
        <button
          className="btn btn-primary btn-block"
          disabled={splitSel.size === 0 || splitSel.size === order.lines.length}
          onClick={confirmSplit}
        >
          ✂️ Create separate bill ({fmt(splitTotal)})
        </button>
      </Sheet>
    </div>
  );
}
