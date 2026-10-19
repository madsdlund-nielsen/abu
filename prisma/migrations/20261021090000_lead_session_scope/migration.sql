-- =============================================================================================================
-- M-1 (docs/SECURITY-AUDIT-MFA-RLS.md): leads og markedsføringssamtykke er bundet til den tilmelding (onboarding-cookie),
-- der oprettede dem. En anonym tilmelding kan aldrig hente, overskrive, omknytte eller trække samtykket tilbage for et
-- lead, der hører til en anden tilmelding eller en konto – heller ikke ved at indtaste en andens e-mail i trin 1.
--
--  * Lead.email er ikke længere unik: hver tilmelding får sit eget lead (også med en e-mail, der allerede har et lead).
--    Admin ser leads samlet pr. e-mail (src/lib/leads-admin.ts); afmelding og samtykke-opslag går stadig på e-mailen.
--  * rls.capture_onboarding_lead opretter et nyt lead eller opdaterer KUN kalderens eget (ukonverterede, ikke delte)
--    lead. Ingen ON CONFLICT (email): et eksisterende lead for e-mailen røres ikke og afsløres ikke.
--  * OnboardingSession.leadId kan kun sættes af funktionen (eller system) – en tilmelding kan ikke selv pege på et
--    fremmed lead (trigger).
--  * MarketingConsent: indsættelse kun for eget leads id og med "userId" NULL eller = egen bruger; ændring (fx
--    tilbagetrækning) kun af kontoen selv, admin, system (signeret afmeldingslink, STOP) – eller af den tilmelding, der
--    selv gav samtykket, så længe det ikke er knyttet til en konto.
--  * Lead: en tilmelding kan ikke knytte sit lead til en fremmed bruger ("userId").
-- =============================================================================================================

-- ------------------------------------------------------------------------------------------------ Lead.email
DROP INDEX IF EXISTS "Lead_email_key";
CREATE INDEX IF NOT EXISTS "Lead_email_idx" ON "Lead"("email");

-- ------------------------------------------------------------------------------------------------ Trin 1 (DEFINER)
DROP FUNCTION IF EXISTS rls.capture_onboarding_lead(text, text, text, timestamp(3));

-- Opretter eller opdaterer KALDERENS eget lead (app.onboarding_token) og returnerer kun dets id:
--  * har tilmeldingen et lead med samme e-mail, som kun hører til den og ikke er konverteret → navnet opdateres;
--  * ellers oprettes et nyt lead (server-genereret id og tidspunkt), og tilmeldingen peger på det.
-- Et eksisterende lead for samme e-mail (en anden tilmelding, en kunde) røres aldrig – svaret er det samme.
CREATE OR REPLACE FUNCTION rls.capture_onboarding_lead(p_email text, p_name text) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_name text := pg_catalog.btrim(p_name);
  v_now timestamp(3) := (pg_catalog.now() AT TIME ZONE 'UTC');
  v_session text;
  v_lead text;
BEGIN
  IF rls.app_role() IS NULL OR rls.app_onboarding_token() IS NULL THEN
    RAISE EXCEPTION 'RLS: ingen igangværende tilmelding' USING ERRCODE = '42501';
  END IF;
  IF v_email IS NULL OR pg_catalog.length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Ugyldig e-mail' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL OR pg_catalog.length(v_name) = 0 OR pg_catalog.length(v_name) > 200 THEN
    RAISE EXCEPTION 'Ugyldigt navn' USING ERRCODE = '22023';
  END IF;
  SELECT o.id, o."leadId" INTO v_session, v_lead FROM public."OnboardingSession" o
   WHERE o."tokenHash" = rls.app_onboarding_token() AND o."expiresAt" > v_now
   FOR UPDATE;
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'RLS: ingen igangværende tilmelding' USING ERRCODE = '42501';
  END IF;
  IF v_lead IS NOT NULL THEN
    UPDATE public."Lead" l SET name = v_name, "lastActivityAt" = v_now
     WHERE l.id = v_lead AND l.email = v_email AND l."convertedAt" IS NULL AND l."userId" IS NULL
       AND NOT EXISTS (SELECT 1 FROM public."OnboardingSession" o WHERE o."leadId" = l.id AND o.id <> v_session);
    IF FOUND THEN
      RETURN v_lead;
    END IF;
  END IF;
  INSERT INTO public."Lead" (id, email, name, "createdAt", "lastActivityAt")
  VALUES (pg_catalog.gen_random_uuid()::text, v_email, v_name, v_now, v_now)
  RETURNING id INTO v_lead;
  UPDATE public."OnboardingSession" SET "leadId" = v_lead WHERE id = v_session;
  RETURN v_lead;
