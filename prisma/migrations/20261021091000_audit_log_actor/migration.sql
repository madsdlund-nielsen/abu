-- =============================================================================================================
-- M-2 (docs/SECURITY-AUDIT-MFA-RLS.md): en indlogget bruger kan kun logge sine egne handlinger. "userId" IS NULL
-- (systemhændelser: webhooks, jobs, afmelding uden konto) er forbeholdt systemkonteksten, så en bruger ikke kan
-- indsætte rækker, der ligner systemets. Appen sender altid aktøren (src/lib/audit.ts).
-- =============================================================================================================
DROP POLICY IF EXISTS audit_log_insert ON "AuditLog";
CREATE POLICY audit_log_insert ON "AuditLog" FOR INSERT
  WITH CHECK (rls.app_is_system()
              OR (rls.app_role() IN ('ADMIN', 'ADVISOR', 'CUSTOMER') AND "userId" = rls.app_user_id()));
COMMENT ON POLICY audit_log_insert ON "AuditLog" IS 'Append-only (UPDATE/DELETE er taget fra app-rollerne i fase 0): en indlogget bruger logger kun egne handlinger ("userId" = brugeren selv); rækker uden bruger kun i systemkontekst. Ingen UPDATE/DELETE-politik.';
