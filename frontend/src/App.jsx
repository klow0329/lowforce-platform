import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import Login from './pages/Login';
import ExhibitorsList from './pages/ExhibitorsList';
import AgentsList from './pages/AgentsList';
import ExhibitorDetail from './pages/ExhibitorDetail';
import OpportunitiesList from './pages/OpportunitiesList';
import OpportunityDetail from './pages/OpportunityDetail';
import SalesOrdersList from './pages/SalesOrdersList';
import SalesOrderDetail from './pages/SalesOrderDetail';
import ContractPrint from './pages/ContractPrint';
import ProformaPrint from './pages/ProformaPrint';
import ProposalPrint from './pages/ProposalPrint';
import InvoicesList from './pages/InvoicesList';
import InvoiceDetail from './pages/InvoiceDetail';
import InvoicePrint from './pages/InvoicePrint';
import PaymentDetail from './pages/PaymentDetail';
import ReceiptPrint from './pages/ReceiptPrint';
import CreditNotePrint from './pages/CreditNotePrint';
import CreditNoteDetail from './pages/CreditNoteDetail';
import Reports from './pages/Reports';
import Dashboard from './pages/Dashboard';
import ChangePassword from './pages/ChangePassword';
import Admin from './pages/Admin';
import PriceList from './pages/PriceList';
import FloorPlan from './pages/FloorPlan';
import Management from './pages/Management';
import Budget from './pages/Budget';
import StatementPrint from './pages/StatementPrint';
import TaxDetailForm from './pages/TaxDetailForm';
import About from './pages/About';
import NavBar from './components/NavBar';
import ErrorBoundary from './components/ErrorBoundary';
import { EventProvider } from './context/EventContext';
import { api } from './api/client';
import { isViewOnly } from './utils/permissions';

// Forces the detail pages to fully remount when navigating between two
// different record ids (e.g. new -> the just-created record) — without
// this, React Router reuses the same component instance and stale state
// (like the "saving" flag) carries over.
function ExhibitorDetailRoute({ user }) {
  const { id } = useParams();
  return <ExhibitorDetail key={id || 'new'} user={user} />;
}

function OpportunityDetailRoute({ user }) {
  const { id } = useParams();
  return <OpportunityDetail key={id || 'new'} user={user} />;
}

function SalesOrderDetailRoute({ user }) {
  const { id } = useParams();
  return <SalesOrderDetail key={id || 'new'} user={user} />;
}

function InvoiceDetailRoute({ user }) {
  const { id } = useParams();
  return <InvoiceDetail key={id} user={user} />;
}

