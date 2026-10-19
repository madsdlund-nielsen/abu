-- =============================================================================================================
-- R-2 (docs/SECURITY-AUDIT-MFA-RLS.md): rate limit-funktionerne er bundet til kalderen. Nøglen afledes i databasen af
-- (spand, emne) – samme SHA-256 som før (`rl:<spand>:<emne>`) – og tiden er databasens, så kalderen hverken kan vælge en
-- vilkårlig nøgle eller nulstille/forlænge et vindue med et falsk tidspunkt.
--
--  * rls.rate_limit_reset: kun systemkonteksten.
--  * rls.rate_limit_hit: systemkonteksten for alle kendte spande; uden for systemkonteksten kun spande, hvis emne er
--    kalderen selv (bruger-id for den indloggede bruger eller den MFA-ventende sessions bruger; egen tilmeldings id).
--    Spande uden en identitet i databasen (klient-IP, e-mail før login, afmeldingstoken, CVR-budget, alarmer) tælles
--    af appen i systemkonteksten (src/lib/rate-limit.ts).
--  * Vinduet er 1 sekund – 27 timer; spand og emne valideres.
-- =============================================================================================================
DROP FUNCTION IF EXISTS rls.rate_limit_hit(text, timestamp(3), timestamp(3));
DROP FUNCTION IF EXISTS rls.rate_limit_reset(text);

-- Spande, hvis emne er kalderens egen identitet ('user' = bruger-id, 'onboarding' = egen tilmeldings id)
CREATE OR REPLACE FUNCTION rls.rate_limit_subject_kind(p_bucket text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS
$$ SELECT CASE p_bucket
            WHEN 'mfa-user' THEN 'user'
            WHEN 'pw-change' THEN 'user'
            WHEN 'admin-invite' THEN 'user'
            WHEN 'admin-manage' THEN 'user'
            WHEN 'onb-cvr-s' THEN 'onboarding'
          END $$;

-- Må kalderen tælle (spand, emne)? System: ja. Ellers kun egen identitet.
CREATE OR REPLACE FUNCTION rls.rate_limit_allowed(p_bucket text, p_subject text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT coalesce(CASE
            WHEN rls.app_caller_is_system() THEN true
            WHEN rls.rate_limit_subject_kind(p_bucket) = 'user'
              THEN p_subject IS NOT NULL AND (p_subject IS NOT DISTINCT FROM rls.app_user_id() OR p_subject IS NOT DISTINCT FROM rls.app_session_user_id())
            WHEN rls.rate_limit_subject_kind(p_bucket) = 'onboarding'
              THEN EXISTS (SELECT 1 FROM public."OnboardingSession" o
                            WHERE o.id = p_subject AND o."tokenHash" = rls.app_onboarding_token())
            ELSE false
          END, false) $$;

-- Tæl ét forsøg atomisk og returnér tælleren og vinduets slut.
CREATE OR REPLACE FUNCTION rls.rate_limit_hit(p_bucket text, p_subject text, p_window_seconds integer)
  RETURNS TABLE (hits integer, reset_until timestamp(3))
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_now timestamp(3) := (pg_catalog.now() AT TIME ZONE 'UTC');
  v_key text;
BEGIN
  IF rls.app_role() IS NULL THEN
    RAISE EXCEPTION 'RLS: ingen databasekontekst' USING ERRCODE = '42501';
  END IF;
  IF p_bucket IS NULL OR p_bucket !~ '^[a-z][a-z0-9-]{0,39}$' OR p_subject IS NULL OR pg_catalog.length(p_subject) > 512
     OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 27 * 3600 THEN
    RAISE EXCEPTION 'Ugyldig rate limit' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(rls.rate_limit_allowed(p_bucket, p_subject), false) THEN
    RAISE EXCEPTION 'RLS: rate limit-nøglen tilhører ikke kalderen' USING ERRCODE = '42501';
  END IF;
  v_key := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('rl:' || p_bucket || ':' || p_subject, 'UTF8')), 'hex');
  RETURN QUERY
    INSERT INTO public."RateLimit" AS r ("key", "count", "resetAt")
    VALUES (v_key, 1, v_now + pg_catalog.make_interval(secs => p_window_seconds))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN r."resetAt" <= v_now THEN 1 ELSE r."count" + 1 END,
      "resetAt" = CASE WHEN r."resetAt" <= v_now THEN EXCLUDED."resetAt" ELSE r."resetAt" END
    RETURNING r."count", r."resetAt";
END
$$;
COMMENT ON FUNCTION rls.rate_limit_hit(text, text, integer) IS 'R-2: nøglen afledes af (spand, emne) i databasen, tiden er databasens; uden for system kun spande for kalderens egen identitet.';

CREATE OR REPLACE FUNCTION rls.rate_limit_reset(p_bucket text, p_subject text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF NOT rls.app_caller_is_system() THEN
    RAISE EXCEPTION 'RLS: kun systemkonteksten kan nulstille en rate limit' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."RateLimit"
   WHERE "key" = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('rl:' || p_bucket || ':' || p_subject, 'UTF8')), 'hex');
END
$$;
COMMENT ON FUNCTION rls.rate_limit_reset(text, text) IS 'R-2: kun systemkonteksten.';

COMMENT ON POLICY rate_limit_all ON "RateLimit" IS 'Kun system; tælling via rls.rate_limit_hit (nøgle afledt i databasen, bundet til kalderen – R-2).';

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
