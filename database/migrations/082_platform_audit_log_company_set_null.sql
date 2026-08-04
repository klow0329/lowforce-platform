-- deleteCompany (platform.controller.js) is only ever used on a company
-- that was never actually provisioned (0 users/events/exhibitors) — but it
-- still generates its own platform_audit_log trail (COMPANY_CREATE, any
-- group reassignment, etc.), and that FK had no ON DELETE clause, so the
-- delete itself failed with a constraint violation the moment there was
-- any history at all (caught live: deleting "Company 2" right after
-- unlinking it from a group).
--
-- The right fix is ON DELETE SET NULL, not deleting the audit rows: each
-- row's own `details` JSON already captured the company's name at the time
-- of the action, so the history stays meaningful even once company_id goes
-- null — losing that trail the moment a company is removed would defeat
-- the point of an operator audit log.
ALTER TABLE platform_audit_log DROP CONSTRAINT platform_audit_log_company_id_fkey;
ALTER TABLE platform_audit_log ADD CONSTRAINT platform_audit_log_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
