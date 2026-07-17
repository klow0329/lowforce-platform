// Small fetch wrapper. `credentials: 'include'` is what lets the browser
// send/receive the session cookie that keeps a user logged in.
async function apiFetch(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
  createInvoice: (payload) =>
    apiFetch('/invoices', { method: 'POST', body: JSON.stringify(payload) }),
  updateInvoice: (id, payload) =>
    apiFetch(`/invoices/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

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
};
