-- =============================================================================================================
-- Hærdning (docs/SECURITY-AUDIT-MFA-RLS.md, «Forgeable context under SQLi»): signeret databasekontekst.
--
-- Før: enhver, der kunne køre SQL som abu_app (fx en SQL-injektion), kunne sætte set_config('app.role','system') og
-- se alt. Nu stoler kontekstfunktionerne kun på app.role/app.user_id/app.session_id/app.onboarding_token, når
-- app.ctx bærer en gyldig HMAC-SHA256 over netop de værdier, lavet med en nøgle, som kun appens proces
-- (DB_CONTEXT_SECRET) og databasens ejer kender:
--
--   app.ctx = <kid>.<udstedt ms>.<nonce>.<hex HMAC>          (src/lib/db-context-sign.ts)
--   besked  = 'abu-ctx-v1|' kid '|' role '|' user_id '|' session_id '|' onboarding_token '|' udstedt '|' nonce
--
--  * Nøglen ligger i rls.context_key (kun HMAC-paddene), ejet af abu_owner; abu_app/abu_jobs har INGEN rettigheder til
--    tabellen. Den installeres med `npm run db:context-key` (som ejeren). Flere nøgler (kid) kan ligge samtidig (rotation).
--  * rls.ctx_ok() (SECURITY DEFINER, ejet af abu_owner) verificerer signaturen; den er det eneste, der læser nøglen, og
--    returnerer kun en boolean. Udstedelsestidspunktet skal ligge inden for ±5 minutter af transaktionens start.
--  * Uden gyldig signatur er der ingen rolle (rls.app_role() IS NULL) → ingen politik giver adgang (fail closed).
--    Ejeren (migrationer, seed, definer-funktionerne) er stadig undtaget via current_user i rls.app_is_system().
--  * Ydelse: kontekstfunktionerne kaldes i alle politikker som `(SELECT rls.app_…())` (InitPlan = én gang pr. forespørgsel
--    i stedet for pr. række). Nederst omskrives alle eksisterende politikker og hjælpefunktioner automatisk.
-- =============================================================================================================

