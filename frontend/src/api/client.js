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
  if (!res.ok) throw new Error(data.error || 'Request failed');
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

  listApprovalLog: (soId) => apiFetch(`/sales-orders/${soId}/approval-log`),
  submitForApproval: (soId, payload) =>
    apiFetch(`/sales-orders/${soId}/submit-for-approval`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  approveSalesOrder: (soId, payload) =>
    apiFetch(`/sales-orders/${soId}/approve`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  rejectSalesOrder: (soId, payload) =>
    apiFetch(`/sales-orders/${soId}/reject`, { method: 'POST', body: JSON.stringify(payload || {}) }),

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
  addPaymentAllocation: (paymentId, payload) =>
    apiFetch(`/payments/${paymentId}/allocations`, { method: 'POST', body: JSON.stringify(payload) }),
  deletePaymentAllocation: (paymentId, allocationId) =>
    apiFetch(`/payments/${paymentId}/allocations/${allocationId}`, { method: 'DELETE' }),
  acknowledgePaymentAllocation: (allocationId) =>
    apiFetch(`/payments/allocations/${allocationId}/acknowledge`, { method: 'POST' }),

  getCustomerAging: (eventId) => apiFetch(`/reports/customer-aging?event_id=${eventId}`),
  getStatementOfAccount: (exhibitorId) => apiFetch(`/reports/statement-of-account?exhibitor_id=${exhibitorId}`),
  getDashboard: (eventId) => apiFetch(`/reports/dashboard?event_id=${eventId}`),
  getTasks: (eventId) => apiFetch(`/reports/tasks?event_id=${eventId}`),

  getPerfOverview: (eventId) => apiFetch(`/reports/performance/overview?event_id=${eventId}`),
  getPerfBySalesperson: (eventId) => apiFetch(`/reports/performance/by-salesperson?event_id=${eventId}`),
  getPerfByItem: (eventId) => apiFetch(`/reports/performance/by-item?event_id=${eventId}`),
  getPerfPipeline: (eventId) => apiFetch(`/reports/performance/pipeline?event_id=${eventId}`),
  getPerfByCountry: (eventId) => apiFetch(`/reports/performance/by-country?event_id=${eventId}`),
  getPerfByMonth: (eventId) => apiFetch(`/reports/performance/by-month?event_id=${eventId}`),
  getPerfComparison: (eventId, compareEventId) =>
    apiFetch(`/reports/performance/comparison?event_id=${eventId}${compareEventId ? `&compare_event_id=${compareEventId}` : ''}`),
  getSalesTargets: (eventId) => apiFetch(`/reports/performance/targets?event_id=${eventId}`),
  saveSalesTargets: (payload) =>
    apiFetch('/reports/performance/targets', { method: 'PUT', body: JSON.stringify(payload) }),

  adminListUsers: () => apiFetch('/admin/users'),
  adminCreateUser: (payload) =>
    apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
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
  adminListRoles: () => apiFetch('/admin/roles'),
  adminListEvents: () => apiFetch('/admin/events'),
  adminCreateEvent: (payload) =>
    apiFetch('/admin/events', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateEvent: (id, payload) =>
    apiFetch(`/admin/events/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

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
  deleteFloorPlanBooth: (hallId, boothId) =>
    apiFetch(`/floor-plan/halls/${hallId}/booths/${boothId}`, { method: 'DELETE' }),

  listTableViews: (screen) => apiFetch(`/table-views?screen=${screen}`),
  createTableView: (payload) =>
    apiFetch('/table-views', { method: 'POST', body: JSON.stringify(payload) }),
  updateTableView: (id, payload) =>
    apiFetch(`/table-views/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteTableView: (id) => apiFetch(`/table-views/${id}`, { method: 'DELETE' }),
};
