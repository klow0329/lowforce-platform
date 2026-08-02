// Small fetch wrapper. `credentials: 'include'` is what lets the browser
// send/receive the session cookie that keeps a user logged in.
async function apiFetch(path, options = {}) {
  // FormData (file uploads) needs its own browser-set Content-Type with the
  // multipart boundary — never force JSON on top of it.
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    // Carries any extra fields an error response included (e.g.
    // existingSalesOrderId on a duplicate-contract 409) through to the
    // caller's catch block, not just the message.
    Object.assign(err, data);
    throw err;
  }
  return data;
}

export const api = {
  // company_id is omitted on the first attempt; if the response comes back
  // { requiresCompanySelection: true, companies }, resubmit with the id the
  // user picked from that list.
  login: (email, password, company_id) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, company_id }) }),
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),
  me: () => apiFetch('/auth/me'),
  switchRole: (role_code) => apiFetch('/auth/switch-role', { method: 'POST', body: JSON.stringify({ role_code }) }),
  changePassword: (payload) =>
    apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) }),

  listExhibitors: (search = '') => apiFetch(`/exhibitors?search=${encodeURIComponent(search)}`),
  getExhibitor: (id) => apiFetch(`/exhibitors/${id}`),
  createExhibitor: (payload) =>
    apiFetch('/exhibitors', { method: 'POST', body: JSON.stringify(payload) }),
  updateExhibitor: (id, payload) =>
    apiFetch(`/exhibitors/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  listCountries: () => apiFetch('/reference/countries'),
  createTaxDetailLink: (exhibitorId) =>
    apiFetch('/tax-details/create', { method: 'POST', body: JSON.stringify({ exhibitor_id: exhibitorId }) }),
  listAgents: () => apiFetch('/reference/agents'),
  listSegments: () => apiFetch('/reference/segments'),
  listSalespeople: () => apiFetch('/reference/salespeople'),
  listEvents: () => apiFetch('/reference/events'),
  listStages: () => apiFetch('/reference/stages'),
  getCompany: () => apiFetch('/reference/company'),

  brandingImageUrl: (type) => `/api/settings/branding/${type}`,
  uploadBrandingImage: (type, file) => {
    const body = new FormData();
    body.append('image', file);
    return apiFetch(`/settings/branding/${type}`, { method: 'POST', body });
  },
  deleteBrandingImage: (type) => apiFetch(`/settings/branding/${type}`, { method: 'DELETE' }),

  listAuditLog: (params) => apiFetch(`/audit/log?${new URLSearchParams(params)}`),

  listOpportunities: (params) => apiFetch(`/opportunities?${new URLSearchParams(params)}`),
  getOpportunitySummary: (eventId) => apiFetch(`/opportunities/summary?event_id=${eventId}`),
  getOpportunity: (id) => apiFetch(`/opportunities/${id}`),
  createOpportunity: (payload) =>
    apiFetch('/opportunities', { method: 'POST', body: JSON.stringify(payload) }),
  updateOpportunity: (id, payload) =>
    apiFetch(`/opportunities/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  listSalesOrders: (params) => apiFetch(`/sales-orders?${new URLSearchParams(params)}`),
  getSalesOrder: (id) => apiFetch(`/sales-orders/${id}`),
  createSalesOrder: (payload) =>
    apiFetch('/sales-orders', { method: 'POST', body: JSON.stringify(payload) }),
  updateSalesOrder: (id, payload) =>
    apiFetch(`/sales-orders/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  listInvoices: (params) => apiFetch(`/invoices?${new URLSearchParams(params)}`),
  getInvoice: (id) => apiFetch(`/invoices/${id}`),
  generateDraftInvoices: (payload) =>
    apiFetch('/invoices/generate-draft', { method: 'POST', body: JSON.stringify(payload) }),
  updateInvoice: (id, payload) =>
    apiFetch(`/invoices/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  withdrawInvoice: (id) => apiFetch(`/invoices/${id}`, { method: 'DELETE' }),
  issueScheduledInvoice: (id) => apiFetch(`/invoices/${id}/issue`, { method: 'POST' }),
  acknowledgeInvoiceConfirm: (id) => apiFetch(`/invoices/${id}/acknowledge`, { method: 'POST' }),

  listSalesOrderItems: (soId) => apiFetch(`/sales-orders/${soId}/items`),
  addSalesOrderItem: (soId, payload) =>
    apiFetch(`/sales-orders/${soId}/items`, { method: 'POST', body: JSON.stringify(payload) }),
  updateSalesOrderItem: (soId, itemId, payload) =>
    apiFetch(`/sales-orders/${soId}/items/${itemId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSalesOrderItem: (soId, itemId) =>
    apiFetch(`/sales-orders/${soId}/items/${itemId}`, { method: 'DELETE' }),

  listOpportunityItems: (oppId) => apiFetch(`/opportunities/${oppId}/items`),
  addOpportunityItem: (oppId, payload) =>
    apiFetch(`/opportunities/${oppId}/items`, { method: 'POST', body: JSON.stringify(payload) }),
  updateOpportunityItem: (oppId, itemId, payload) =>
    apiFetch(`/opportunities/${oppId}/items/${itemId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteOpportunityItem: (oppId, itemId) =>
    apiFetch(`/opportunities/${oppId}/items/${itemId}`, { method: 'DELETE' }),

  listAttachments: (soId) => apiFetch(`/sales-orders/${soId}/attachments`),
  uploadAttachment: (soId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiFetch(`/sales-orders/${soId}/attachments`, { method: 'POST', body: formData });
  },
  attachmentDownloadUrl: (soId, attachmentId) => `/api/sales-orders/${soId}/attachments/${attachmentId}/download`,
  deleteAttachment: (soId, attachmentId) =>
    apiFetch(`/sales-orders/${soId}/attachments/${attachmentId}`, { method: 'DELETE' }),

  listInvoiceAttachments: (invId) => apiFetch(`/invoices/${invId}/attachments`),
  uploadInvoiceAttachment: (invId, file, docType) => {
    const formData = new FormData();
    formData.append('file', file);
    if (docType) formData.append('doc_type', docType);
    return apiFetch(`/invoices/${invId}/attachments`, { method: 'POST', body: formData });
  },
  invoiceAttachmentDownloadUrl: (invId, attachmentId) => `/api/invoices/${invId}/attachments/${attachmentId}/download`,
  deleteInvoiceAttachment: (invId, attachmentId) =>
    apiFetch(`/invoices/${invId}/attachments/${attachmentId}`, { method: 'DELETE' }),
  acknowledgeInvoicePaymentProof: (invId, attachmentId) =>
    apiFetch(`/invoices/${invId}/attachments/${attachmentId}/acknowledge`, { method: 'POST' }),

  listCorrespondence: (entityType, entityId) =>
    apiFetch(`/correspondence?entity_type=${entityType}&entity_id=${entityId}`),
  addCorrespondence: (entityType, entityId, note) =>
    apiFetch('/correspondence', { method: 'POST', body: JSON.stringify({ entity_type: entityType, entity_id: entityId, note }) }),
  updateCorrespondence: (id, note) =>
    apiFetch(`/correspondence/${id}`, { method: 'PUT', body: JSON.stringify({ note }) }),

  listEmailTemplates: () => apiFetch('/email-templates'),
  getEmailTemplate: (key) => apiFetch(`/email-templates/${key}`),
  updateEmailTemplate: (key, payload) => apiFetch(`/email-templates/${key}`, { method: 'PUT', body: JSON.stringify(payload) }),

  listApprovalLog: (soId) => apiFetch(`/sales-orders/${soId}/approval-log`),
  submitForApproval: (soId, payload) =>
    apiFetch(`/sales-orders/${soId}/submit-for-approval`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  withdrawApproval: (soId, payload) =>
    apiFetch(`/sales-orders/${soId}/withdraw-approval`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  approveSalesOrder: (soId, payload) =>
    apiFetch(`/sales-orders/${soId}/approve`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  rejectSalesOrder: (soId, payload) =>
    apiFetch(`/sales-orders/${soId}/reject`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  voidSalesOrder: (soId, payload) =>
    apiFetch(`/sales-orders/${soId}/void`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  acknowledgeSalesOrderApproval: (soId) => apiFetch(`/sales-orders/${soId}/acknowledge`, { method: 'POST' }),

  listCreditNotes: (params) => apiFetch(`/credit-notes?${new URLSearchParams(params)}`),
  getCreditNote: (id) => apiFetch(`/credit-notes/${id}`),
  requestCreditNote: (payload) => apiFetch('/credit-notes', { method: 'POST', body: JSON.stringify(payload) }),
  updateCreditNote: (id, payload) => apiFetch(`/credit-notes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCreditNote: (id) => apiFetch(`/credit-notes/${id}`, { method: 'DELETE' }),
  approveCreditNote: (id) => apiFetch(`/credit-notes/${id}/approve`, { method: 'PUT' }),
  rejectCreditNote: (id, payload) => apiFetch(`/credit-notes/${id}/reject`, { method: 'PUT', body: JSON.stringify(payload || {}) }),
  confirmCreditNote: (id) => apiFetch(`/credit-notes/${id}/confirm`, { method: 'PUT' }),
  acknowledgeCnConfirm: (id) => apiFetch(`/credit-notes/${id}/acknowledge`, { method: 'POST' }),
  listCnReasonCodes: () => apiFetch('/reference/cn-reason-codes'),

  listContractReductions: (salesOrderId) => apiFetch(`/contract-reductions?sales_order_id=${salesOrderId}`),
  getContractReduction: (id) => apiFetch(`/contract-reductions/${id}`),
  requestContractReduction: (payload) => apiFetch('/contract-reductions', { method: 'POST', body: JSON.stringify(payload) }),
  updateContractReduction: (id, payload) => apiFetch(`/contract-reductions/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteContractReduction: (id) => apiFetch(`/contract-reductions/${id}`, { method: 'DELETE' }),
  approveContractReduction: (id) => apiFetch(`/contract-reductions/${id}/approve`, { method: 'PUT' }),
  rejectContractReduction: (id, payload) => apiFetch(`/contract-reductions/${id}/reject`, { method: 'PUT', body: JSON.stringify(payload || {}) }),
  issueContractReductionCn: (id, payload) => apiFetch(`/contract-reductions/${id}/issue-cn`, { method: 'POST', body: JSON.stringify(payload) }),
  acknowledgeReductionApproval: (id) => apiFetch(`/contract-reductions/${id}/acknowledge`, { method: 'POST' }),
  listCreditNoteAttachments: (id) => apiFetch(`/credit-notes/${id}/attachments`),
  uploadCreditNoteAttachment: (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiFetch(`/credit-notes/${id}/attachments`, { method: 'POST', body: formData });
  },
  creditNoteAttachmentDownloadUrl: (id, attachmentId) => `/api/credit-notes/${id}/attachments/${attachmentId}/download`,
  deleteCreditNoteAttachment: (id, attachmentId) => apiFetch(`/credit-notes/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),

  getSettings: () => apiFetch('/settings'),
  updateSettings: (payload) => apiFetch('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  listTaxCodes: () => apiFetch('/settings/tax-codes'),
  createTaxCode: (payload) =>
    apiFetch('/settings/tax-codes', { method: 'POST', body: JSON.stringify(payload) }),
  updateTaxCode: (id, payload) =>
    apiFetch(`/settings/tax-codes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  listExpenseCodes: () => apiFetch('/settings/expense-codes'),
  createExpenseCode: (payload) =>
    apiFetch('/settings/expense-codes', { method: 'POST', body: JSON.stringify(payload) }),
  updateExpenseCode: (id, payload) =>
    apiFetch(`/settings/expense-codes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  importExpenseCodes: (rows) => apiFetch('/settings/expense-codes/import', { method: 'POST', body: JSON.stringify({ rows }) }),

  listAgentsAdmin: () => apiFetch('/settings/agents'),
  createAgent: (payload) =>
    apiFetch('/settings/agents', { method: 'POST', body: JSON.stringify(payload) }),
  updateAgent: (id, payload) =>
    apiFetch(`/settings/agents/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  listAgentCommissionRates: (agentId) => apiFetch(`/settings/agents/${agentId}/commission-rates`),
  saveAgentCommissionRates: (agentId, rates) =>
    apiFetch(`/settings/agents/${agentId}/commission-rates`, { method: 'PUT', body: JSON.stringify({ rates }) }),
  listAgentCommissionBonusTiers: (agentId) => apiFetch(`/settings/agents/${agentId}/commission-bonus-tiers`),
  saveAgentCommissionBonusTiers: (agentId, bonusTiers) =>
    apiFetch(`/settings/agents/${agentId}/commission-bonus-tiers`, { method: 'PUT', body: JSON.stringify({ bonusTiers }) }),
  importRepeatExhibitors: (rows) => apiFetch('/exhibitors/import-repeat-list', { method: 'POST', body: JSON.stringify({ rows }) }),
  importExhibitors: (rows) => apiFetch('/exhibitors/import', { method: 'POST', body: JSON.stringify({ rows }) }),
  importAgents: (rows) => apiFetch('/settings/agents/import', { method: 'POST', body: JSON.stringify({ rows }) }),

  createSegmentMain: (payload) => apiFetch('/settings/segments/main', { method: 'POST', body: JSON.stringify(payload) }),
  updateSegmentMain: (id, payload) => apiFetch(`/settings/segments/main/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSegmentMain: (id) => apiFetch(`/settings/segments/main/${id}`, { method: 'DELETE' }),
  createSegmentSub: (payload) => apiFetch('/settings/segments/sub', { method: 'POST', body: JSON.stringify(payload) }),
  updateSegmentSub: (id, payload) => apiFetch(`/settings/segments/sub/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSegmentSub: (id) => apiFetch(`/settings/segments/sub/${id}`, { method: 'DELETE' }),
  importSegments: (rows) => apiFetch('/settings/segments/import', { method: 'POST', body: JSON.stringify({ rows }) }),

  getBudget: (eventId) => apiFetch(`/budgets?event_id=${eventId}`),
  createBudget: (eventId) => apiFetch('/budgets', { method: 'POST', body: JSON.stringify({ event_id: eventId }) }),
  addBudgetLine: (budgetId, payload) =>
    apiFetch(`/budgets/${budgetId}/lines`, { method: 'POST', body: JSON.stringify(payload) }),
  updateBudgetLine: (budgetId, lineId, payload) =>
    apiFetch(`/budgets/${budgetId}/lines/${lineId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteBudgetLine: (budgetId, lineId) =>
    apiFetch(`/budgets/${budgetId}/lines/${lineId}`, { method: 'DELETE' }),
  submitBudgetForApproval: (budgetId) => apiFetch(`/budgets/${budgetId}/submit-for-approval`, { method: 'POST' }),
  approveBudget: (budgetId) => apiFetch(`/budgets/${budgetId}/approve`, { method: 'POST' }),
  rejectBudget: (budgetId) => apiFetch(`/budgets/${budgetId}/reject`, { method: 'POST' }),

  listActualExpenseEntries: (eventId, expenseCodeId) =>
    apiFetch(`/budgets/actual-expenses?event_id=${eventId}${expenseCodeId ? `&expense_code_id=${expenseCodeId}` : ''}`),
  createActualExpenseEntry: (payload) =>
    apiFetch('/budgets/actual-expenses', { method: 'POST', body: JSON.stringify(payload) }),
  updateActualExpenseEntry: (id, payload) =>
    apiFetch(`/budgets/actual-expenses/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  listApprovalRules: () => apiFetch('/approval-rules'),
  createApprovalRule: (payload) =>
    apiFetch('/approval-rules', { method: 'POST', body: JSON.stringify(payload) }),
  updateApprovalRule: (id, payload) =>
    apiFetch(`/approval-rules/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteApprovalRule: (id) => apiFetch(`/approval-rules/${id}`, { method: 'DELETE' }),

  listPayments: (invoiceId) => apiFetch(`/payments?invoice_id=${invoiceId}`),
  listPaymentsForExhibitor: (exhibitorId) => apiFetch(`/payments?exhibitor_id=${exhibitorId}`),
  getPayment: (id) => apiFetch(`/payments/${id}`),
  createPayment: (payload) =>
    apiFetch('/payments', { method: 'POST', body: JSON.stringify(payload) }),
  updatePayment: (id, payload) =>
    apiFetch(`/payments/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deletePayment: (id) => apiFetch(`/payments/${id}`, { method: 'DELETE' }),
  addPaymentAllocation: (paymentId, payload) =>
    apiFetch(`/payments/${paymentId}/allocations`, { method: 'POST', body: JSON.stringify(payload) }),
  deletePaymentAllocation: (paymentId, allocationId) =>
    apiFetch(`/payments/${paymentId}/allocations/${allocationId}`, { method: 'DELETE' }),
  acknowledgePaymentAllocation: (allocationId) =>
    apiFetch(`/payments/allocations/${allocationId}/acknowledge`, { method: 'POST' }),

  getCustomerAging: (eventId) => apiFetch(`/reports/customer-aging?event_id=${eventId}`),
  getCustomerAgingByContract: (eventId) => apiFetch(`/reports/customer-aging-by-contract?event_id=${eventId}`),
  getStatementOfAccount: (exhibitorId) => apiFetch(`/reports/statement-of-account?exhibitor_id=${exhibitorId}`),
  getDashboard: (eventId) => apiFetch(`/reports/dashboard?event_id=${eventId}`),
  getTasks: (eventId) => apiFetch(`/reports/tasks?event_id=${eventId}`),

  getPerfOverview: (eventId) => apiFetch(`/reports/performance/overview?event_id=${eventId}`),
  getPerfBySalesperson: (eventId) => apiFetch(`/reports/performance/by-salesperson?event_id=${eventId}`),
  getPerfByAgent: (eventId) => apiFetch(`/reports/performance/by-agent?event_id=${eventId}`),
  getPerfByItem: (eventId) => apiFetch(`/reports/performance/by-item?event_id=${eventId}`),
  getPerfPipeline: (eventId) => apiFetch(`/reports/performance/pipeline?event_id=${eventId}`),
  getPerfByCountry: (eventId) => apiFetch(`/reports/performance/by-country?event_id=${eventId}`),
  getPerfByMonth: (eventId) => apiFetch(`/reports/performance/by-month?event_id=${eventId}`),
  getAgentCommission: (eventId) => apiFetch(`/reports/performance/agent-commission?event_id=${eventId}`),
  getPerfComparison: (eventId, compareEventId) =>
    apiFetch(`/reports/performance/comparison?event_id=${eventId}${compareEventId ? `&compare_event_id=${compareEventId}` : ''}`),
  getSalesTargets: (eventId) => apiFetch(`/reports/performance/targets?event_id=${eventId}`),
  saveSalesTargets: (payload) =>
    apiFetch('/reports/performance/targets', { method: 'PUT', body: JSON.stringify(payload) }),

  adminListUsers: () => apiFetch('/admin/users'),
  adminCreateUser: (payload) =>
    apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  adminImportUsers: (rows) => apiFetch('/admin/users/import', { method: 'POST', body: JSON.stringify({ rows }) }),
  sendUserInviteEmail: (user) => apiFetch('/admin/users/send-invite-email', { method: 'POST', body: JSON.stringify(user) }),
  adminUpdateUser: (id, payload) =>
    apiFetch(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminResetPassword: (id, payload) =>
    apiFetch(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify(payload) }),
  adminSetUserEvents: (id, payload) =>
    apiFetch(`/admin/users/${id}/events`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminSetUserRoles: (id, roleIds) =>
    apiFetch(`/admin/users/${id}/roles`, { method: 'PUT', body: JSON.stringify({ role_ids: roleIds }) }),

  listPriceList: (eventId) => apiFetch(`/price-list?event_id=${eventId}`),
  createPriceItem: (payload) =>
    apiFetch('/price-list', { method: 'POST', body: JSON.stringify(payload) }),
  updatePriceItem: (id, payload) =>
    apiFetch(`/price-list/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deletePriceItem: (id) => apiFetch(`/price-list/${id}`, { method: 'DELETE' }),
  listCreditTerms: (eventId) => apiFetch(`/credit-terms?event_id=${eventId}`),
  createCreditTerm: (payload) =>
    apiFetch('/credit-terms', { method: 'POST', body: JSON.stringify(payload) }),
  updateCreditTerm: (id, payload) =>
    apiFetch(`/credit-terms/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCreditTerm: (id) => apiFetch(`/credit-terms/${id}`, { method: 'DELETE' }),
  resolveCreditTermForContract: (salesOrderId) => apiFetch(`/credit-terms/resolve/${salesOrderId}`),
  adminListRoles: () => apiFetch('/admin/roles'),
  adminCreateRole: (payload) => apiFetch('/admin/roles', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateRole: (id, payload) => apiFetch(`/admin/roles/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminDeleteRole: (id) => apiFetch(`/admin/roles/${id}`, { method: 'DELETE' }),
  adminListEvents: () => apiFetch('/admin/events'),
  adminCreateEvent: (payload) =>
    apiFetch('/admin/events', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateEvent: (id, payload) =>
    apiFetch(`/admin/events/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  archiveRecord: (type, id, reason) =>
    apiFetch(`/admin/archive/${type}/${id}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  restoreRecord: (type, id) =>
    apiFetch(`/admin/archive/${type}/${id}/restore`, { method: 'POST' }),
  listArchivedRecords: (type) => apiFetch(`/admin/archive/${type}`),

  listFloorPlanHalls: (eventId) => apiFetch(`/floor-plan/halls?event_id=${eventId}`),
  createFloorPlanHall: (payload) =>
    apiFetch('/floor-plan/halls', { method: 'POST', body: JSON.stringify(payload) }),
  deleteFloorPlanHall: (id) => apiFetch(`/floor-plan/halls/${id}`, { method: 'DELETE' }),
  uploadFloorPlanHallImage: (id, file) => {
    const formData = new FormData();
    formData.append('image', file);
    return apiFetch(`/floor-plan/halls/${id}/image`, { method: 'POST', body: formData });
  },
  floorPlanHallImageUrl: (id) => `/api/floor-plan/halls/${id}/image`,
  listFloorPlanBooths: (hallId) => apiFetch(`/floor-plan/halls/${hallId}/booths`),
  createFloorPlanBooth: (hallId, payload) =>
    apiFetch(`/floor-plan/halls/${hallId}/booths`, { method: 'POST', body: JSON.stringify(payload) }),
  bulkGenerateFloorPlanBooths: (hallId, payload) =>
    apiFetch(`/floor-plan/halls/${hallId}/booths/bulk-generate`, { method: 'POST', body: JSON.stringify(payload) }),
  autoDetectFloorPlanBooths: (hallId) =>
    apiFetch(`/floor-plan/halls/${hallId}/booths/auto-detect`, { method: 'POST', body: JSON.stringify({}) }),
  updateFloorPlanBooth: (hallId, boothId, payload) =>
    apiFetch(`/floor-plan/halls/${hallId}/booths/${boothId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  bulkUpdateFloorPlanBooths: (hallId, payload) =>
    apiFetch(`/floor-plan/halls/${hallId}/booths/bulk-update`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteFloorPlanBooth: (hallId, boothId) =>
    apiFetch(`/floor-plan/halls/${hallId}/booths/${boothId}`, { method: 'DELETE' }),

  listSalesOrderBooths: (soId) => apiFetch(`/sales-orders/${soId}/booths`),
  bulkSetSalesOrderBooths: (soId, payload) =>
    apiFetch(`/sales-orders/${soId}/booths`, { method: 'PUT', body: JSON.stringify(payload) }),
  acknowledgeSalesOrderBoothLoss: (soId) => apiFetch(`/sales-orders/${soId}/acknowledge-booth-loss`, { method: 'POST' }),
  listOpportunityBooths: (oppId) => apiFetch(`/opportunities/${oppId}/booths`),
  bulkSetOpportunityBooths: (oppId, payload) =>
    apiFetch(`/opportunities/${oppId}/booths`, { method: 'PUT', body: JSON.stringify(payload) }),
  acknowledgeOpportunityBoothLoss: (oppId) => apiFetch(`/opportunities/${oppId}/acknowledge-booth-loss`, { method: 'POST' }),

  listTableViews: (screen) => apiFetch(`/table-views?screen=${screen}`),
  createTableView: (payload) =>
    apiFetch('/table-views', { method: 'POST', body: JSON.stringify(payload) }),
  updateTableView: (id, payload) =>
    apiFetch(`/table-views/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteTableView: (id) => apiFetch(`/table-views/${id}`, { method: 'DELETE' }),
};