-- ------------------------------------------------------------------------------------------------ Nøglen
CREATE TABLE IF NOT EXISTS rls.context_key (
  kid         text PRIMARY KEY CHECK (kid ~ '^[0-9a-f]{16}$'),
  ipad        bytea NOT NULL CHECK (octet_length(ipad) = 64),
  opad        bytea NOT NULL CHECK (octet_length(opad) = 64),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE rls.context_key IS 'HMAC-nøgle(r) til den signerede databasekontekst (app.ctx). Kun ejeren; app-rollerne har ingen rettigheder. Installeres med npm run db:context-key.';
REVOKE ALL ON TABLE rls.context_key FROM PUBLIC;
DO $revoke$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['abu_app', 'abu_jobs'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON TABLE rls.context_key FROM %I', r);
    END IF;
  END LOOP;
END
$revoke$;

-- ------------------------------------------------------------------------------------------------ Verifikation (DEFINER)
CREATE OR REPLACE FUNCTION rls.ctx_ok() RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_ctx text := pg_catalog.current_setting('app.ctx', true);
  v_role text := coalesce(pg_catalog.current_setting('app.role', true), '');
  v_user text := coalesce(pg_catalog.current_setting('app.user_id', true), '');
  v_session text := coalesce(pg_catalog.current_setting('app.session_id', true), '');
  v_onb text := coalesce(pg_catalog.current_setting('app.onboarding_token', true), '');
  p text[];
  k record;
BEGIN
  IF v_ctx IS NULL OR v_ctx !~ '^[0-9a-f]{16}\.[0-9]{1,15}\.[0-9a-f]{8,64}\.[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  -- Entydig besked: ingen værdi må indeholde feltadskilleren
  IF pg_catalog.strpos(v_role || v_user || v_session || v_onb, '|') > 0 THEN
    RETURN false;
  END IF;
  p := pg_catalog.string_to_array(v_ctx, '.');
  IF pg_catalog.abs(EXTRACT(EPOCH FROM pg_catalog.now()) * 1000 - p[2]::numeric) > 300000 THEN
    RETURN false;
  END IF;
  SELECT ck.ipad, ck.opad INTO k FROM rls.context_key ck WHERE ck.kid = p[1];
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- HMAC-SHA256 (RFC 2104) med de gemte pads; sammenligningen sker på hashes af værdierne (ingen tidskanal på selve MAC'en)
  RETURN pg_catalog.sha256(pg_catalog.convert_to(p[4], 'UTF8'))
       = pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.encode(
           pg_catalog.sha256(k.opad || pg_catalog.sha256(k.ipad || pg_catalog.convert_to(
             'abu-ctx-v1|' || p[1] || '|' || v_role || '|' || v_user || '|' || v_session || '|' || v_onb || '|' || p[2] || '|' || p[3],
             'UTF8'))), 'hex'), 'UTF8'));
END
$$;
COMMENT ON FUNCTION rls.ctx_ok() IS 'Signeret kontekst: true, hvis app.ctx er en gyldig HMAC over app.role/app.user_id/app.session_id/app.onboarding_token (nøgle i rls.context_key).';

-- ------------------------------------------------------------------------------------------------ Kontekst (INVOKER)
-- En rolle tæller kun med gyldig signatur. Hver funktion tjekker først den billige forudsætning (hvilken rolle konteksten
-- PÅSTÅR at have) og verificerer kun, hvis den er opfyldt: app_is_system() verificerer fx ikke en kontekst, der slet ikke
-- påstår at være system. Sikkerheden er den samme (en påstået rolle kræver altid en gyldig signatur), men en typisk
-- forespørgsel kalder rls.ctx_ok() få gange i stedet for én gang pr. kontekstkald i politikkerne. (Rækkefølgen inde i
-- AND/CASE bevares af planlæggeren; giv IKKE ctx_ok() en høj COST – så slår JIT til på helt små forespørgsler.)

CREATE OR REPLACE FUNCTION rls.app_role() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN pg_catalog.current_setting('app.role', true) IN ('ADMIN', 'ADVISOR', 'CUSTOMER', 'anon', 'system') AND rls.ctx_ok()
               THEN pg_catalog.current_setting('app.role', true) END $$;

CREATE OR REPLACE FUNCTION rls.app_user_id() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN pg_catalog.current_setting('app.role', true) IN ('ADMIN', 'ADVISOR', 'CUSTOMER')
                    AND nullif(pg_catalog.current_setting('app.user_id', true), '') IS NOT NULL AND rls.ctx_ok()
               THEN pg_catalog.current_setting('app.user_id', true) END $$;

CREATE OR REPLACE FUNCTION rls.app_session_id() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN nullif(pg_catalog.current_setting('app.session_id', true), '') IS NOT NULL
                    AND pg_catalog.current_setting('app.role', true) IN ('ADMIN', 'ADVISOR', 'CUSTOMER', 'anon', 'system') AND rls.ctx_ok()
               THEN pg_catalog.current_setting('app.session_id', true) END $$;

CREATE OR REPLACE FUNCTION rls.app_onboarding_token() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN nullif(pg_catalog.current_setting('app.onboarding_token', true), '') IS NOT NULL
                    AND pg_catalog.current_setting('app.role', true) IN ('ADMIN', 'ADVISOR', 'CUSTOMER', 'anon', 'system') AND rls.ctx_ok()
               THEN pg_catalog.current_setting('app.onboarding_token', true) END $$;

CREATE OR REPLACE FUNCTION rls.app_has_context() RETURNS boolean
  LANGUAGE sql STABLE AS
$$ SELECT coalesce(pg_catalog.current_setting('app.role', true) IN ('ADMIN', 'ADVISOR', 'CUSTOMER', 'anon', 'system') AND rls.ctx_ok(), false) $$;

CREATE OR REPLACE FUNCTION rls.app_is_admin() RETURNS boolean
  LANGUAGE sql STABLE AS
$$ SELECT coalesce(pg_catalog.current_setting('app.role', true) = 'ADMIN'
                   AND nullif(pg_catalog.current_setting('app.user_id', true), '') IS NOT NULL AND rls.ctx_ok(), false) $$;

CREATE OR REPLACE FUNCTION rls.app_caller_is_system() RETURNS boolean
  LANGUAGE sql STABLE AS
$$ SELECT coalesce(pg_catalog.current_setting('app.role', true) = 'system' AND rls.ctx_ok(), false) $$;

-- Ejeren (migrationer, seed, definer-funktionerne) eller en SIGNERET systemkontekst
DO $sys$
BEGIN
  EXECUTE pg_catalog.format($f$
    CREATE OR REPLACE FUNCTION rls.app_is_system() RETURNS boolean
      LANGUAGE sql STABLE AS
    $b$ SELECT current_user = %L OR coalesce(pg_catalog.current_setting('app.role', true) = 'system' AND rls.ctx_ok(), false) $b$
  $f$, current_user);
END
$sys$;

-- ------------------------------------------------------------------------------------------------ InitPlan-omskrivning
-- Alle politikker i public og alle hjælpefunktioner i rls: `rls.app_xxx()` → `(SELECT rls.app_xxx())`, så signaturen
-- verificeres én gang pr. forespørgsel (InitPlan) og ikke pr. række. Allerede omskrevne kald springes over.
-- Nye politikker skal skrives sådan (README «Row-Level Security», tjeklisten; src/lib/rls.test.ts håndhæver det).
DO $wrap$
DECLARE
  pattern constant text := '(?<!SELECT )(?<!FUNCTION )rls\.(app_user_id|app_role|app_session_id|app_onboarding_token|app_has_context|app_is_admin|app_is_system|app_caller_is_system|app_session_user_id)\(\)';
  r record;
  q text;
  c text;
  stmt text;
BEGIN
  FOR r IN
    SELECT pol.polname, cl.relname, pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS qual,
           pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS chk
      FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class cl ON cl.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
     WHERE n.nspname = 'public'
  LOOP
    q := pg_catalog.regexp_replace(r.qual, pattern, '(SELECT rls.\1())', 'g');
    c := pg_catalog.regexp_replace(r.chk, pattern, '(SELECT rls.\1())', 'g');
    IF q IS DISTINCT FROM r.qual OR c IS DISTINCT FROM r.chk THEN
      stmt := pg_catalog.format('ALTER POLICY %I ON public.%I', r.polname, r.relname);
      IF q IS NOT NULL THEN stmt := stmt || pg_catalog.format(' USING (%s)', q); END IF;
      IF c IS NOT NULL THEN stmt := stmt || pg_catalog.format(' WITH CHECK (%s)', c); END IF;
      EXECUTE stmt;
    END IF;
  END LOOP;

  -- Hjælpefunktionerne (ikke selve kontekstfunktionerne – de skal forblive inlinebare)
  FOR r IN
    SELECT p.oid, pg_catalog.pg_get_functiondef(p.oid) AS def
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'rls' AND p.prokind = 'f'
       AND p.proname NOT IN ('app_user_id', 'app_role', 'app_session_id', 'app_onboarding_token', 'app_has_context',
                             'app_is_admin', 'app_is_system', 'app_caller_is_system', 'ctx_ok')
       AND p.prosrc ~ pattern
  LOOP
    EXECUTE pg_catalog.regexp_replace(r.def, pattern, '(SELECT rls.\1())', 'g');
  END LOOP;
END
$wrap$;

-- ------------------------------------------------------------------------------------------------ Rettigheder
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rls FROM PUBLIC;
DO $grants$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['abu_app', 'abu_jobs'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      EXECUTE pg_catalog.format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rls TO %I', r);
    END IF;
  END LOOP;
END
$grants$;