function PaymentDetailRoute({ user }) {
  const { id } = useParams();
  return <PaymentDetail key={id || 'new'} user={user} />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [checkingSession, setCheckingSession] = useState(true);
  const [company, setCompany] = useState(null);

  // The backend session is cookie-based and outlives a page reload, but the
  // React state doesn't — without this, every refresh looks logged-out even
  // though the session cookie is still valid.
  useEffect(() => {
    api.me().then(({ user, availableRoles }) => {
      setUser(user);
      setAvailableRoles(availableRoles || []);
      // Nav bar logo must be this tenant's own branding (or the neutral
      // platform default), never a baked-in reference customer's — see
      // BrandLogo's fallback in CompanyBranding.jsx.
      api.getCompany().then(({ company }) => setCompany(company));
    }).finally(() => setCheckingSession(false));
  }, []);

  // Reached only via a one-time link sent to an exhibitor who has no
  // LowForce account — must bypass the login gate entirely, checked before
  // it (and before the session lookup even matters).
  if (window.location.pathname.startsWith('/tax-details/')) {
    return <TaxDetailForm />;
  }

  if (checkingSession) return null;

  if (!user) {
    return <Login onLoggedIn={(u, roles) => { setUser(u); setAvailableRoles(roles || []); }} />;
  }

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setAvailableRoles([]);
  };

  // Switching "acting as" role changes req.roleCode server-side for every
  // subsequent request in this session — every role-gated check already in
  // the app (isElevated, CAN_CONFIRM_ROLES, the Admin nav link, etc.) reads
  // off user.role_code, so updating it here is all that's needed to cascade
  // through the whole UI.
  const handleSwitchRole = async (roleCode) => {
    const { user: updated } = await api.switchRole(roleCode);
    setUser(updated);
  };

  return (
    <BrowserRouter>
      <EventProvider>
        <NavBar user={user} company={company} onLogout={handleLogout} availableRoles={availableRoles} onSwitchRole={handleSwitchRole} />
        {/* A bug on any one page (React 18 otherwise unmounts the whole app
            to a blank white screen on an uncaught render error, with no way
            back except a hard refresh) is contained here instead — the nav
            bar above stays usable, and "Close and Return" does a full
            reload to a known-good page rather than trusting router state
            that may have been mid-crash. */}
        <ErrorBoundary label="This page" onReset={() => { window.location.href = '/dashboard'; }}>
        <Routes>
          {/* Management's landing page IS the Management Overview — no
              separate screen duplicating the same underlying data. */}
          <Route path="/dashboard" element={['ADM', 'MGT'].includes(user.role_code) ? <Management user={user} /> : <Dashboard />} />
          <Route path="/exhibitors" element={<ExhibitorsList user={user} />} />
          <Route path="/agents" element={<AgentsList user={user} />} />
          <Route path="/exhibitors/new" element={<ExhibitorDetailRoute user={user} />} />
          <Route path="/exhibitors/:id" element={<ExhibitorDetailRoute user={user} />} />
          <Route path="/exhibitors/:id/statement" element={<StatementPrint />} />
          <Route path="/opportunities" element={<OpportunitiesList user={user} />} />
          <Route
            path="/opportunities/new"
            element={isViewOnly(user) ? <Navigate to="/opportunities" replace /> : <OpportunityDetailRoute user={user} />}
          />
          <Route path="/opportunities/:id" element={<OpportunityDetailRoute user={user} />} />
          <Route path="/opportunities/:id/proposal" element={<ProposalPrint />} />
          <Route path="/sales-orders" element={<SalesOrdersList />} />
          <Route
            path="/sales-orders/new"
            element={isViewOnly(user) ? <Navigate to="/sales-orders" replace /> : <SalesOrderDetailRoute user={user} />}
          />
          <Route path="/sales-orders/:id" element={<SalesOrderDetailRoute user={user} />} />
          <Route path="/sales-orders/:id/print" element={<ContractPrint />} />
          <Route path="/sales-orders/:id/proforma" element={<ProformaPrint />} />
          <Route path="/invoices" element={<InvoicesList />} />
          <Route path="/invoices/:id" element={<InvoiceDetailRoute user={user} />} />
          <Route path="/invoices/:id/print" element={<InvoicePrint />} />
          <Route path="/payments/new" element={<PaymentDetailRoute user={user} />} />
          <Route path="/payments/:id" element={<PaymentDetailRoute user={user} />} />
          <Route path="/payments/:id/print" element={<ReceiptPrint />} />
          <Route path="/credit-notes/:id" element={<CreditNoteDetail user={user} />} />
          <Route path="/credit-notes/:id/print" element={<CreditNotePrint />} />
          <Route path="/reports" element={<Reports user={user} />} />
          <Route path="/reports/:section" element={<Reports user={user} />} />
          {/* Old bookmark/tile links keep working — Aging now lives under Reports */}
          <Route path="/customer-aging" element={<Navigate to="/reports/aging" replace />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/about" element={<About />} />
          <Route path="/price-list" element={<PriceList user={user} />} />
          <Route path="/floor-plan" element={<FloorPlan user={user} />} />
          <Route
            path="/budget"
            element={['ADM', 'MGT', 'FIN'].includes(user.role_code) ? <Budget user={user} /> : <Navigate to="/dashboard" replace />}
          />
          <Route
            path="/admin"
            element={user.role_code === 'ADM' ? <Admin user={user} /> : <Navigate to="/dashboard" replace />}
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </ErrorBoundary>
      </EventProvider>
    </BrowserRouter>
  );
}
