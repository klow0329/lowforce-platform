// Company-configurable approval workflow (Salesforce CPQ / NetSuite style):
// certain actions flag a contract as PENDING_APPROVAL until an Admin/
// Management user approves or rejects it. Each check is a no-op unless the
// company has an active rule for that trigger — so a company with no rules
// configured never sees any of this (contracts stay auto-APPROVED).

async function getActiveRules(client, companyId, triggerType) {
  const result = await client.query(
    `SELECT * FROM approval_rules WHERE company_id = $1 AND trigger_type = $2 AND is_active = TRUE ORDER BY sort_order`,
    [companyId, triggerType]
  );
  return result.rows;
}

function ruleTriggered(rule, value) {
  if (!rule.threshold_type || rule.threshold_value === null || rule.threshold_value === undefined) return true;
  return Number(value) >= Number(rule.threshold_value);
}

async function flagForApproval(client, companyId, salesOrderId, triggerType, actorUserId, notes) {
  await client.query(
    `UPDATE sales_orders SET status = 'PENDING_APPROVAL' WHERE id = $1 AND company_id = $2 AND status != 'PENDING_APPROVAL'`,
    [salesOrderId, companyId]
  );
  await client.query(
    `INSERT INTO approval_log (sales_order_id, action, actor_user_id, notes, flagged_tax_change)
     VALUES ($1, 'FLAGGED', $2, $3, $4)`,
    [salesOrderId, actorUserId || null, notes, triggerType === 'TAX_CHANGE']
  );
}

async function checkNewContract(client, companyId, salesOrderId, actorUserId) {
  const rules = await getActiveRules(client, companyId, 'NEW_CONTRACT');
  if (rules.length === 0) return false;
  await flagForApproval(client, companyId, salesOrderId, 'NEW_CONTRACT', actorUserId, 'New contract requires approval.');
  return true;
}

// discountValue is whatever unit discount_type implies (percent points, or a
// flat amount in the contract's currency); subtotal is the line's pre-
// discount amount, needed to express a FLAT discount as a percent too.
async function checkDiscount(client, companyId, salesOrderId, discountType, discountValue, subtotal, actorUserId) {
  if (!discountValue || Number(discountValue) <= 0) return false;
  const rules = await getActiveRules(client, companyId, 'DISCOUNT_ABOVE_THRESHOLD');
  const discountPct = discountType === 'PERCENT' ? Number(discountValue) : (subtotal > 0 ? (Number(discountValue) / subtotal) * 100 : 0);
  for (const rule of rules) {
    const compareValue = rule.threshold_type === 'FLAT' ? Number(discountValue) : discountPct;
    if (ruleTriggered(rule, compareValue)) {
      await flagForApproval(
        client, companyId, salesOrderId, 'DISCOUNT_ABOVE_THRESHOLD', actorUserId,
        `Line item discount of ${discountType === 'PERCENT' ? discountValue + '%' : discountValue} requires approval.`
      );
      return true;
    }
  }
  return false;
}

async function checkPostApprovalEdit(client, companyId, salesOrderId, wasApproved, actorUserId) {
  if (!wasApproved) return false;
  const rules = await getActiveRules(client, companyId, 'POST_APPROVAL_EDIT');
  if (rules.length === 0) return false;
  await flagForApproval(client, companyId, salesOrderId, 'POST_APPROVAL_EDIT', actorUserId, 'Contract edited after approval.');
  return true;
}

// totalMyr: the contract's current total_myr, already recomputed by the
// caller (recomputeTotals) before this runs — always MYR regardless of the
// contract's own currency, so one threshold works across USD/MYR contracts
// alike.
async function checkRevenueThreshold(client, companyId, salesOrderId, totalMyr, actorUserId) {
  const rules = await getActiveRules(client, companyId, 'REVENUE_ABOVE_THRESHOLD');
  for (const rule of rules) {
    if (ruleTriggered(rule, totalMyr)) {
      await flagForApproval(
        client, companyId, salesOrderId, 'REVENUE_ABOVE_THRESHOLD', actorUserId,
        `Contract total RM${Number(totalMyr).toLocaleString('en-MY', { minimumFractionDigits: 2 })} exceeds the revenue approval threshold.`
      );
      return true;
    }
  }
  return false;
}

// Credit notes aren't a document type LowForce issues yet — this trigger is
// registered so a company can configure the rule now (threshold + approver),
// ready for whenever the Credit Note feature ships. No caller invokes this
// today.
async function checkCreditNote(client, companyId, salesOrderId, amount, actorUserId) {
  const rules = await getActiveRules(client, companyId, 'CREDIT_NOTE_ISSUED');
  for (const rule of rules) {
    if (ruleTriggered(rule, amount)) {
      await flagForApproval(
        client, companyId, salesOrderId, 'CREDIT_NOTE_ISSUED', actorUserId,
        `Credit note of RM${Number(amount).toLocaleString('en-MY', { minimumFractionDigits: 2 })} requires approval.`
      );
      return true;
    }
  }
  return false;
}

module.exports = { checkNewContract, checkDiscount, checkPostApprovalEdit, checkRevenueThreshold, checkCreditNote };
