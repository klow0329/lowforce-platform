import { useNavigate, useParams } from 'react-router-dom';
import PerfOverview from './reports/PerfOverview';
import PerfBySalesperson from './reports/PerfBySalesperson';
import PerfByAgent from './reports/PerfByAgent';
import PerfByItem from './reports/PerfByItem';
import PerfByCountry from './reports/PerfByCountry';
import PerfBoothSpace from './reports/PerfBoothSpace';
import PerfByMonth from './reports/PerfByMonth';
import PerfPipeline from './reports/PerfPipeline';
import PerfComparison from './reports/PerfComparison';
import AgentCommission from './reports/AgentCommission';
import CustomerAging from './CustomerAging';
import ContractAging from './ContractAging';

// One Reports module with a visible sub-menu (no dropdown chains) — the
// pattern Salesforce/HubSpot converge on: users learn what exists by seeing
// the list, and each report is one click away.
const SECTIONS = [
  { key: 'overview', label: 'Overview', Component: PerfOverview },
  { key: 'salesperson', label: 'By Salesperson', Component: PerfBySalesperson },
  { key: 'agent', label: 'Agent Analysis', Component: PerfByAgent },
  { key: 'items', label: 'By Item & Type', Component: PerfByItem },
  { key: 'country', label: 'By Country', Component: PerfByCountry },
  { key: 'booth-space', label: 'Booth & Space', Component: PerfBoothSpace },
  { key: 'monthly', label: 'By Month', Component: PerfByMonth },
  { key: 'pipeline', label: 'Pipeline', Component: PerfPipeline },
  { key: 'comparison', label: 'Comparison', Component: PerfComparison },
  { key: 'agent-commission', label: 'Agent Commission', Component: AgentCommission },
  { key: 'aging', label: 'Customer Aging', Component: CustomerAging },
  { key: 'aging-by-contract', label: 'Aging by Contract', Component: ContractAging },
];

export default function Reports({ user }) {
  const { section } = useParams();
  const navigate = useNavigate();
  const active = SECTIONS.find((s) => s.key === section) || SECTIONS[0];
  const { Component } = active;

  return (
    <div className="page" style={{ maxWidth: 1200, margin: '0 auto 24px' }}>
      <div className="report-layout">
        <nav className="report-menu no-print">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={s.key === active.key ? 'active' : ''}
              onClick={() => navigate(`/reports/${s.key}`)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="report-content">
          <Component user={user} embedded />
        </div>
      </div>
    </div>
  );
}
