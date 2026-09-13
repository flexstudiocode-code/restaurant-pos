import { useState } from 'react';
import { useStore } from '../store';
import { EXPENSE_CATEGORIES } from '../types';
import { fmt, rupeesToPaise } from '../money';
import { todayKey, fmtDate } from '../format';
import { IconTrash } from '../components/icons';

export function ExpensesScreen() {
  const { state, addExpense, deleteExpense, notify } = useStore();
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayKey());

  const monthTotal = state.expenses
    .filter((e) => todayKey(new Date(e.createdAt)).slice(0, 7) === todayKey().slice(0, 7))
    .reduce((s, e) => s + e.amount, 0);

  const submit = () => {
    const paise = rupeesToPaise(amount);
    if (paise === null || paise <= 0) {
      notify('Enter a valid amount', 'err');
      return;
    }
    const d = new Date(date + 'T12:00:00');
    addExpense({
      amount: paise,
      category,
      note,
      createdAt: isNaN(d.getTime()) ? Date.now() : d.getTime(),
    });
    setAmount('');
    setNote('');
  };

  return (
    <div style={{ paddingBottom: 20 }}>
      <div className="section" style={{ paddingBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>Expenses & profit</div>
      </div>

      <div className="card" style={{ margin: '0 14px 12px' }}>
        <div className="row" style={{ gap: 8 }}>
          <div className="field grow">
            <label>Amount (₹)</label>
            <input className="input" inputMode="decimal" placeholder="500.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field" style={{ width: 150 }}>
            <label>Category</label>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="field grow">
            <label>Note (optional)</label>
            <input className="input" placeholder="e.g. Vegetables for the week" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="field" style={{ width: 150 }}>
            <label>Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary btn-block" onClick={submit}>
          + Record expense
        </button>

        <div className="row-between" style={{ marginTop: 14, marginBottom: 6 }}>
          <div className="small bold">This month</div>
          <div className="bold mono">{fmt(monthTotal)}</div>
        </div>
        {state.expenses.length === 0 ? (
          <div className="small muted" style={{ padding: '10px 0' }}>
            No expenses recorded yet. Add your first expense above.
          </div>
        ) : (
          state.expenses.slice(0, 15).map((e) => (
            <div className="row row-between" key={e.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <div className="grow">
                <div className="small bold">{e.category}</div>
                <div className="small muted">{fmtDate(e.createdAt)}{e.note ? ` · ${e.note}` : ''}</div>
              </div>
              <span className="bold mono" style={{ marginRight: 8 }}>−{fmt(e.amount)}</span>
              <button className="icon-btn" onClick={() => deleteExpense(e.id)}>
                <IconTrash width={15} height={15} />
              </button>
            </div>
          ))
        )}
        <div className="small muted" style={{ marginTop: 8 }}>
          Profit for any date range is shown in Reports → net sales minus expenses.
        </div>
      </div>
    </div>
  );
}
