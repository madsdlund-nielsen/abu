-- =============================================================================================================
-- Advisory Board Unlimited – databaseroller og rettigheder (RLS fase 0, docs/SECURITY-AUDIT-DELTA.md).
--
-- Idempotent: kan køres igen når som helst (fx efter skift af adgangskode eller på en eksisterende database).
-- Ren SQL (ingen psql-kommandoer), så begge kørere nedenfor bruger samme fil.
-- Køres af en superbruger mod den database, appen bruger:
--   * npm run db:roles                     (DATABASE_URL_PROVISION + ABU_*_PASSWORD; scripts/db-roles.ts)
--   * docker/postgres/initdb/10-abu-roles.sh (automatisk ved første start af compose-Postgres; docker compose run --rm db-roles)
--
-- Roller (klyngeglobale; rettigheder sættes pr. database):
--   abu_owner  ejer databasen, schema public og alle tabeller. Bruges KUN af migrationer, seed og create-admin.
--   abu_app    appen: LOGIN, ingen superbruger/BYPASSRLS/CREATEROLE/CREATEDB, ikke ejer, intet medlemskab.
--              Kun SELECT/INSERT/UPDATE/DELETE på tabellerne + USAGE på sekvenser. Ingen DDL, ingen TRUNCATE.
--              AuditLog er append-only (SELECT/INSERT), og _prisma_migrations er helt lukket.
--   abu_jobs   som abu_app, men med længere timeouts. Forberedt til fase 1 (system-/cron-kontekst); appen bruger den ikke endnu.
--
-- Adgangskoder står ALDRIG i repoet. De sendes ind som sessionsvariablerne abu.owner_password, abu.app_password og
-- abu.jobs_password (klartekst eller en SCRAM-SHA-256-verifikator). Tom = adgangskoden ændres ikke.
-- =============================================================================================================

DO $roles$
DECLARE
  r record;
  pw text;
BEGIN
  -- 1. Roller og attributter -----------------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'abu_owner') THEN
    CREATE ROLE abu_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  -- CREATEDB røres ikke (lokalt kan `prisma migrate dev` kræve det til skyggedatabasen); resten låses fast
  ALTER ROLE abu_owner WITH LOGIN NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS;

  FOREACH pw IN ARRAY ARRAY['abu_app', 'abu_jobs'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = pw) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', pw);
    END IF;
    EXECUTE format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', pw);
  END LOOP;

  -- 2. Adgangskoder fra sessionsvariabler (aldrig i filen) -------------------------------------------------------
  FOR r IN SELECT * FROM (VALUES ('abu_owner', 'abu.owner_password'), ('abu_app', 'abu.app_password'), ('abu_jobs', 'abu.jobs_password')) AS v(role, setting) LOOP
    pw := coalesce(current_setting(r.setting, true), '');
    IF pw <> '' THEN
      EXECUTE format('ALTER ROLE %I PASSWORD %L', r.role, pw);
    END IF;
  END LOOP;

  -- 3. Ingen medlemskaber for app-rollerne: de må ikke kunne SET ROLE abu_owner eller arve fx pg_read_all_data ---
  FOR r IN SELECT m.roleid::regrole AS granted, m.member::regrole AS member, m.grantor::regrole AS grantor
             FROM pg_auth_members m WHERE m.member IN ('abu_app'::regrole, 'abu_jobs'::regrole) LOOP
    EXECUTE format('REVOKE %s FROM %s GRANTED BY %s', r.granted, r.member, r.grantor);
  END LOOP;

  -- 4. Timeouts på rollerne (gælder for alle klienter, også psql) -------------------------------------------------
  ALTER ROLE abu_app SET statement_timeout = '15s';
  ALTER ROLE abu_app SET lock_timeout = '10s';
  ALTER ROLE abu_app SET idle_in_transaction_session_timeout = '30s';
  -- Fase 1: system-/cronjobs, der legitimt kører længere (fx oprydning i store tabeller)
  ALTER ROLE abu_jobs SET statement_timeout = '5min';
  ALTER ROLE abu_jobs SET lock_timeout = '30s';
  ALTER ROLE abu_jobs SET idle_in_transaction_session_timeout = '5min';
END
$roles$;

-- 5. Databasen og schema public ejes af abu_owner; PUBLIC får intet ------------------------------------------------
DO $db$
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO abu_owner', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM abu_app, abu_jobs', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO abu_app, abu_jobs', current_database());
END
$db$;

ALTER SCHEMA public OWNER TO abu_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM abu_app, abu_jobs;
GRANT USAGE ON SCHEMA public TO abu_app, abu_jobs;

-- 6. Eksisterende objekter i public overdrages til abu_owner (fx fra en ældre opsætning med én rolle) ---------------
DO $own$
DECLARE
  r record;
BEGIN
  -- Tabeller, views m.m. (sekvenser bundet til en kolonne følger tabellen)
  FOR r IN SELECT c.oid::regclass AS obj, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relowner <> 'abu_owner'::regrole LOOP
    EXECUTE format('ALTER %s %s OWNER TO abu_owner',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, r.obj);
  END LOOP;
  -- Selvstændige sekvenser
  FOR r IN SELECT c.oid::regclass AS obj FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relowner <> 'abu_owner'::regrole
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')) LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO abu_owner', r.obj);
  END LOOP;
  -- Enum- og domænetyper (Prismas enums)
  FOR r IN SELECT t.oid::regtype AS obj, t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd') AND t.typowner <> 'abu_owner'::regrole LOOP
    EXECUTE format('ALTER %s %s OWNER TO abu_owner', CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, r.obj);
  END LOOP;
  -- Funktioner/procedurer
  FOR r IN SELECT p.oid::regprocedure AS obj FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proowner <> 'abu_owner'::regrole LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO abu_owner', r.obj);
  END LOOP;
END
$own$;

-- 7. Kun DML for app-rollerne – nu og for fremtidige tabeller, som abu_owner opretter (migrationer) -------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO abu_app, abu_jobs;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM abu_app, abu_jobs;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO abu_app, abu_jobs;
REVOKE SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM abu_app, abu_jobs;

ALTER DEFAULT PRIVILEGES FOR ROLE abu_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO abu_app, abu_jobs;
ALTER DEFAULT PRIVILEGES FOR ROLE abu_owner IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM abu_app, abu_jobs;
ALTER DEFAULT PRIVILEGES FOR ROLE abu_owner IN SCHEMA public GRANT USAGE ON SEQUENCES TO abu_app, abu_jobs;

-- 8. Følsomme tabeller (gentages i migrationen 20261019100000_db_roles_phase0, som kører efter tabellerne er oprettet)
DO $sensitive$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    REVOKE ALL ON TABLE public."_prisma_migrations" FROM abu_app, abu_jobs;
  END IF;
  IF to_regclass('public."AuditLog"') IS NOT NULL THEN
    REVOKE UPDATE, DELETE ON TABLE public."AuditLog" FROM abu_app, abu_jobs;
  END IF;
END
$sensitive$;

-- 9. Ryd sessionsvariablerne med adgangskoderne
DO $clear$
BEGIN
  PERFORM set_config('abu.owner_password', '', false), set_config('abu.app_password', '', false), set_config('abu.jobs_password', '', false);
END
$clear$;
