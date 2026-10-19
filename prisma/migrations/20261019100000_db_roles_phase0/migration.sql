-- RLS fase 0 (docs/SECURITY-AUDIT-DELTA.md): mindste rettigheder for app-rollerne fra prisma/roles.sql.
-- Kører som ejeren (abu_owner), efter at Prisma har oprettet "_prisma_migrations", og tabellerne findes. Standard-
-- rettighederne (ALTER DEFAULT PRIVILEGES) giver ellers app-rollerne DML på alle nye tabeller, også disse to.
-- Ingen ændring af skemaet. No-op, hvis rollerne ikke findes (fx en lokal opsætning med én rolle).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['abu_app', 'abu_jobs'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- Migrationshistorikken er kun for ejeren (ellers kunne appen markere en sikkerhedsmigration som kørt)
      EXECUTE format('REVOKE ALL ON TABLE "_prisma_migrations" FROM %I', r);
      -- Audit-loggen er append-only for appen (L-3): læse og tilføje, aldrig ændre eller slette
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
