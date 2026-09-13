import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { isDesktop } from '../desktop';
import { isEditableTarget } from '../shortcuts';
import { tableLabel } from '../selectors';
import type { Order } from '../types';
import { buildBill } from '../bill';
import { fmt } from '../money';
import { todayKey } from '../format';
import { Sheet } from '../components/ui';

export function TablesScreen() {
  const { state, user, newOrder, setScreen, setTab, voidOrder, notify } = useStore();
  const isAdmin = user?.role === 'admin';
  const today = todayKey();
  const [chooserTable, setChooserTable] = useState<number | null>(null);

  const openOrders = useMemo(
    () => state.orders.filter((o) => o.status === 'open'),
    [state.orders]
  );

  const openByTable = useMemo(() => {
    const map = new Map<number, Order[]>();
    for (const o of openOrders) {
      if (o.type === 'dine-in' && o.tableIndex !== null) {
        const list = map.get(o.tableIndex) ?? [];
        list.push(o);
        map.set(o.tableIndex, list);
      }
    }
    return map;
  }, [openOrders]);

  const totals = useMemo(() => {
    let sales = 0;
    let orders = 0;
    for (const o of state.orders) {
      if (o.status !== 'paid' || !o.paidAt) continue;
      if (todayKey(new Date(o.paidAt)) !== today) continue;
      const bill = buildBill({
        lines: o.lines,
        discount: o.discount,
        billing: state.billing,
        deliveryCharge: o.deliveryCharge,
      });
      sales += bill.payable;
      orders += 1;
    }
    return { sales, orders };
  }, [state.orders, state.billing, today]);

  const pendingKots = useMemo(
    () => state.kots.filter((k) => k.status === 'pending').length,
    [state.kots]
  );

  const openOrder = useCallback(
    (tableIndex: number) => {
      const existing = openByTable.get(tableIndex) ?? [];
      if (existing.length === 1) {
        setScreen({ name: 'order', orderId: existing[0].id });
        return;
      }
      if (existing.length > 1) {
        setChooserTable(tableIndex);
        return;
      }
      const order = newOrder('dine-in', tableIndex);
      setScreen({ name: 'order', orderId: order.id });
    },
    [openByTable, newOrder, setScreen]
  );

  const counterOrder = useCallback(
    (type: 'takeaway' | 'delivery') => {
      const order = newOrder(type, null);
      setScreen({ name: 'order', orderId: order.id });
    },
    [newOrder, setScreen]
  );

  // Desktop: type a table number + Enter to open it; Alt+T/D for counter orders.
  const [quick, setQuick] = useState('');
  useEffect(() => {
    if (!isDesktop()) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e)) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === 't') { e.preventDefault(); counterOrder('takeaway'); return; }
        if (k === 'd') { e.preventDefault(); counterOrder('delivery'); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (chooserTable !== null) return; // open-bills picker is up — don't hijack digits
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setQuick((q) => (q + e.key).slice(0, 4));
      } else if (e.key === 'Enter' && quick) {
        e.preventDefault();
        const name = quick;
        setQuick('');
        const idx = state.profile.tableNames.indexOf(name);
        if (idx >= 0) openOrder(idx);
        else notify(`No table named “${name}”`, 'err');
      } else if (e.key === 'Escape') {
        setQuick('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quick, chooserTable, state.profile.tableNames, openOrder, counterOrder, notify]);

  const deoccupy = (tableIndex: number) => {
    const orders = openByTable.get(tableIndex) ?? [];
    if (orders.length === 0) return;
    const name = state.profile.tableNames[tableIndex];
    if (!window.confirm(`Deoccupy ${name}? This voids ${orders.length} open bill(s) on this table.`)) return;
    for (const o of orders) voidOrder(o.id, 'Table deoccupied');
    notify(`Table ${name} is now free`, 'ok');
  };

  return (
    <div>
      <div className="stat-grid" style={{ paddingBottom: 0 }}>
        <div className="stat-card">
          <div className="v">{fmt(totals.sales)}</div>
          <div className="k">Today's sales</div>
        </div>
        <div className="stat-card">
          <div className="v">{openOrders.length}</div>
          <div className="k">Open orders</div>
        </div>
        <div className="stat-card">
          <div className="v">{state.kots.filter((k) => k.status === 'pending').length}</div>
          <div className="k">KOTs in kitchen</div>
        </div>
        <div className="stat-card">
          <div className="v">{state.profile.tableNames.length}</div>
          <div className="k">Tables</div>
        </div>
      </div>

      <div className="section" style={{ paddingTop: 14, paddingBottom: 4 }}>
        <div className="section-title">Counter orders</div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-primary grow" onClick={() => counterOrder('takeaway')}>
            🥡 Takeaway
          </button>
          <button className="btn btn-ghost grow" onClick={() => counterOrder('delivery')}>
            🛵 Delivery
          </button>
        </div>
      </div>

      <div className="section" style={{ paddingTop: 10, paddingBottom: 4 }}>
        <div className="section-title" style={{ marginBottom: 10 }}>
          Dine-in
        </div>
        {isDesktop() && (
          <div className="small muted" style={{ margin: '-6px 0 10px' }}>
            ⌨ Type a table number + Enter to open{quick && (
              <b style={{ color: 'var(--primary)' }}> → Table {quick}_</b>
            )}
          </div>
        )}
        <div className="table-grid" style={{ padding: 0 }}>
          {state.profile.tableNames.map((name, i) => {
            const orders = openByTable.get(i) ?? [];
            const isOccupied = orders.length > 0;
            let amount = 0;
            for (const o of orders) {
              const bill = buildBill({
                lines: o.lines,
                discount: o.discount,
                billing: state.billing,
                deliveryCharge: o.deliveryCharge,
              });
              amount += bill.payable;
            }
            return (
              <div key={i} className={`table-card ${isOccupied ? 'occupied' : 'free'}`}>
                <button className="table-card-main" onClick={() => openOrder(i)}>
                  <div className="t-num">{name}</div>
                  <div className="t-status">
                    {isOccupied ? (orders.length > 1 ? `${orders.length} bills` : 'Occupied') : 'Free'}
                  </div>
                  <div className="t-amt">{isOccupied ? fmt(amount) : '—'}</div>
                </button>
                {isOccupied && (
                  <button
                    className="table-deoccupy"
                    onClick={() => deoccupy(i)}
                    title={`Deoccupy ${name}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Sheet open={chooserTable !== null} onClose={() => setChooserTable(null)}>
        {chooserTable !== null && (
          <>
            <div className="bold" style={{ fontSize: 16, marginBottom: 4 }}>
              Table {state.profile.tableNames[chooserTable]} — open bills
            </div>
            <div className="small muted" style={{ marginBottom: 10 }}>
              This table has more than one open bill. Choose one to continue.
            </div>
            {(openByTable.get(chooserTable) ?? [])
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((o) => {
                const bill = buildBill({
                  lines: o.lines,
                  discount: o.discount,
                  billing: state.billing,
                  deliveryCharge: o.deliveryCharge,
                });
                return (
                  <button
                    key={o.id}
                    className="list-row"
                    style={{ width: '100%', textAlign: 'left', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8, boxShadow: 'var(--shadow)' }}
                    onClick={() => {
                      setChooserTable(null);
                      setScreen({ name: 'order', orderId: o.id });
                    }}
                  >
                    <div className="grow">
                      <div className="list-title">{tableLabel(state, o)}</div>
                      <div className="list-sub">
                        {o.lines.length} item(s) · {o.lines.reduce((s, l) => s + l.qty, 0)} qty
                      </div>
                    </div>
                    <div className="bold mono">{fmt(bill.payable)}</div>
                  </button>
                );
              })}
          </>
        )}
      </Sheet>

      {isAdmin && pendingKots > 0 && (
        <div className="section" style={{ paddingTop: 0 }}>
          <button className="btn btn-accent btn-block" onClick={() => setTab('kitchen')}>
            🔥 {pendingKots} KOT(s) waiting in kitchen — view
          </button>
        </div>
      )}
    </div>
  );
}
