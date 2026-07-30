import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import { TEMPLATE_CODES } from '../components/BillingTemplate';

const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inputStyle = { display: 'block', width: '100%', padding: 8, boxSizing: 'border-box' };
const section = { marginBottom: 32 };

const STATUS_LABELS = { DRAFT: 'Draft', PENDING_APPROVAL: 'Pending Approval', APPROVED: 'Approved' };

const emptyLineForm = { line_type: 'REVENUE', section: '', sales_item_code: '', expense_code_id: '', description: '', budget_amount: '', comments: '' };
const emptyExpenseEntryForm = { expense_code_id: '', entry_date: '', reference: '', description: '', amount: '' };

function fmt(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Skeleton first pass of the Budget/LE/Actual P&L module — user explicitly
// asked to see the working flow before it's fully featured, so this covers
// the core loop (propose Budget -> Send for Approval -> Approve -> ongoing
// LE revisions -> Actual computed live) without the CSV bulk-import or
// drill-down/re-code UI yet (actual expenses are logged one at a time here;
// see budget-pl-module-plan memory for what's deliberately deferred and why).
export default function Budget({ user }) {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const [budget, setBudget] = useState(undefined); // undefined = loading, null = none yet
  const [lines, setLines] = useState([]);
  const [expenseCodes, setExpenseCodes] = useState([]);
  const [expenseEntries, setExpenseEntries] = useState([]);
  const [showLineForm, setShowLineForm] = useState(false);
  const [lineForm, setLineForm] = useState(emptyLineForm);
  const [showExpenseEntryForm, setShowExpenseEntryForm] = useState(false);
  const [expenseEntryForm, setExpenseEntryForm] = useState(emptyExpenseEntryForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    if (!selectedEventId) return;
    api.getBudget(selectedEventId).then(({ budget, lines }) => {
      setBudget(budget);
      setLines(lines || []);
    });
    api.listActualExpenseEntries(selectedEventId).then(({ entries }) => setExpenseEntries(entries));
  }

  useEffect(load, [selectedEventId]);
  useEffect(() => { api.listExpenseCodes().then(({ expenseCodes }) => setExpenseCodes(expenseCodes)); }, []);

  async function handleCreateBudget() {
    if (!window.confirm('Start a budget for this event?')) return;
    setError('');
    try {
      await api.createBudget(selectedEventId);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddLine(e) {
    e.preventDefault();
    setError('');
    try {
      await api.addBudgetLine(budget.id, lineForm);
      setLineForm(emptyLineForm);
      setShowLineForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdateLineField(l, field, value) {
    try {
      await api.updateBudgetLine(budget.id, l.id, { [field]: value });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteLine(l) {
    if (!window.confirm(`Remove this line ("${l.description}")?`)) return;
    setError('');
    try {
      await api.deleteBudgetLine(budget.id, l.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSubmitForApproval() {
    if (!window.confirm('Send this budget for approval? Once approved, the Budget figures lock — further changes go through LE.')) return;
    setBusy(true); setError('');
    try {
      await api.submitBudgetForApproval(budget.id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!window.confirm('Approve this budget?')) return;
    setBusy(true); setError('');
    try {
      await api.approveBudget(budget.id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!window.confirm('Reject this budget? It goes back to Draft.')) return;
    setBusy(true); setError('');
    try {
      await api.rejectBudget(budget.id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddExpenseEntry(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createActualExpenseEntry({ ...expenseEntryForm, event_id: selectedEventId });
      setExpenseEntryForm(emptyExpenseEntryForm);
      setShowExpenseEntryForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (eventLoading || budget === undefined) return <p style={{ maxWidth: 1000, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 1000, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  const revenueLines = lines.filter((l) => l.line_type === 'REVENUE');
  const expenseLines = lines.filter((l) => l.line_type === 'EXPENSE');
  const totalBudget = { revenue: revenueLines.reduce((s, l) => s + Number(l.budget_amount), 0), expense: expenseLines.reduce((s, l) => s + Number(l.budget_amount), 0) };
  const totalLE = { revenue: revenueLines.reduce((s, l) => s + Number(l.le_amount), 0), expense: expenseLines.reduce((s, l) => s + Number(l.le_amount), 0) };
  const totalActual = { revenue: revenueLines.reduce((s, l) => s + Number(l.actual_amount), 0), expense: expenseLines.reduce((s, l) => s + Number(l.actual_amount), 0) };

  if (!budget) {
    return (
      <div className="page" style={{ maxWidth: 1000, margin: '40px auto' }}>
        <h2>Budget</h2>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <p style={{ fontSize: 13, color: '#5c6070' }}>No budget has been started for this event yet.</p>
        <button onClick={handleCreateBudget}>+ Start Budget</button>
      </div>
    );
  }

  const isDraft = budget.status === 'DRAFT';
  const isPending = budget.status === 'PENDING_APPROVAL';
  const isApproved = budget.status === 'APPROVED';

  return (
    <div className="page" style={{ maxWidth: 1000, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          Budget
          <span style={{ fontSize: 13, padding: '2px 10px', borderRadius: 12, background: '#F5F6FA' }}>{STATUS_LABELS[budget.status]}</span>
        </h2>
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <p style={{ fontSize: 12, color: '#5c6070' }}>
        Prepared by {budget.preparer_name || '—'}{budget.approver_name ? ` · Approved by ${budget.approver_name}` : ''}
      </p>

      {isDraft && (
        <div style={{ background: '#F5F6FA', border: '1px solid #ddd', borderRadius: 8, padding: 12, margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>This budget is a draft — add your lines, then send it for approval.</span>
          <button onClick={handleSubmitForApproval} disabled={busy}>Send for Approval</button>
        </div>
      )}
      {isPending && (
        <div style={{ background: '#FFF3BF', border: '1px solid #F0C36D', borderRadius: 8, padding: 12, margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Pending approval.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleApprove} disabled={busy}>Approve</button>
            <button onClick={handleReject} disabled={busy}>Reject</button>
          </div>
        </div>
      )}
      {isApproved && (
        <div style={{ background: '#eafaf1', border: '1px solid #9fd8b8', borderRadius: 8, padding: 12, margin: '12px 0' }}>
          Approved — Budget figures are locked. Ongoing changes go through the LE column.
        </div>
      )}

      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginBottom: 4 }}>Lines</h3>
          {isDraft && (
            <button type="button" onClick={() => setShowLineForm(!showLineForm)}>{showLineForm ? 'Cancel' : '+ Add Line'}</button>
          )}
        </div>

        {showLineForm && (
          <form onSubmit={handleAddLine} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={label}>Type</label>
                <select style={inputStyle} value={lineForm.line_type} onChange={(e) => setLineForm({ ...lineForm, line_type: e.target.value, sales_item_code: '', expense_code_id: '' })}>
                  <option value="REVENUE">Revenue</option>
                  <option value="EXPENSE">Expense</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>Section</label>
                <input style={inputStyle} placeholder="e.g. SITE EXPENSES" value={lineForm.section} onChange={(e) => setLineForm({ ...lineForm, section: e.target.value.toUpperCase() })} required />
              </div>
            </div>
            {lineForm.line_type === 'REVENUE' ? (
              <>
                <label style={label}>Sales Item Code</label>
                <select style={inputStyle} value={lineForm.sales_item_code} onChange={(e) => setLineForm({ ...lineForm, sales_item_code: e.target.value })} required>
                  <option value="">— Select —</option>
                  {TEMPLATE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </>
            ) : (
              <>
                <label style={label}>Expense Code</label>
                <select style={inputStyle} value={lineForm.expense_code_id} onChange={(e) => setLineForm({ ...lineForm, expense_code_id: e.target.value })} required>
                  <option value="">— Select —</option>
                  {expenseCodes.filter((c) => (c.type || 'EXPENSE') === 'EXPENSE').map((c) => <option key={c.id} value={c.id}>{c.code} — {c.description}</option>)}
                </select>
                {expenseCodes.length === 0 && (
                  <p style={{ fontSize: 12, color: '#5c6070' }}>No expense codes set up yet — add some in Admin &gt; Expense Codes first.</p>
                )}
              </>
            )}
            <label style={label}>Description</label>
            <input style={inputStyle} value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} required />
            <label style={label}>Budget Amount (MYR{lineForm.line_type === 'EXPENSE' ? ', negative' : ''})</label>
            <input type="number" step="0.01" style={inputStyle} value={lineForm.budget_amount} onChange={(e) => setLineForm({ ...lineForm, budget_amount: e.target.value })} />
            <label style={label}>Comments</label>
            <input style={inputStyle} value={lineForm.comments} onChange={(e) => setLineForm({ ...lineForm, comments: e.target.value })} />
            <button type="submit" style={{ marginTop: 12 }}>Add Line</button>
          </form>
        )}

        <h4 style={{ fontSize: 13, color: '#5c6070', marginTop: 24 }}>Revenue</h4>
        <BudgetLineTable lines={revenueLines} isDraft={isDraft} isApproved={isApproved} onField={handleUpdateLineField} onDelete={handleDeleteLine} codeLabel="Sales Item" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, fontWeight: 700, fontSize: 13, padding: '8px 6px' }}>
          <span>Budget: {fmt(totalBudget.revenue)}</span><span>LE: {fmt(totalLE.revenue)}</span><span>Actual: {fmt(totalActual.revenue)}</span>
        </div>

        <h4 style={{ fontSize: 13, color: '#5c6070', marginTop: 24 }}>Expenses</h4>
        <BudgetLineTable lines={expenseLines} isDraft={isDraft} isApproved={isApproved} onField={handleUpdateLineField} onDelete={handleDeleteLine} codeLabel="Expense Code" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, fontWeight: 700, fontSize: 13, padding: '8px 6px' }}>
          <span>Budget: {fmt(totalBudget.expense)}</span><span>LE: {fmt(totalLE.expense)}</span><span>Actual: {fmt(totalActual.expense)}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, fontWeight: 700, fontSize: 15, padding: '12px 6px', borderTop: '2px solid #1B3A6B', marginTop: 8 }}>
          <span>Gross Profit — Budget: {fmt(totalBudget.revenue + totalBudget.expense)}</span>
          <span>LE: {fmt(totalLE.revenue + totalLE.expense)}</span>
          <span>Actual: {fmt(totalActual.revenue + totalActual.expense)}</span>
        </div>
      </div>

      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginBottom: 4 }}>Actual Expenses Log</h3>
          <button type="button" onClick={() => setShowExpenseEntryForm(!showExpenseEntryForm)}>{showExpenseEntryForm ? 'Cancel' : '+ Log Expense'}</button>
        </div>
        <p style={{ fontSize: 12, color: '#5c6070' }}>
          Each entry here feeds the Actual column of whichever Expense line shares its code — logged one at a time for now; bulk import is a natural next step once this shape is confirmed.
        </p>

        {showExpenseEntryForm && (
          <form onSubmit={handleAddExpenseEntry} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <label style={label}>Expense Code</label>
            <select style={inputStyle} value={expenseEntryForm.expense_code_id} onChange={(e) => setExpenseEntryForm({ ...expenseEntryForm, expense_code_id: e.target.value })} required>
              <option value="">— Select —</option>
              {expenseCodes.filter((c) => (c.type || 'EXPENSE') === 'EXPENSE').map((c) => <option key={c.id} value={c.id}>{c.code} — {c.description}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={label}>Date</label>
                <input type="date" style={inputStyle} value={expenseEntryForm.entry_date} onChange={(e) => setExpenseEntryForm({ ...expenseEntryForm, entry_date: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>Reference</label>
                <input style={inputStyle} value={expenseEntryForm.reference} onChange={(e) => setExpenseEntryForm({ ...expenseEntryForm, reference: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>Amount (MYR)</label>
                <input type="number" step="0.01" style={inputStyle} value={expenseEntryForm.amount} onChange={(e) => setExpenseEntryForm({ ...expenseEntryForm, amount: e.target.value })} required />
              </div>
            </div>
            <label style={label}>Description</label>
            <input style={inputStyle} value={expenseEntryForm.description} onChange={(e) => setExpenseEntryForm({ ...expenseEntryForm, description: e.target.value })} />
            <button type="submit" style={{ marginTop: 12 }}>Log Expense</button>
          </form>
        )}

        <table width="100%" cellPadding="6">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Date</th><th>Code</th><th>Description</th><th>Reference</th><th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {expenseEntries.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>{e.entry_date || '—'}</td>
                <td>{e.expense_code}</td>
                <td>{e.description || '—'}</td>
                <td>{e.reference || '—'}</td>
                <td style={{ textAlign: 'right' }}>{fmt(e.amount)}</td>
              </tr>
            ))}
            {expenseEntries.length === 0 && <tr><td colSpan={5}>No actual expenses logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BudgetLineTable({ lines, isDraft, isApproved, onField, onDelete, codeLabel }) {
  return (
    <table width="100%" cellPadding="6">
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
          <th>Section</th><th>{codeLabel}</th><th>Description</th>
          <th style={{ textAlign: 'right' }}>Budget</th><th style={{ textAlign: 'right' }}>LE</th><th style={{ textAlign: 'right' }}>Actual</th>
          <th>Comments</th><th></th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ fontSize: 12, color: '#5c6070' }}>{l.section}</td>
            <td>{l.sales_item_code || l.expense_code || '—'}</td>
            <td>{l.description}</td>
            <td style={{ textAlign: 'right' }}>
              {isDraft ? (
                <input type="number" step="0.01" style={{ width: 100, textAlign: 'right' }} defaultValue={l.budget_amount} onBlur={(e) => e.target.value != l.budget_amount && onField(l, 'budget_amount', e.target.value)} />
              ) : fmt(l.budget_amount)}
            </td>
            <td style={{ textAlign: 'right' }}>
              <input type="number" step="0.01" style={{ width: 100, textAlign: 'right' }} defaultValue={l.le_amount} onBlur={(e) => e.target.value != l.le_amount && onField(l, 'le_amount', e.target.value)} />
            </td>
            <td style={{ textAlign: 'right' }}>{fmt(l.actual_amount)}</td>
            <td>
              <input style={{ width: 140 }} defaultValue={l.comments || ''} onBlur={(e) => e.target.value !== (l.comments || '') && onField(l, 'comments', e.target.value)} />
            </td>
            <td>{isDraft && <button type="button" onClick={() => onDelete(l)}>Delete</button>}</td>
          </tr>
        ))}
        {lines.length === 0 && <tr><td colSpan={8} style={{ fontSize: 13, color: '#5c6070' }}>None yet.</td></tr>}
      </tbody>
    </table>
  );
}
