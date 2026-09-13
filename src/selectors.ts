import type { Order, State } from './types';

export function orderById(state: State, id: string): Order | undefined {
  return state.orders.find((o) => o.id === id);
}

export function openOrdersAtTable(state: State, tableIndex: number): Order[] {
  return state.orders.filter(
    (o) => o.type === 'dine-in' && o.tableIndex === tableIndex && o.status === 'open'
  );
}

/** Bill number (1-based) among open checks at the same table. */
export function billIndexAtTable(state: State, order: Order): number {
  if (order.type !== 'dine-in' || order.tableIndex === null) return 0;
  const siblings = openOrdersAtTable(state, order.tableIndex).sort(
    (a, b) => a.createdAt - b.createdAt
  );
  const idx = siblings.findIndex((o) => o.id === order.id);
  return idx >= 0 ? idx + 1 : 0;
}

export function tableLabel(state: State, order: Order): string {
  if (order.type === 'dine-in' && order.tableIndex !== null) {
    const base = `Table ${state.profile.tableNames[order.tableIndex] ?? order.tableIndex + 1}`;
    const total = openOrdersAtTable(state, order.tableIndex).length;
    if (total > 1 && order.status === 'open') {
      return `${base} · Bill ${billIndexAtTable(state, order)}`;
    }
    return base;
  }
  return order.type === 'takeaway' ? 'Takeaway' : 'Delivery';
}
