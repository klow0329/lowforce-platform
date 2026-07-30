-- deleteCreditNote / deleteContractReduction (withdraw-while-pending) both
-- hard-DELETE the request row after logging a WITHDRAWN entry, but the
-- original REQUESTED approval_log row (inserted at request-creation time)
-- still points at that row's id via a plain FK, so the DELETE always failed
-- with a foreign key violation. Switch both FKs to ON DELETE SET NULL —
-- the approval_log row (and its descriptive notes text) survives as the
-- permanent audit record, it just stops pointing at a request that no
-- longer exists, same as the WITHDRAWN insert itself already does.
ALTER TABLE approval_log DROP CONSTRAINT approval_log_credit_note_id_fkey;
ALTER TABLE approval_log ADD CONSTRAINT approval_log_credit_note_id_fkey
  FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE SET NULL;

ALTER TABLE approval_log DROP CONSTRAINT approval_log_contract_reduction_id_fkey;
ALTER TABLE approval_log ADD CONSTRAINT approval_log_contract_reduction_id_fkey
  FOREIGN KEY (contract_reduction_id) REFERENCES contract_reductions(id) ON DELETE SET NULL;
