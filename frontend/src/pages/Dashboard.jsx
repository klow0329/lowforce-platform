import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useEventContext } from '../context/EventContext';
import TaskToDoBox from '../components/TaskToDoBox';

const fmtMYR = (n) => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const tile = {
  flex: '1 1 160px',
  textAlign: 'left',
  padding: 12,
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
  color: '#202330', // cards are <button> elements; without this they inherit the global white button text
};
const tileLabel = { fontSize: 12, color: '#5c6070' };
const tileValue = { fontSize: 22, fontWeight: 700, color: '#1B3A6B' };

export default function Dashboard() {
  const { selectedEventId, loading: eventLoading } = useEventContext();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [tasks, setTasks] = useState(null);

  function loadTasks() {
    if (!selectedEventId) return;
    api.getTasks(selectedEventId).then(setTasks);
  }

  useEffect(() => {
    if (!selectedEventId) return;
    api.getDashboard(selectedEventId).then(setData);
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  function handleAcknowledgePayment(allocationId) {
    api.acknowledgePaymentAllocation(allocationId).then(loadTasks);
  }

  function handleAcknowledgeInvoiceConfirm(invoiceId) {
    api.acknowledgeInvoiceConfirm(invoiceId).then(loadTasks);
  }

  function handleAcknowledgeCnConfirm(cnId) {
    api.acknowledgeCnConfirm(cnId).then(loadTasks);
  }

  function handleAcknowledgeContractApproval(soId) {
    api.acknowledgeSalesOrderApproval(soId).then(loadTasks);
  }

  function handleAcknowledgeReductionApproval(crId) {
    api.acknowledgeReductionApproval(crId).then(loadTasks);
  }

  // Acknowledging doesn't just dismiss the notification — it hands the user
  // straight to the Floor Plan's picker for that record (pre-loaded with
  // whatever booths it still legitimately holds, capped at its own
  // Total Sqm) so picking a replacement is the very next thing they do.
  // If they don't actually commit a new pick there, the persistent banner
  // on the record itself (see OpportunityDetail/SalesOrderDetail's
  // needs_booth_reallocation) keeps reminding them until they do.
  async function handleAcknowledgeBoothLoss(t) {
    const isContract = t.record_type === 'sales_order';
    const ackFn = isContract ? api.acknowledgeSalesOrderBoothLoss : api.acknowledgeOpportunityBoothLoss;
    const getFn = isContract ? api.getSalesOrder : api.getOpportunity;
    const listBoothsFn = isContract ? api.listSalesOrderBooths : api.listOpportunityBooths;
    const [, recordResult, boothsResult] = await Promise.all([
      ackFn(t.record_id), getFn(t.record_id), listBoothsFn(t.record_id),
    ]);
    const record = isContract ? recordResult.salesOrder : recordResult.opportunity;
    navigate('/floor-plan', {
      state: {
        pickFor: {
          mode: 'cap',
          recordType: isContract ? 'contract' : 'opportunity',
          recordId: t.record_id,
          returnPath: isContract ? `/sales-orders/${t.record_id}` : `/opportunities/${t.record_id}`,
          exhibitorName: t.exhibitor_name,
          preSelectedBooths: boothsResult.booths || [],
          cap: record.total_sqm || null,
        },
      },
    });
    loadTasks();
  }

  function handleAcknowledgePaymentProof(invoiceId, attachmentId) {
    api.acknowledgeInvoicePaymentProof(invoiceId, attachmentId).then(loadTasks);
  }

  function handleIssueScheduled(invoiceId) {
    if (!window.confirm('Issue this milestone invoice now? It gets a real invoice number and moves to Finance for confirmation.')) return;
    api.issueScheduledInvoice(invoiceId).then(loadTasks);
  }

  if (eventLoading || (selectedEventId && !data)) return <p style={{ maxWidth: 900, margin: '40px auto' }}>Loading...</p>;
  if (!selectedEventId) {
    return <p style={{ maxWidth: 900, margin: '40px auto' }}>No events set up yet — create one in Admin first.</p>;
  }

  const taskItems = tasks ? [
    ...tasks.opportunityFollowUps.map((t) => ({
      key: `opp-${t.id}`, urgency: t.urgency,
      label: `Follow up — ${t.exhibitor_name}`,
      meta: t.next_follow_up_date, href: `/opportunities/${t.id}`,
    })),
    ...tasks.pendingApprovals.map((t) => ({
      key: `so-${t.id}`, urgency: t.urgency,
      label: `Approve — ${t.exhibitor_name} (${t.submit_reason || 'new contract'})`,
      meta: 'Pending approval', href: `/sales-orders/${t.id}`,
    })),
    ...tasks.outstandingInvoices.map((t) => ({
      key: `inv-${t.id}`, urgency: t.urgency,
      label: `Payment expected — ${t.exhibitor_name} (${t.invoice_no})`,
      meta: fmtMYR(t.balance_due), href: `/invoices/${t.id}`,
    })),
    ...tasks.draftInvoices.map((t) => ({
      key: `draft-inv-${t.id}`, urgency: t.urgency,
      label: `Confirm invoice — ${t.exhibitor_name} (${t.invoice_no})`,
      meta: `${t.currency} ${Number(t.amount_myr).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`,
      href: `/invoices/${t.id}`,
    })),
    ...tasks.recentPayments.map((t) => ({
      key: `payment-${t.id}`, urgency: t.urgency,
      label: `Payment received — ${t.exhibitor_name} (${t.invoice_no})`,
      meta: `${fmtMYR(t.amount_myr)} on ${t.payment_date}`,
      // Clicking the row goes to the payment record itself — how much was
      // received, which invoice(s) it covers — with its own "View / Print
      // Receipt" button from there. The separate Acknowledge button
      // dismisses the to-do without leaving the page; it stays on the list
      // indefinitely until one of those happens.
      href: `/payments/${t.payment_id}`,
      actions: [{ label: 'Acknowledge', onClick: () => handleAcknowledgePayment(t.id) }],
    })),
    ...tasks.recentConfirmedInvoices.map((t) => ({
      key: `inv-confirmed-${t.id}`, urgency: t.urgency,
      label: `Invoice confirmed by Finance — ${t.exhibitor_name} (${t.invoice_no})`,
      meta: `${t.currency} ${Number(t.amount_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`,
      href: `/invoices/${t.id}`,
      actions: [{ label: 'Acknowledge', onClick: () => handleAcknowledgeInvoiceConfirm(t.id) }],
    })),
    // Milestone billing planned for later (see SalesOrderDetail.jsx's
    // milestone split form) — listed here regardless of how far off the
    // date is, since Sales can issue one early if the customer's ready
    // sooner; urgency just goes up as the date approaches.
    ...tasks.scheduledMilestones.map((t) => ({
      key: `scheduled-${t.id}`, urgency: t.urgency,
      label: `Milestone billing due — ${t.exhibitor_name}${t.billing_pct ? ` (${Number(t.billing_pct)}%)` : ''}`,
      meta: `${t.currency} ${Number(t.amount_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2 })} on ${t.expected_billing_date}`,
      href: `/sales-orders/${t.sales_order_id}`,
      actions: [{ label: 'Issue Invoice', onClick: () => handleIssueScheduled(t.id) }],
    })),
    ...tasks.pendingCnApprovals.map((t) => ({
      key: `cn-pending-${t.id}`, urgency: t.urgency,
      label: `Approve credit note — ${t.exhibitor_name}`,
      meta: fmtMYR(t.amount_myr), href: `/credit-notes/${t.id}`,
    })),
    ...tasks.pendingReductionApprovals.map((t) => ({
      key: `reduction-pending-${t.id}`, urgency: t.urgency,
      label: `Approve contract reduction — ${t.exhibitor_name}`,
      meta: `${t.currency} ${Number(t.old_total_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2 })} → ${Number(t.new_total_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`
        + (Number(t.cn_amount_myr) > 0.01 ? ` (+ ${fmtMYR(t.cn_amount_myr)} credit note)` : ''),
      href: `/sales-orders/${t.sales_order_id}`,
    })),
    ...tasks.draftCns.map((t) => ({
      key: `cn-draft-${t.id}`, urgency: t.urgency,
      label: `Confirm credit note — ${t.exhibitor_name} (${t.cn_no})`,
      meta: fmtMYR(t.amount_myr), href: `/credit-notes/${t.id}`,
    })),
    ...tasks.recentConfirmedCns.map((t) => ({
      key: `cn-confirmed-${t.id}`, urgency: t.urgency,
      label: `Credit note confirmed by Finance — ${t.exhibitor_name} (${t.cn_no})`,
      meta: fmtMYR(t.amount_myr),
      href: `/credit-notes/${t.id}`,
      actions: [{ label: 'Acknowledge', onClick: () => handleAcknowledgeCnConfirm(t.id) }],
    })),
    ...tasks.recentApprovedContracts.map((t) => ({
      key: `contract-approved-${t.id}`, urgency: t.urgency,
      label: t.status === 'APPROVED'
        ? `Approved — ${t.exhibitor_name}${t.change_reason ? ` (${t.change_reason})` : ''}`
        : `Rejected — ${t.exhibitor_name}${t.reject_reason ? `: ${t.reject_reason}` : ''}`,
      meta: fmtMYR(t.total_myr),
      href: `/sales-orders/${t.id}`,
      actions: [{ label: 'Acknowledge', onClick: () => handleAcknowledgeContractApproval(t.id) }],
    })),
    // Value Change requests Management has just resolved on your own deals
    // — mirrors recentApprovedContracts above (2026-08-01 user request:
    // this notification step didn't exist at all before).
    ...(tasks.recentResolvedReductions || []).map((t) => ({
      key: `reduction-resolved-${t.id}`, urgency: t.urgency,
      label: t.status === 'APPROVED'
        ? `Value Change approved — ${t.exhibitor_name}`
        : `Value Change rejected — ${t.exhibitor_name}${t.rejection_notes ? `: ${t.rejection_notes}` : ''}`,
      meta: `${t.currency} ${Number(t.old_total_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2 })} → ${Number(t.new_total_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`,
      href: `/sales-orders/${t.sales_order_id}#openReduction=${t.id}`,
      actions: [{ label: 'Acknowledge', onClick: () => handleAcknowledgeReductionApproval(t.id) }],
    })),
    // Booths this user's own Opportunity/draft Contract was still proposing
    // when a COMPETING contract for the same booth got approved first (Round
    // 6's "several deals can propose the same unsold booth at once" rule) —
    // they need to go back to the Floor Plan and pick a replacement.
    ...tasks.lostBoothClaims.map((t) => ({
      key: `booth-lost-${t.record_type}-${t.record_id}`, urgency: t.urgency,
      label: `Booth ${t.lost_booth_nos} went to another contract — ${t.exhibitor_name}`,
      meta: 'Please pick a replacement booth',
      href: t.record_type === 'sales_order' ? `/sales-orders/${t.record_id}` : `/opportunities/${t.record_id}`,
      actions: [{ label: 'Acknowledge', onClick: () => handleAcknowledgeBoothLoss(t) }],
    })),
    ...(tasks.paymentProofAttachments || []).map((t) => ({
      key: `payment-proof-${t.attachment_id}`, urgency: t.urgency,
      label: `Proof of payment attached — ${t.exhibitor_name} (${t.invoice_no})`,
      meta: t.original_filename,
      href: `/invoices/${t.id}`,
      actions: [{ label: 'Acknowledge', onClick: () => handleAcknowledgePaymentProof(t.id, t.attachment_id) }],
    })),
  ] : [];

  return (
    <div className="page" style={{ maxWidth: 900, margin: '40px auto' }}>
      {tasks && (
        <TaskToDoBox
          title="Task To-Do"
          items={taskItems}
          emptyText="Nothing urgent, due or coming up in the next 7 days."
        />
      )}

      <h2>Sales Dashboard</h2>

      <h3 style={{ fontSize: 14, color: '#5c6070', marginTop: 24 }}>Pipeline</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button style={tile} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Total Opportunities</div>
          <div style={tileValue}>{data.opportunities.total}</div>
        </button>
        <button style={tile} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Active</div>
          <div style={tileValue}>{data.opportunities.active}</div>
        </button>
        <button style={{ ...tile, background: '#eafaf1' }} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Won</div>
          <div style={{ ...tileValue, color: '#1A9C5B' }}>{data.opportunities.won}</div>
        </button>
        <button style={{ ...tile, background: '#fdecec' }} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Lost</div>
          <div style={{ ...tileValue, color: '#D13434' }}>{data.opportunities.lost}</div>
        </button>
        <button style={tile} onClick={() => navigate('/opportunities')}>
          <div style={tileLabel}>Conversion Rate</div>
          <div style={tileValue}>{data.opportunities.conversionRatePct.toFixed(1)}%</div>
        </button>
        <button
          style={{ ...tile, border: data.followUpsDue > 0 ? '2px solid #F47920' : tile.border }}
          onClick={() => navigate('/opportunities')}
        >
          <div style={tileLabel}>Follow-Ups Due</div>
          <div style={{ ...tileValue, color: data.followUpsDue > 0 ? '#F47920' : 'inherit' }}>{data.followUpsDue}</div>
        </button>
        <button style={tile} onClick={() => navigate('/sales-orders')} title="Physical booths on approved contracts only — Bare Space, Shell Scheme, Enhanced Shell, Walk-On Package and Custom Build">
          <div style={tileLabel}>Total Booth Contracted</div>
          <div style={tileValue}>{data.totalBooths.count}</div>
          <div style={tileLabel}>{data.totalBooths.totalSqm} sqm</div>
        </button>
      </div>

      <h3 style={{ fontSize: 14, color: '#5c6070', marginTop: 24 }}>Finance</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button style={tile} onClick={() => navigate('/sales-orders')} title="Approved contracts only">
          <div style={tileLabel}>Total Contracted Value</div>
          <div style={tileValue}>{fmtMYR(data.totalContractValue)}</div>
        </button>
        <button style={tile} onClick={() => navigate('/sales-orders')}>
          <div style={tileLabel}>Contracted, Not Yet Invoiced</div>
          <div style={tileValue}>{data.contractedNotInvoiced.count}</div>
          <div style={tileLabel}>{fmtMYR(data.contractedNotInvoiced.totalValue)}</div>
        </button>
        <button style={tile} onClick={() => navigate('/invoices')}>
          <div style={tileLabel}>Total Invoiced</div>
          <div style={tileValue}>{fmtMYR(data.totalInvoiced)}</div>
        </button>
        <button style={{ ...tile, background: '#eafaf1' }} onClick={() => navigate('/invoices')}>
          <div style={tileLabel}>Total Collected</div>
          <div style={{ ...tileValue, color: '#1A9C5B' }}>{fmtMYR(data.totalCollected)}</div>
        </button>
        <button
          style={{ ...tile, background: data.totalOutstanding > 0 ? '#fdecec' : '#fff' }} onClick={() => navigate('/customer-aging')}
          title="Total Contracted Value − Total Collected — includes amounts not yet invoiced or not yet due"
        >
          <div style={tileLabel}>Total Outstanding</div>
          <div style={{ ...tileValue, color: data.totalOutstanding > 0 ? '#D13434' : 'inherit' }}>{fmtMYR(data.totalOutstanding)}</div>
        </button>
      </div>
    </div>
  );
}
