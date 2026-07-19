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
  login: (email, password) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),
  me: () => apiFetch('/auth/me'),
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

  listApprovalRules: () => apiFetch('/approval-rules'),
  createApprovalRule: (payload) =>
    apiFetch('/approval-rules', { method: 'POST', body: JSON.stringify(payload) }),
  updateApprovalRule: (id, payload) =>
    apiFetch(`/approval-rules/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteApprovalRule: (id) => apiFetch(`/approval-rules/${id}`, { method: 'DELETE' }),

  listPayments: (invoiceId) => apiFetch(`/payments?invoice_id=${invoiceId}`),
  getPayment: (id) => apiFetch(`/payments/${id}`),
  createPayment: (payload) =>
    apiFetch('/payments', { method: 'POST', body: JSON.stringify(payload) }),
  updatePayment: (id, payload) =>
    apiFetch(`/payments/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  getCustomerAging: (eventId) => apiFetch(`/reports/customer-aging?event_id=${eventId}`),
  getDashboard: (eventId) => apiFetch(`/reports/dashboard?event_id=${eventId}`),

  adminListUsers: () => apiFetch('/admin/users'),
  adminCreateUser: (payload) =>
    apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateUser: (id, payload) =>
    apiFetch(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminResetPassword: (id, payload) =>
    apiFetch(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify(payload) }),
  adminSetUserEvents: (id, payload) =>
    apiFetch(`/admin/users/${id}/events`, { method: 'PUT', body: JSON.stringify(payload) }),

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

  listTableViews: (screen) => apiFetch(`/table-views?screen=${screen}`),
  createTableView: (payload) =>
    apiFetch('/table-views', { method: 'POST', body: JSON.stringify(payload) }),
  updateTableView: (id, payload) =>
    apiFetch(`/table-views/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteTableView: (id) => apiFetch(`/table-views/${id}`, { method: 'DELETE' }),
};
