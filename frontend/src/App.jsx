import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import Login from './pages/Login';
import ExhibitorsList from './pages/ExhibitorsList';
import ExhibitorDetail from './pages/ExhibitorDetail';
import OpportunitiesList from './pages/OpportunitiesList';
import OpportunityDetail from './pages/OpportunityDetail';
import SalesOrdersList from './pages/SalesOrdersList';
import SalesOrderDetail from './pages/SalesOrderDetail';
import ContractPrint from './pages/ContractPrint';
import ProformaPrint from './pages/ProformaPrint';
import InvoicesList from './pages/InvoicesList';
import InvoiceDetail from './pages/InvoiceDetail';
import InvoicePrint from './pages/InvoicePrint';
import PaymentDetail from './pages/PaymentDetail';
import ReceiptPrint from './pages/ReceiptPrint';
import CustomerAging from './pages/CustomerAging';
import Dashboard from './pages/Dashboard';
import ChangePassword from './pages/ChangePassword';
import Admin from './pages/Admin';
import PriceList from './pages/PriceList';
import NavBar from './components/NavBar';
import { EventProvider } from './context/EventContext';
import { api } from './api/client';

// Forces the detail pages to fully remount when navigating between two
// different record ids (e.g. new -> the just-created record) — without
// this, React Router reuses the same component instance and stale state
// (like the "saving" flag) carries over.
function ExhibitorDetailRoute() {
  const { id } = useParams();
  return <ExhibitorDetail key={id || 'new'} />;
}

function OpportunityDetailRoute() {
  const { id } = useParams();
  return <OpportunityDetail key={id || 'new'} />;
}

function SalesOrderDetailRoute({ user }) {
  const { id } = useParams();
  return <SalesOrderDetail key={id || 'new'} user={user} />;
}

function InvoiceDetailRoute() {
  const { id } = useParams();
  return <InvoiceDetail key={id} />;
}

function PaymentDetailRoute() {
  const { id } = useParams();
  return <PaymentDetail key={id || 'new'} />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // The backend session is cookie-based and outlives a page reload, but the
  // React state doesn't — without this, every refresh looks logged-out even
  // though the session cookie is still valid.
  useEffect(() => {
    api.me().then(({ user }) => setUser(user)).finally(() => setCheckingSession(false));
  }, []);

  if (checkingSession) return null;

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
  };

  return (
    <BrowserRouter>
      <EventProvider>
        <NavBar user={user} onLogout={handleLogout} />
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/exhibitors" element={<ExhibitorsList />} />
          <Route path="/exhibitors/new" element={<ExhibitorDetailRoute />} />
          <Route path="/exhibitors/:id" element={<ExhibitorDetailRoute />} />
          <Route path="/opportunities" element={<OpportunitiesList user={user} />} />
          <Route path="/opportunities/new" element={<OpportunityDetailRoute />} />
          <Route path="/opportunities/:id" element={<OpportunityDetailRoute />} />
          <Route path="/sales-orders" element={<SalesOrdersList />} />
          <Route path="/sales-orders/new" element={<SalesOrderDetailRoute user={user} />} />
          <Route path="/sales-orders/:id" element={<SalesOrderDetailRoute user={user} />} />
          <Route path="/sales-orders/:id/print" element={<ContractPrint />} />
          <Route path="/sales-orders/:id/proforma" element={<ProformaPrint />} />
          <Route path="/invoices" element={<InvoicesList />} />
          <Route path="/invoices/:id" element={<InvoiceDetailRoute />} />
          <Route path="/invoices/:id/print" element={<InvoicePrint />} />
          <Route path="/payments/new" element={<PaymentDetailRoute />} />
          <Route path="/payments/:id" element={<PaymentDetailRoute />} />
          <Route path="/payments/:id/print" element={<ReceiptPrint />} />
          <Route path="/customer-aging" element={<CustomerAging />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/price-list" element={<PriceList user={user} />} />
          <Route
            path="/admin"
            element={user.role_code === 'ADM' ? <Admin user={user} /> : <Navigate to="/dashboard" replace />}
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </EventProvider>
    </BrowserRouter>
  );
}
