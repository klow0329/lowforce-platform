import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';

// The logged-in user's own company record (name, branding flags) — shared
// so the nav bar's tenant logo stays in sync the moment Admin uploads or
// removes one, instead of only refreshing on a full page reload. Before
// this existed, App.jsx fetched company data once on login and never
// again, so deleting a logo in Admin > Company Profile left the nav bar
// showing the old one until the next hard refresh.
const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    return api.getCompany().then(({ company }) => setCompany(company));
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <CompanyContext.Provider value={{ company, loading, refresh }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompanyContext() {
  return useContext(CompanyContext);
}
