-- Security hardening.
-- The audit trail is append-only at the database level (like the ledger): even a compromised API process or a SQL-injection
-- bug cannot rewrite or delete history through UPDATE/DELETE statements. Retention/archival must be done by a DBA role that
-- disables the trigger deliberately.
CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();