END
$$;
COMMENT ON FUNCTION rls.capture_onboarding_lead(text, text) IS 'M-1: trin 1 – opretter/opdaterer kun kalderens eget lead (token-scoped). Rører aldrig et lead fra en anden tilmelding eller en konto.';

-- ------------------------------------------------------------------------------------------------ Tilmelding → lead
-- Kun funktionen ovenfor (ejeren) og system må knytte en tilmelding til et lead. Appen må gerne fjerne koblingen (NULL).
CREATE OR REPLACE FUNCTION rls.guard_onboarding_lead_link() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF rls.app_is_system() THEN
    RETURN NEW;
  END IF;
  IF NEW."leadId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."leadId" IS DISTINCT FROM OLD."leadId") THEN
    RAISE EXCEPTION 'RLS: en tilmelding knyttes kun til et lead via rls.capture_onboarding_lead' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS onboarding_session_lead_guard ON "OnboardingSession";
CREATE TRIGGER onboarding_session_lead_guard BEFORE INSERT OR UPDATE OF "leadId" ON "OnboardingSession" FOR EACH ROW
  EXECUTE FUNCTION rls.guard_onboarding_lead_link();

-- ------------------------------------------------------------------------------------------------ Lead
DROP POLICY IF EXISTS lead_update ON "Lead";
CREATE POLICY lead_update ON "Lead" FOR UPDATE
  USING (rls.app_is_system() OR id IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token()))
  WITH CHECK (rls.app_is_system()
              OR (id IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token())
                  AND ("userId" IS NULL OR "userId" = rls.app_user_id())));
COMMENT ON POLICY lead_update ON "Lead" IS 'Egen tilmeldings lead (trin, telefon); konvertering kun til den indloggede bruger selv (convertLead); system.';

-- ------------------------------------------------------------------------------------------------ MarketingConsent
DROP POLICY IF EXISTS marketing_consent_insert ON "MarketingConsent";
CREATE POLICY marketing_consent_insert ON "MarketingConsent" FOR INSERT
  WITH CHECK (rls.app_is_system()
              OR ("leadId" IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token())
                  AND ("userId" IS NULL OR "userId" = rls.app_user_id())));
COMMENT ON POLICY marketing_consent_insert ON "MarketingConsent" IS 'Trin 1: samtykke for egen tilmeldings lead, uden bruger eller for den indloggede bruger selv (aldrig en fremmed "userId"); system.';

DROP POLICY IF EXISTS marketing_consent_update ON "MarketingConsent";
CREATE POLICY marketing_consent_update ON "MarketingConsent" FOR UPDATE
  USING (rls.app_is_system() OR rls.app_is_admin() OR "userId" = rls.app_user_id()
         OR ("userId" IS NULL AND "leadId" IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token())))
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR "userId" = rls.app_user_id()
         OR ("userId" IS NULL AND "leadId" IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token())));
COMMENT ON POLICY marketing_consent_update ON "MarketingConsent" IS 'Tilbagetrækning kun af den registrerede: kontoen selv (Konto), system efter signeret afmeldingslink/STOP, admin – eller den tilmelding, der selv gav samtykket (trin 1), indtil det knyttes til en konto (convertLead).';

-- ------------------------------------------------------------------------------------------------ Rettigheder
-- Nye funktioner: intet til PUBLIC (globale standardrettigheder giver ellers EXECUTE), EXECUTE til app-rollerne.
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
