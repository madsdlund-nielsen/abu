-- =============================================================================================================
-- RLS fase 1–3 (docs/SECURITY-AUDIT-DELTA.md, del B): Row-Level Security på ALLE tabeller i schema public.
--
-- Kører som ejeren (abu_owner) via `prisma migrate deploy`. Appen (abu_app) sætter pr. transaktion
--   set_config('app.user_id', …, true), set_config('app.role', …, true),
--   set_config('app.session_id', …, true), set_config('app.onboarding_token', …, true)
-- med bundne parametre (src/lib/db.ts). Politikkerne nedenfor læser dem via funktionerne i schema `rls`.
--
-- Regler:
--  * ENABLE + FORCE ROW LEVEL SECURITY på hver tabel i public (undtagen _prisma_migrations, som app-rollerne slet ikke
--    har adgang til). FORCE: også ejeren er underlagt politikkerne – den er undtaget eksplicit via rls.app_is_system()
--    (current_user = ejeren), så migrationer, seed og SECURITY DEFINER-funktioner virker, og undtagelsen står ét sted.
--  * Mangler konteksten (ingen app.role), giver ingen politik adgang (fail closed).
--  * Hver politik spejler en regel i appens kode (requireRole, canAccessMeeting, ejerskabsfiltre …); COMMENT ON POLICY
--    angiver hvilken.
--  * Hjælpefunktioner: STABLE, i schema `rls` (ejet af ejeren). De simple kontekstfunktioner er SECURITY INVOKER og
--    bruger kun fuldt kvalificerede pg_catalog-funktioner (så de kan inlines i politikkerne og er search_path-sikre).
--    Ejerskabs- og kapabilitetsfunktionerne er SECURITY DEFINER med `SET search_path = pg_catalog, pg_temp`, fuldt
--    kvalificerede tabeller og egen autorisation (de undgår rekursive politikker og giver kun det, appen bruger).
--    EXECUTE er taget fra PUBLIC og givet til abu_app/abu_jobs.
-- =============================================================================================================

-- ------------------------------------------------------------------------------------------------ Schema
CREATE SCHEMA IF NOT EXISTS rls;
REVOKE ALL ON SCHEMA rls FROM PUBLIC;
COMMENT ON SCHEMA rls IS 'RLS-hjælpefunktioner (kontekst, ejerskab, kapabiliteter). Ejes af migrationsrollen; kun USAGE/EXECUTE for app-rollerne.';

-- ------------------------------------------------------------------------------------------------ Kontekst (INVOKER)
-- Bruger-id'et tæller kun sammen med en indlogget rolle (ADMIN/ADVISOR/CUSTOMER) – anon, system og ukendte roller har intet
CREATE OR REPLACE FUNCTION rls.app_user_id() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN pg_catalog.current_setting('app.role', true) IN ('ADMIN', 'ADVISOR', 'CUSTOMER')
               THEN nullif(pg_catalog.current_setting('app.user_id', true), '') END $$;

-- Kun kendte roller tæller (en ukendt værdi = ingen kontekst)
CREATE OR REPLACE FUNCTION rls.app_role() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT CASE pg_catalog.current_setting('app.role', true)
            WHEN 'ADMIN' THEN 'ADMIN' WHEN 'ADVISOR' THEN 'ADVISOR' WHEN 'CUSTOMER' THEN 'CUSTOMER'
            WHEN 'anon' THEN 'anon' WHEN 'system' THEN 'system' END $$;

CREATE OR REPLACE FUNCTION rls.app_session_id() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT nullif(pg_catalog.current_setting('app.session_id', true), '') $$;

CREATE OR REPLACE FUNCTION rls.app_onboarding_token() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT nullif(pg_catalog.current_setting('app.onboarding_token', true), '') $$;

-- En gyldig rolle er sat (anon, en bruger eller system). Grundkravet for alt "offentligt".
CREATE OR REPLACE FUNCTION rls.app_has_context() RETURNS boolean
  LANGUAGE sql STABLE AS
$$ SELECT pg_catalog.current_setting('app.role', true) IN ('ADMIN', 'ADVISOR', 'CUSTOMER', 'anon', 'system') $$;

CREATE OR REPLACE FUNCTION rls.app_is_admin() RETURNS boolean
  LANGUAGE sql STABLE AS
$$ SELECT coalesce(pg_catalog.current_setting('app.role', true) = 'ADMIN'
                   AND nullif(pg_catalog.current_setting('app.user_id', true), '') IS NOT NULL, false) $$;

-- Kalderen har selv sat app.role = 'system' (bruges INDE i SECURITY DEFINER-funktioner, hvor current_user er ejeren)
CREATE OR REPLACE FUNCTION rls.app_caller_is_system() RETURNS boolean
  LANGUAGE sql STABLE AS
$$ SELECT coalesce(pg_catalog.current_setting('app.role', true) = 'system', false) $$;

-- System: app.role = 'system' (jobs, webhooks, seed, auth-internt …) ELLER ejeren selv (migrationer og SECURITY
-- DEFINER-funktioner, som ejes af ejeren). Ejerens navn indsættes, når migrationen kører (= den rolle, der kører den).
DO $sys$
BEGIN
  EXECUTE pg_catalog.format($f$
    CREATE OR REPLACE FUNCTION rls.app_is_system() RETURNS boolean
      LANGUAGE sql STABLE AS
    $b$ SELECT coalesce(pg_catalog.current_setting('app.role', true) = 'system', false) OR current_user = %L $b$
  $f$, current_user);
END
$sys$;

-- ------------------------------------------------------------------------------------------------ Ejerskab (DEFINER)
-- Brugeren bag den aktuelle session (også en MFA-ventende) – sessionsopslaget i getSessionContext.
CREATE OR REPLACE FUNCTION rls.app_session_user_id() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT s."userId" FROM public."Session" s WHERE s.id = rls.app_session_id() $$;

-- Abonnementer, hvor den aktuelle bruger er kunden
CREATE OR REPLACE FUNCTION rls.app_customer_subscription_ids() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT s.id FROM public."Subscription" s WHERE s."customerId" = rls.app_user_id() $$;

-- Abonnementer (boards), hvor den aktuelle bruger sidder som rådgiver
CREATE OR REPLACE FUNCTION rls.app_advisor_subscription_ids() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT sa."subscriptionId" FROM public."SubscriptionAdvisor" sa WHERE sa."advisorId" = rls.app_user_id() $$;

CREATE OR REPLACE FUNCTION rls.app_is_customer_of_subscription(p_subscription_id text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT EXISTS (SELECT 1 FROM public."Subscription" s WHERE s.id = p_subscription_id AND s."customerId" = rls.app_user_id()) $$;

CREATE OR REPLACE FUNCTION rls.app_is_participant_of_meeting(p_meeting_id text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT EXISTS (SELECT 1 FROM public."MeetingParticipant" mp WHERE mp."meetingId" = p_meeting_id AND mp."userId" = rls.app_user_id()) $$;

CREATE OR REPLACE FUNCTION rls.app_is_customer_of_meeting(p_meeting_id text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT EXISTS (SELECT 1 FROM public."Meeting" m JOIN public."Subscription" s ON s.id = m."subscriptionId"
                   WHERE m.id = p_meeting_id AND s."customerId" = rls.app_user_id()) $$;

-- Møder, den aktuelle bruger har adgang til: deltager (canAccessMeeting) eller kunden på mødets abonnement
CREATE OR REPLACE FUNCTION rls.app_meeting_ids() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT mp."meetingId" FROM public."MeetingParticipant" mp WHERE mp."userId" = rls.app_user_id()
   UNION
   SELECT m.id FROM public."Meeting" m JOIN public."Subscription" s ON s.id = m."subscriptionId" WHERE s."customerId" = rls.app_user_id() $$;

-- Rådgivere i den aktuelle kundes boards (alle statusser)
CREATE OR REPLACE FUNCTION rls.app_board_advisor_ids() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT sa."advisorId" FROM public."SubscriptionAdvisor" sa JOIN public."Subscription" s ON s.id = sa."subscriptionId"
    WHERE s."customerId" = rls.app_user_id() $$;

-- Personer, den aktuelle bruger deler et board eller et møde med (kunde ↔ rådgivere, rådgiver ↔ medrådgivere,
-- afløsere i et enkelt møde). Det er dem, UI'et viser navn, titel og virksomhed for.
CREATE OR REPLACE FUNCTION rls.app_board_peer_ids() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ WITH me AS (SELECT rls.app_user_id() AS id),
        boards AS (
          SELECT s.id FROM public."Subscription" s, me WHERE s."customerId" = me.id
          UNION SELECT sa."subscriptionId" FROM public."SubscriptionAdvisor" sa, me WHERE sa."advisorId" = me.id)
   SELECT s."customerId" FROM public."Subscription" s WHERE s.id IN (SELECT id FROM boards)
   UNION SELECT sa."advisorId" FROM public."SubscriptionAdvisor" sa WHERE sa."subscriptionId" IN (SELECT id FROM boards)
   UNION SELECT other."userId" FROM public."MeetingParticipant" mine
           JOIN public."MeetingParticipant" other ON other."meetingId" = mine."meetingId", me
          WHERE mine."userId" = me.id $$;

-- ------------------------------------------------------------------------------------------------ Kapabiliteter (DEFINER)
-- Navne (og rolle) på andre brugere – det eneste, kunder og rådgivere må se om hinanden (ikke e-mail, telefon,
-- adgangskode-hash, MFA eller spærring). Selv, board-/mødekolleger og aktive rådgivere (kataloget før login);
-- admin og system: alle.
CREATE OR REPLACE FUNCTION rls.user_directory(p_ids text[]) RETURNS TABLE (id text, name text, role public."Role")
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT u.id, u.name, u.role FROM public."User" u
    WHERE u.id = ANY (p_ids)
      AND rls.app_role() IS NOT NULL
      AND (rls.app_is_admin() OR rls.app_caller_is_system()
           OR u.id = rls.app_user_id()
           OR u.id IN (SELECT rls.app_board_peer_ids())
           OR EXISTS (SELECT 1 FROM public."AdvisorProfile" p WHERE p."userId" = u.id AND p.active)) $$;

-- Hvilke af rådgiverne kan være ansvarlig rådgiver (aktive + det interne lead-tag)? Kun en boolean pr. rådgiver – selve
-- admin-tagget og AdvisorTag-rækkerne er usynlige for andre end admin/system (D-5: værdien er bevidst offentlig).
-- NULL = alle aktive rådgivere.
CREATE OR REPLACE FUNCTION rls.lead_eligible_ids(p_ids text[]) RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT p."userId" FROM public."AdvisorProfile" p
    WHERE (p_ids IS NULL OR p."userId" = ANY (p_ids))
      AND p.active
      AND rls.app_role() IS NOT NULL
      AND EXISTS (SELECT 1 FROM public."AdvisorTag" at JOIN public."Tag" t ON t.id = at."tagId"
                   WHERE at."advisorId" = p."userId" AND t."systemKey" = 'lead') $$;

-- Optagne tider for rådgivere (bookingens ledige tider og konfliktkontrol): kun start/slut/status – ingen mødeid'er,
-- kunder eller indhold. Admin/system: alle rådgivere; en rådgiver: sig selv; en kunde: rådgiverne i sine boards.
CREATE OR REPLACE FUNCTION rls.advisor_busy(p_ids text[], p_from timestamp(3), p_to timestamp(3), p_exclude_meeting text)
  RETURNS TABLE (advisor_id text, starts_at timestamp(3), ends_at timestamp(3), status public."MeetingStatus")
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF rls.app_role() IS NULL THEN
    RAISE EXCEPTION 'RLS: ingen databasekontekst' USING ERRCODE = '42501';
  END IF;
  IF NOT (rls.app_is_admin() OR rls.app_caller_is_system())
     AND EXISTS (SELECT 1 FROM unnest(p_ids) AS x(id)
                  WHERE x.id IS DISTINCT FROM rls.app_user_id() AND x.id NOT IN (SELECT rls.app_board_advisor_ids())) THEN
    RAISE EXCEPTION 'RLS: ingen adgang til rådgivernes kalender' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT mp."userId", m."startsAt", m."endsAt", m.status
      FROM public."MeetingParticipant" mp JOIN public."Meeting" m ON m.id = mp."meetingId"
     WHERE mp."userId" = ANY (p_ids)
       AND m."endsAt" > p_from AND m."startsAt" < p_to
       AND (p_exclude_meeting IS NULL OR m.id <> p_exclude_meeting);
END
$$;

-- Fordeling af ansvarsroller (tildeling af ansvarlig rådgiver ved køb/planskift): antal boards som ansvarlig og antal
-- pladser i alt pr. rådgiver i levende abonnementer, ekskl. det aktuelle. Kun tal. Admin/system, eller kunden på
-- abonnementet for netop dets rådgivere.
CREATE OR REPLACE FUNCTION rls.advisor_lead_load(p_ids text[], p_subscription_id text)
  RETURNS TABLE (advisor_id text, lead_count integer, seat_count integer)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF NOT (rls.app_is_admin() OR rls.app_caller_is_system() OR rls.app_is_customer_of_subscription(p_subscription_id)) THEN
    RAISE EXCEPTION 'RLS: ingen adgang til abonnementet' USING ERRCODE = '42501';
  END IF;
  IF NOT (rls.app_is_admin() OR rls.app_caller_is_system())
     AND EXISTS (SELECT 1 FROM unnest(p_ids) AS x(id)
                  WHERE NOT EXISTS (SELECT 1 FROM public."SubscriptionAdvisor" sa WHERE sa."subscriptionId" = p_subscription_id AND sa."advisorId" = x.id)) THEN
    RAISE EXCEPTION 'RLS: rådgiveren sidder ikke i boardet' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT x.id,
           (count(sa.*) FILTER (WHERE sa."isLead"))::integer,
           count(sa.*)::integer
      FROM unnest(p_ids) AS x(id)
      LEFT JOIN public."SubscriptionAdvisor" sa
             ON sa."advisorId" = x.id AND sa."subscriptionId" <> p_subscription_id
            AND EXISTS (SELECT 1 FROM public."Subscription" s WHERE s.id = sa."subscriptionId" AND s.status IN ('PENDING', 'ACTIVE', 'PAST_DUE'))
     GROUP BY x.id;
END
$$;

-- Antal igangværende uploads i alt (fælles loft i recording-upload.ts). Kun tallet.
CREATE OR REPLACE FUNCTION rls.pending_upload_total(p_since timestamp(3)) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT CASE WHEN rls.app_role() IN ('ADMIN', 'ADVISOR', 'system')
               THEN (SELECT count(*)::integer FROM public."Recording" r WHERE r.status = 'UPLOADING' AND r."createdAt" > p_since)
          END $$;

-- Rate limit-lageret (H-2/L-2): tæl ét forsøg atomisk og returnér tælleren. Alle kontekster (også anon før login);
-- RateLimit-tabellen er ellers kun for system. Nøglen er allerede en SHA-256.
CREATE OR REPLACE FUNCTION rls.rate_limit_hit(p_key text, p_reset_at timestamp(3), p_now timestamp(3))
  RETURNS TABLE (hits integer, reset_until timestamp(3))
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF rls.app_role() IS NULL THEN
    RAISE EXCEPTION 'RLS: ingen databasekontekst' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    INSERT INTO public."RateLimit" AS r ("key", "count", "resetAt") VALUES (p_key, 1, p_reset_at)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN r."resetAt" <= p_now THEN 1 ELSE r."count" + 1 END,
      "resetAt" = CASE WHEN r."resetAt" <= p_now THEN EXCLUDED."resetAt" ELSE r."resetAt" END
    RETURNING r."count", r."resetAt";
END
$$;

CREATE OR REPLACE FUNCTION rls.rate_limit_reset(p_key text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF rls.app_role() IS NULL THEN
    RAISE EXCEPTION 'RLS: ingen databasekontekst' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."RateLimit" WHERE "key" = p_key;
END
$$;

-- Onboarding trin 1 (token-scoped): opretter eller opdaterer leadet for e-mailen (som appens upsert) og knytter det til
-- KALDERENS egen tilmelding (app.onboarding_token). Returnerer kun leadets id. Samtykket skrives derefter af anon selv
-- (politikken på MarketingConsent: kun for egen tilmeldings lead).
CREATE OR REPLACE FUNCTION rls.capture_onboarding_lead(p_id text, p_email text, p_name text, p_now timestamp(3)) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_session text;
  v_lead text;
BEGIN
  SELECT o.id INTO v_session FROM public."OnboardingSession" o
   WHERE o."tokenHash" = rls.app_onboarding_token() AND rls.app_onboarding_token() IS NOT NULL;
  IF v_session IS NULL OR rls.app_role() IS NULL THEN
    RAISE EXCEPTION 'RLS: ingen igangværende tilmelding' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."Lead" AS l (id, email, name, "createdAt", "lastActivityAt")
  VALUES (p_id, pg_catalog.lower(pg_catalog.btrim(p_email)), p_name, p_now, p_now)
  ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, "lastActivityAt" = EXCLUDED."lastActivityAt"
  RETURNING l.id INTO v_lead;
  UPDATE public."OnboardingSession" SET "leadId" = v_lead WHERE id = v_session;
  RETURN v_lead;
END
$$;

-- ------------------------------------------------------------------------------------------------ Kolonneværn (trigger)
-- Brugeren selv må kun ændre de kolonner, appen lader brugeren ændre (TG_ARGV); admin og system alle. Kolonne-
-- rettigheder (GRANT … (kolonne)) gælder for hele rollen abu_app og kan ikke skelne selv/admin/system – derfor en
-- BEFORE UPDATE-trigger. Nye kolonner er automatisk beskyttede (de står ikke på listen).
CREATE OR REPLACE FUNCTION rls.guard_self_update() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF rls.app_is_admin() OR rls.app_is_system() THEN
    RETURN NEW;
  END IF;
  IF (pg_catalog.to_jsonb(NEW) OPERATOR(pg_catalog.-) TG_ARGV) IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) OPERATOR(pg_catalog.-) TG_ARGV) THEN
    RAISE EXCEPTION 'RLS: rollen % må kun ændre kolonnerne % i %', coalesce(rls.app_role(), '(ingen)'), TG_ARGV, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

-- Konto (account.ts), rådgiverprofil (advisor.ts) og skift af adgangskode (auth.ts): resten er admin/system
-- (login-tællere, MFA, deaktivering, sidste login …).
DROP TRIGGER IF EXISTS user_self_update_guard ON "User";
CREATE TRIGGER user_self_update_guard BEFORE UPDATE ON "User" FOR EACH ROW
  EXECUTE FUNCTION rls.guard_self_update('name', 'phone', 'passwordHash', 'deletionRequestedAt', 'recordingConsentAt',
                                         'recordingConsentVersion', 'emailOptOutAt', 'smsOptOutAt');

-- Rådgiveren selv: titel, bio og profilbillede. Pris og aktiv/inaktiv sætter admin.
DROP TRIGGER IF EXISTS advisor_profile_self_update_guard ON "AdvisorProfile";
CREATE TRIGGER advisor_profile_self_update_guard BEFORE UPDATE ON "AdvisorProfile" FOR EACH ROW
  EXECUTE FUNCTION rls.guard_self_update('title', 'bio', 'photoKey', 'photoUpdatedAt');

-- ------------------------------------------------------------------------------------------------ Indeks til politikkerne
-- MeetingParticipant(userId, meetingId): «mine møder» som index-only scan (erstatter indekset på userId alene).
DROP INDEX IF EXISTS "MeetingParticipant_userId_idx";
CREATE INDEX IF NOT EXISTS "MeetingParticipant_userId_meetingId_idx" ON "MeetingParticipant"("userId", "meetingId");
-- SubscriptionAdvisor(advisorId): «boards, jeg sidder i» (PK'en starter med subscriptionId).
CREATE INDEX IF NOT EXISTS "SubscriptionAdvisor_advisorId_idx" ON "SubscriptionAdvisor"("advisorId");
-- Recording(uploadedById): egne uploads (politik og loft pr. bruger).
CREATE INDEX IF NOT EXISTS "Recording_uploadedById_idx" ON "Recording"("uploadedById");

-- ------------------------------------------------------------------------------------------------ Politikker
-- Forkortelser i kommentarerne: S = rls.app_is_system(), A = rls.app_is_admin(), U = rls.app_user_id().

-- User ----------------------------------------------------------------------------------------------------------
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_select ON "User" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR id = rls.app_user_id() OR id = rls.app_session_user_id());
COMMENT ON POLICY user_select ON "User" IS 'Selv (requireUser), sessionens egen bruger (getSessionContext, også MFA-ventende), admin og system (login på e-mail, notifikationer). Andre brugere kun via rls.user_directory (navn/rolle).';
CREATE POLICY user_insert ON "User" FOR INSERT WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY user_insert ON "User" IS 'Admin opretter rådgivere/administratorer (admin.ts, admin-users.ts); tilmelding og seed i systemkontekst.';
CREATE POLICY user_update ON "User" FOR UPDATE
  USING (rls.app_is_system() OR rls.app_is_admin() OR id = rls.app_user_id())
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR id = rls.app_user_id());
COMMENT ON POLICY user_update ON "User" IS 'Selv (kun kolonnerne i user_self_update_guard), admin, system (login-tællere, MFA).';
CREATE POLICY user_delete ON "User" FOR DELETE USING (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY user_delete ON "User" IS 'GDPR-sletning (erasure.ts, kun admin med frisk kode).';

-- Session -------------------------------------------------------------------------------------------------------
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" FORCE ROW LEVEL SECURITY;
CREATE POLICY session_select ON "Session" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR id = rls.app_session_id() OR "userId" = rls.app_user_id());
COMMENT ON POLICY session_select ON "Session" IS 'Egen session (cookiens hash) og egne sessioner; admin (tilbagekalder sessioner ved deaktivering/MFA-nulstilling); system.';
CREATE POLICY session_insert ON "Session" FOR INSERT WITH CHECK (rls.app_is_system());
COMMENT ON POLICY session_insert ON "Session" IS 'Kun auth-internt (createSession i systemkontekst).';
CREATE POLICY session_update ON "Session" FOR UPDATE USING (rls.app_is_system()) WITH CHECK (rls.app_is_system());
COMMENT ON POLICY session_update ON "Session" IS 'Kun auth-internt (MFA-bekræftelse).';
CREATE POLICY session_delete ON "Session" FOR DELETE
  USING (rls.app_is_system() OR rls.app_is_admin() OR id = rls.app_session_id() OR "userId" = rls.app_user_id());
COMMENT ON POLICY session_delete ON "Session" IS 'Log ud (egen session), admin (deaktivering, MFA-nulstilling), system (oprydning, nyt password).';

-- TrustedDevice -------------------------------------------------------------------------------------------------
ALTER TABLE "TrustedDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrustedDevice" FORCE ROW LEVEL SECURITY;
CREATE POLICY trusted_device_select ON "TrustedDevice" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "userId" = rls.app_user_id());
COMMENT ON POLICY trusted_device_select ON "TrustedDevice" IS 'Egne enheder (Konto), admin (antal under Administratorer), system (login med betroet enhed).';
CREATE POLICY trusted_device_insert ON "TrustedDevice" FOR INSERT WITH CHECK (rls.app_is_system());
COMMENT ON POLICY trusted_device_insert ON "TrustedDevice" IS 'Kun efter en godkendt kode (completeSecondFactor, systemkontekst).';
CREATE POLICY trusted_device_update ON "TrustedDevice" FOR UPDATE USING (rls.app_is_system()) WITH CHECK (rls.app_is_system());
COMMENT ON POLICY trusted_device_update ON "TrustedDevice" IS 'Kun «senest brugt» ved login (systemkontekst).';
CREATE POLICY trusted_device_delete ON "TrustedDevice" FOR DELETE
  USING (rls.app_is_system() OR rls.app_is_admin() OR "userId" = rls.app_user_id());
COMMENT ON POLICY trusted_device_delete ON "TrustedDevice" IS 'Brugeren fjerner egne enheder; admin tilbagekalder andres; system (oprydning, nyt password).';

-- MfaRecoveryCode -----------------------------------------------------------------------------------------------
ALTER TABLE "MfaRecoveryCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MfaRecoveryCode" FORCE ROW LEVEL SECURITY;
CREATE POLICY mfa_recovery_code_select ON "MfaRecoveryCode" FOR SELECT USING (rls.app_is_system() OR "userId" = rls.app_user_id());
COMMENT ON POLICY mfa_recovery_code_select ON "MfaRecoveryCode" IS 'Antal tilbage (Konto) for brugeren selv; verifikation i systemkontekst.';
CREATE POLICY mfa_recovery_code_write ON "MfaRecoveryCode" FOR ALL USING (rls.app_is_system()) WITH CHECK (rls.app_is_system());
COMMENT ON POLICY mfa_recovery_code_write ON "MfaRecoveryCode" IS 'Kun auth-internt (opsætning, brug, nulstilling – mfa/service.ts).';

-- PasswordToken -------------------------------------------------------------------------------------------------
ALTER TABLE "PasswordToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY password_token_all ON "PasswordToken" FOR ALL
  USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY password_token_all ON "PasswordToken" IS 'Admin udsteder invitationer; opslag på tokenets hash og nulstilling i systemkontekst.';

-- AdvisorProfile ------------------------------------------------------------------------------------------------
ALTER TABLE "AdvisorProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdvisorProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY advisor_profile_select ON "AdvisorProfile" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "userId" = rls.app_user_id()
         OR (active AND rls.app_has_context())
         OR "userId" IN (SELECT rls.app_board_peer_ids()));
COMMENT ON POLICY advisor_profile_select ON "AdvisorProfile" IS 'Aktive profiler er offentlige (onboarding-katalog og fotos, canViewAvatar); egen profil; board-/mødekolleger; admin; system.';
CREATE POLICY advisor_profile_insert ON "AdvisorProfile" FOR INSERT WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY advisor_profile_insert ON "AdvisorProfile" IS 'Admin opretter rådgivere (createAdvisorAction).';
CREATE POLICY advisor_profile_update ON "AdvisorProfile" FOR UPDATE
  USING (rls.app_is_system() OR rls.app_is_admin() OR ("userId" = rls.app_user_id() AND rls.app_role() = 'ADVISOR'))
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR ("userId" = rls.app_user_id() AND rls.app_role() = 'ADVISOR'));
COMMENT ON POLICY advisor_profile_update ON "AdvisorProfile" IS 'Rådgiveren selv (titel, bio, foto – advisor_profile_self_update_guard), admin (pris, aktivering), system.';
CREATE POLICY advisor_profile_delete ON "AdvisorProfile" FOR DELETE USING (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY advisor_profile_delete ON "AdvisorProfile" IS 'Kun admin/system (sletning sker med kaskaden fra User).';

-- Tag -------------------------------------------------------------------------------------------------------------
ALTER TABLE "Tag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tag" FORCE ROW LEVEL SECURITY;
CREATE POLICY tag_select ON "Tag" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR (kind = 'COMPETENCE' AND rls.app_has_context()));
COMMENT ON POLICY tag_select ON "Tag" IS 'Kompetence-tags er offentlige (katalog, matching); admin-tags (fx «Lead-kvalificeret») kun admin/system.';
CREATE POLICY tag_write ON "Tag" FOR ALL USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY tag_write ON "Tag" IS 'Kun admin (Admin → Tags) og system (seed).';

-- AdvisorTag ----------------------------------------------------------------------------------------------------
ALTER TABLE "AdvisorTag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdvisorTag" FORCE ROW LEVEL SECURITY;
CREATE POLICY advisor_tag_select ON "AdvisorTag" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin()
         OR (rls.app_has_context() AND "tagId" IN (SELECT t.id FROM "Tag" t WHERE t.kind = 'COMPETENCE')));
COMMENT ON POLICY advisor_tag_select ON "AdvisorTag" IS 'Rådgiveres kompetence-tags er offentlige; admin-tags kun admin/system (leadEligible via rls.lead_eligible_ids).';
CREATE POLICY advisor_tag_write ON "AdvisorTag" FOR ALL USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY advisor_tag_write ON "AdvisorTag" IS 'Kun admin (updateAdvisorAction) og system.';

-- OnboardingQuestion / OnboardingAnswer / AnswerTagWeight ---------------------------------------------------------
ALTER TABLE "OnboardingQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnboardingQuestion" FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_question_select ON "OnboardingQuestion" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR (active AND rls.app_has_context()));
COMMENT ON POLICY onboarding_question_select ON "OnboardingQuestion" IS 'Aktive spørgsmål til testen før login (loadActiveQuestions); alle for admin (CMS).';
CREATE POLICY onboarding_question_write ON "OnboardingQuestion" FOR ALL USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY onboarding_question_write ON "OnboardingQuestion" IS 'Kun admin (onboarding-CMS) og system (seed).';

ALTER TABLE "OnboardingAnswer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnboardingAnswer" FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_answer_select ON "OnboardingAnswer" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin()
         OR (rls.app_has_context() AND "questionId" IN (SELECT q.id FROM "OnboardingQuestion" q WHERE q.active)));
COMMENT ON POLICY onboarding_answer_select ON "OnboardingAnswer" IS 'Svar på aktive spørgsmål (testen før login); alle for admin.';
CREATE POLICY onboarding_answer_write ON "OnboardingAnswer" FOR ALL USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY onboarding_answer_write ON "OnboardingAnswer" IS 'Kun admin (onboarding-CMS) og system (seed).';

ALTER TABLE "AnswerTagWeight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnswerTagWeight" FORCE ROW LEVEL SECURITY;
CREATE POLICY answer_tag_weight_select ON "AnswerTagWeight" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin()
         OR (rls.app_has_context() AND "answerId" IN (SELECT a.id FROM "OnboardingAnswer" a) AND "tagId" IN (SELECT t.id FROM "Tag" t)));
COMMENT ON POLICY answer_tag_weight_select ON "AnswerTagWeight" IS 'Vægte på synlige svar og synlige (kompetence-)tags – matching før login; alle for admin.';
CREATE POLICY answer_tag_weight_write ON "AnswerTagWeight" FOR ALL USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY answer_tag_weight_write ON "AnswerTagWeight" IS 'Kun admin (setAnswerWeightAction) og system (seed).';

-- ContentBlock / NotificationTemplate / NotificationRule / AppSetting ----------------------------------------------
ALTER TABLE "ContentBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContentBlock" FORCE ROW LEVEL SECURITY;
CREATE POLICY content_block_select ON "ContentBlock" FOR SELECT USING (rls.app_has_context());
COMMENT ON POLICY content_block_select ON "ContentBlock" IS 'Redigerbare tekster og samtykketekster vises før login (getOnboardingTexts, currentConsent).';
CREATE POLICY content_block_write ON "ContentBlock" FOR ALL USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY content_block_write ON "ContentBlock" IS 'Kun admin (saveTextAction).';

ALTER TABLE "NotificationTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_template_all ON "NotificationTemplate" FOR ALL
  USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY notification_template_all ON "NotificationTemplate" IS 'Admin (CMS) og system (notifikationsmotoren). Intet før login.';

ALTER TABLE "NotificationRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_rule_all ON "NotificationRule" FOR ALL
  USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY notification_rule_all ON "NotificationRule" IS 'Admin (CMS) og system (notifikationsmotoren). Intet før login.';

ALTER TABLE "AppSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppSetting" FORCE ROW LEVEL SECURITY;
CREATE POLICY app_setting_select ON "AppSetting" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR (rls.app_has_context() AND "key" NOT LIKE 'alert:%'));
COMMENT ON POLICY app_setting_select ON "AppSetting" IS 'Indstillinger, som login/booking læser (betroede dage, helligdage …); driftsalarmer (alert:*) kun admin/system.';
CREATE POLICY app_setting_write ON "AppSetting" FOR ALL USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY app_setting_write ON "AppSetting" IS 'Admin (indstillinger) og system (alarmer).';

-- OnboardingSession / Lead / MarketingConsent ---------------------------------------------------------------------
ALTER TABLE "OnboardingSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnboardingSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_session_select ON "OnboardingSession" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "tokenHash" = rls.app_onboarding_token());
COMMENT ON POLICY onboarding_session_select ON "OnboardingSession" IS 'Egen tilmelding (cookiens hash = app.onboarding_token); admin (status i Leads); system (oprydning, GDPR).';
CREATE POLICY onboarding_session_insert ON "OnboardingSession" FOR INSERT
  WITH CHECK (rls.app_is_system() OR "tokenHash" = rls.app_onboarding_token());
COMMENT ON POLICY onboarding_session_insert ON "OnboardingSession" IS 'Trin 1 opretter egen tilmelding (createOnboardingSession sætter først det nye token i konteksten).';
CREATE POLICY onboarding_session_update ON "OnboardingSession" FOR UPDATE
  USING (rls.app_is_system() OR "tokenHash" = rls.app_onboarding_token())
  WITH CHECK (rls.app_is_system() OR "tokenHash" = rls.app_onboarding_token());
COMMENT ON POLICY onboarding_session_update ON "OnboardingSession" IS 'Trin 2-6 opdaterer egen tilmelding.';
CREATE POLICY onboarding_session_delete ON "OnboardingSession" FOR DELETE
  USING (rls.app_is_system() OR "tokenHash" = rls.app_onboarding_token());
COMMENT ON POLICY onboarding_session_delete ON "OnboardingSession" IS 'Egen tilmelding (udløbet/afsluttet); system (oprydning, GDPR).';

ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_select ON "Lead" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin()
         OR id IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token()));
COMMENT ON POLICY lead_select ON "Lead" IS 'Admin (Leads, CSV); egen tilmeldings lead; system (opfølgning, oprydning).';
CREATE POLICY lead_insert ON "Lead" FOR INSERT WITH CHECK (rls.app_is_system());
COMMENT ON POLICY lead_insert ON "Lead" IS 'Trin 1 via rls.capture_onboarding_lead (token-scoped, knyttes til egen tilmelding); ellers kun system.';
CREATE POLICY lead_update ON "Lead" FOR UPDATE
  USING (rls.app_is_system() OR id IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token()))
  WITH CHECK (rls.app_is_system() OR id IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token()));
COMMENT ON POLICY lead_update ON "Lead" IS 'Egen tilmeldings lead (trin, telefon, konvertering); system.';
CREATE POLICY lead_delete ON "Lead" FOR DELETE
  USING (rls.app_is_system() OR rls.app_is_admin() OR id IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token()));
COMMENT ON POLICY lead_delete ON "Lead" IS 'Egen tilmeldings lead uden samtykke (convertLead); admin (GDPR-sletning); system (oprydning).';

ALTER TABLE "MarketingConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingConsent" FORCE ROW LEVEL SECURITY;
CREATE POLICY marketing_consent_select ON "MarketingConsent" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "userId" = rls.app_user_id()
         OR "leadId" IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token()));
COMMENT ON POLICY marketing_consent_select ON "MarketingConsent" IS 'Eget samtykke (Konto), egen tilmeldings lead, admin (Leads), system (afsendelse, afmelding).';
CREATE POLICY marketing_consent_insert ON "MarketingConsent" FOR INSERT
  WITH CHECK (rls.app_is_system()
              OR "leadId" IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token()));
COMMENT ON POLICY marketing_consent_insert ON "MarketingConsent" IS 'Trin 1: anon registrerer samtykke for egen tilmeldings lead; system.';
CREATE POLICY marketing_consent_update ON "MarketingConsent" FOR UPDATE
  USING (rls.app_is_system() OR "userId" = rls.app_user_id()
         OR "leadId" IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token()))
  WITH CHECK (rls.app_is_system() OR "userId" = rls.app_user_id()
         OR "leadId" IN (SELECT o."leadId" FROM "OnboardingSession" o WHERE o."tokenHash" = rls.app_onboarding_token()));
COMMENT ON POLICY marketing_consent_update ON "MarketingConsent" IS 'Tilbagetrækning (Konto), egen tilmelding (trin 1 og konvertering), system (afmeldingslink, STOP).';
CREATE POLICY marketing_consent_delete ON "MarketingConsent" FOR DELETE USING (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY marketing_consent_delete ON "MarketingConsent" IS 'GDPR-sletning (admin) og system.';

-- CustomerProfile -------------------------------------------------------------------------------------------------
ALTER TABLE "CustomerProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_profile_select ON "CustomerProfile" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "userId" = rls.app_user_id() OR "userId" IN (SELECT rls.app_board_peer_ids()));
COMMENT ON POLICY customer_profile_select ON "CustomerProfile" IS 'Kunden selv; rådgivere i kundens boards/møder (virksomhedsnavn på dashboard og mødeside); admin; system.';
CREATE POLICY customer_profile_write ON "CustomerProfile" FOR ALL
  USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY customer_profile_write ON "CustomerProfile" IS 'Oprettes ved tilmelding (systemkontekst); ingen selvbetjent ændring i appen.';

-- Subscription / SubscriptionAdvisor ------------------------------------------------------------------------------
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_select ON "Subscription" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "customerId" = rls.app_user_id()
         OR id IN (SELECT rls.app_advisor_subscription_ids()));
COMMENT ON POLICY subscription_select ON "Subscription" IS 'Kunden (getCustomerSubscription), rådgivere i boardet (dashboard «Dine boards»), admin, system (webhooks).';
CREATE POLICY subscription_insert ON "Subscription" FOR INSERT
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR ("customerId" = rls.app_user_id() AND rls.app_role() = 'CUSTOMER'));
COMMENT ON POLICY subscription_insert ON "Subscription" IS 'Kunden starter betaling for sig selv (startCheckout); system (seed).';
CREATE POLICY subscription_update ON "Subscription" FOR UPDATE
  USING (rls.app_is_system() OR rls.app_is_admin() OR ("customerId" = rls.app_user_id() AND rls.app_role() = 'CUSTOMER'))
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR ("customerId" = rls.app_user_id() AND rls.app_role() = 'CUSTOMER'));
COMMENT ON POLICY subscription_update ON "Subscription" IS 'Kunden (planskift, opsigelse, mock-betaling), admin (board), system (betalingswebhook).';
CREATE POLICY subscription_delete ON "Subscription" FOR DELETE
  USING (rls.app_is_system() OR rls.app_is_admin() OR ("customerId" = rls.app_user_id() AND rls.app_role() = 'CUSTOMER' AND status = 'PENDING'));
COMMENT ON POLICY subscription_delete ON "Subscription" IS 'Kunden sletter kun egne afventende forsøg (startCheckout); admin/system.';

ALTER TABLE "SubscriptionAdvisor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubscriptionAdvisor" FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_advisor_select ON "SubscriptionAdvisor" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin()
         OR "subscriptionId" IN (SELECT rls.app_customer_subscription_ids())
         OR "subscriptionId" IN (SELECT rls.app_advisor_subscription_ids()));
COMMENT ON POLICY subscription_advisor_select ON "SubscriptionAdvisor" IS 'Boardets medlemmer for kunden og for rådgiverne i boardet (ansvarlig rådgiver); admin; system.';
CREATE POLICY subscription_advisor_write ON "SubscriptionAdvisor" FOR ALL
  USING (rls.app_is_system() OR rls.app_is_admin() OR "subscriptionId" IN (SELECT rls.app_customer_subscription_ids()))
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR rls.app_is_customer_of_subscription("subscriptionId"));
COMMENT ON POLICY subscription_advisor_write ON "SubscriptionAdvisor" IS 'Kunden sammensætter/skifter eget board og får tildelt ansvarlig (checkout, changePlanAction); admin; system.';

-- Meeting / MeetingParticipant / Recording / Transcript -----------------------------------------------------------
ALTER TABLE "Meeting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Meeting" FORCE ROW LEVEL SECURITY;
CREATE POLICY meeting_select ON "Meeting" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin()
         OR "subscriptionId" IN (SELECT rls.app_customer_subscription_ids())
         OR id IN (SELECT mp."meetingId" FROM "MeetingParticipant" mp WHERE mp."userId" = rls.app_user_id()));
COMMENT ON POLICY meeting_select ON "Meeting" IS 'canAccessMeeting: deltagere og admin – plus kunden på abonnementet; system (jobs, pipeline).';
CREATE POLICY meeting_insert ON "Meeting" FOR INSERT
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR rls.app_is_customer_of_subscription("subscriptionId"));
COMMENT ON POLICY meeting_insert ON "Meeting" IS 'Kunden booker på eget abonnement (bookMeeting); admin; system.';
CREATE POLICY meeting_update ON "Meeting" FOR UPDATE
  USING (rls.app_is_system() OR rls.app_is_admin() OR "subscriptionId" IN (SELECT rls.app_customer_subscription_ids()))
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR rls.app_is_customer_of_subscription("subscriptionId"));
COMMENT ON POLICY meeting_update ON "Meeting" IS 'Kunden (videorum efter booking, aflysning – cancelMeetingAction), admin (flyt/udskift), system (afholdt, pipeline).';
CREATE POLICY meeting_delete ON "Meeting" FOR DELETE
  USING (rls.app_is_system() OR rls.app_is_admin() OR "subscriptionId" IN (SELECT rls.app_customer_subscription_ids()));
COMMENT ON POLICY meeting_delete ON "Meeting" IS 'Kunden ruller sin booking tilbage, hvis videorummet fejler (bookMeeting); admin; system.';

ALTER TABLE "MeetingParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MeetingParticipant" FORCE ROW LEVEL SECURITY;
CREATE POLICY meeting_participant_select ON "MeetingParticipant" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "userId" = rls.app_user_id() OR "meetingId" IN (SELECT rls.app_meeting_ids()));
COMMENT ON POLICY meeting_participant_select ON "MeetingParticipant" IS 'Egen deltagelse og deltagerlisten for møder, man har adgang til; admin; system.';
CREATE POLICY meeting_participant_insert ON "MeetingParticipant" FOR INSERT
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR rls.app_is_customer_of_meeting("meetingId"));
COMMENT ON POLICY meeting_participant_insert ON "MeetingParticipant" IS 'Kunden tilføjer sig selv og boardet ved booking; admin (udskift rådgiver); system.';
CREATE POLICY meeting_participant_update ON "MeetingParticipant" FOR UPDATE
  USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY meeting_participant_update ON "MeetingParticipant" IS 'Kun admin/system.';
CREATE POLICY meeting_participant_delete ON "MeetingParticipant" FOR DELETE USING (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY meeting_participant_delete ON "MeetingParticipant" IS 'Kun admin (udskift/fjern rådgiver) og system.';

ALTER TABLE "Recording" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Recording" FORCE ROW LEVEL SECURITY;
CREATE POLICY recording_select ON "Recording" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "meetingId" IN (SELECT rls.app_meeting_ids()));
COMMENT ON POLICY recording_select ON "Recording" IS 'Status for møder, man har adgang til (mødeside); admin; system (pipeline).';
CREATE POLICY recording_insert ON "Recording" FOR INSERT
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin()
              OR (rls.app_role() = 'ADVISOR' AND "uploadedById" = rls.app_user_id() AND rls.app_is_participant_of_meeting("meetingId")));
COMMENT ON POLICY recording_insert ON "Recording" IS 'Deltagende rådgiver uploader (prepareRecordingUpload); admin; system (videowebhook).';
CREATE POLICY recording_update ON "Recording" FOR UPDATE
  USING (rls.app_is_system() OR rls.app_is_admin() OR (rls.app_role() = 'ADVISOR' AND "uploadedById" = rls.app_user_id()))
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR (rls.app_role() = 'ADVISOR' AND "uploadedById" = rls.app_user_id()));
COMMENT ON POLICY recording_update ON "Recording" IS 'Uploaderen afslutter egen upload; admin (prøv igen); system (pipeline).';
CREATE POLICY recording_delete ON "Recording" FOR DELETE
  USING (rls.app_is_system() OR rls.app_is_admin() OR (rls.app_role() = 'ADVISOR' AND "uploadedById" = rls.app_user_id()));
COMMENT ON POLICY recording_delete ON "Recording" IS 'Uploaderen afbryder/kasserer egen upload; admin; system (oprydning).';

ALTER TABLE "Transcript" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transcript" FORCE ROW LEVEL SECURITY;
CREATE POLICY transcript_select ON "Transcript" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "meetingId" IN (SELECT rls.app_meeting_ids()));
COMMENT ON POLICY transcript_select ON "Transcript" IS 'Mødesiden og dataeksporten for møder, man har adgang til; admin; system.';
CREATE POLICY transcript_write ON "Transcript" FOR ALL USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY transcript_write ON "Transcript" IS 'Kun transskriptions-pipelinen (system) og admin.';

-- AvailabilityRule / AvailabilityBlock ----------------------------------------------------------------------------
ALTER TABLE "AvailabilityRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AvailabilityRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY availability_rule_select ON "AvailabilityRule" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "advisorId" = rls.app_user_id() OR "advisorId" IN (SELECT rls.app_board_advisor_ids()));
COMMENT ON POLICY availability_rule_select ON "AvailabilityRule" IS 'Rådgiveren selv; kunder for rådgiverne i deres board (ledige tider); admin; system.';
CREATE POLICY availability_rule_write ON "AvailabilityRule" FOR ALL
  USING (rls.app_is_system() OR rls.app_is_admin() OR ("advisorId" = rls.app_user_id() AND rls.app_role() = 'ADVISOR'))
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR ("advisorId" = rls.app_user_id() AND rls.app_role() = 'ADVISOR'));
COMMENT ON POLICY availability_rule_write ON "AvailabilityRule" IS 'Kun rådgiveren selv (requireRole("ADVISOR"), advisorId = bruger), admin, system.';

ALTER TABLE "AvailabilityBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AvailabilityBlock" FORCE ROW LEVEL SECURITY;
CREATE POLICY availability_block_select ON "AvailabilityBlock" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "advisorId" = rls.app_user_id() OR "advisorId" IN (SELECT rls.app_board_advisor_ids()));
COMMENT ON POLICY availability_block_select ON "AvailabilityBlock" IS 'Rådgiveren selv; kunder for rådgiverne i deres board (ledige tider); admin; system.';
CREATE POLICY availability_block_write ON "AvailabilityBlock" FOR ALL
  USING (rls.app_is_system() OR rls.app_is_admin() OR ("advisorId" = rls.app_user_id() AND rls.app_role() = 'ADVISOR'))
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin() OR ("advisorId" = rls.app_user_id() AND rls.app_role() = 'ADVISOR'));
COMMENT ON POLICY availability_block_write ON "AvailabilityBlock" IS 'Kun rådgiveren selv (fravær), admin, system.';

-- NotificationLog / AuditLog --------------------------------------------------------------------------------------
ALTER TABLE "NotificationLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_log_select ON "NotificationLog" FOR SELECT
  USING (rls.app_is_system() OR rls.app_is_admin() OR "recipientUserId" = rls.app_user_id());
COMMENT ON POLICY notification_log_select ON "NotificationLog" IS 'Modtageren selv (dataeksport), admin (log i CMS), system.';
CREATE POLICY notification_log_write ON "NotificationLog" FOR ALL
  USING (rls.app_is_system() OR rls.app_is_admin()) WITH CHECK (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY notification_log_write ON "NotificationLog" IS 'Notifikationsmotoren (system); admin (send igen, testbesked).';

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_select ON "AuditLog" FOR SELECT USING (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY audit_log_select ON "AuditLog" IS 'Kun admin (mødeside, kunder) og system (egen dataeksport).';
CREATE POLICY audit_log_insert ON "AuditLog" FOR INSERT
  WITH CHECK (rls.app_is_system()
              OR (rls.app_role() IN ('ADMIN', 'ADVISOR', 'CUSTOMER') AND rls.app_user_id() IS NOT NULL
                  AND ("userId" IS NULL OR "userId" = rls.app_user_id())));
COMMENT ON POLICY audit_log_insert ON "AuditLog" IS 'Append-only (UPDATE/DELETE er taget fra app-rollerne i fase 0): enhver indlogget bruger logger egne handlinger; system alt. Ingen UPDATE/DELETE-politik.';

-- Systemtabeller ------------------------------------------------------------------------------------------------
ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_event_all ON "WebhookEvent" FOR ALL USING (rls.app_is_system()) WITH CHECK (rls.app_is_system());
COMMENT ON POLICY webhook_event_all ON "WebhookEvent" IS 'Kun system (webhooks, oprydning, GDPR-sletning).';

ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Job" FORCE ROW LEVEL SECURITY;
CREATE POLICY job_select ON "Job" FOR SELECT USING (rls.app_is_system() OR rls.app_is_admin());
COMMENT ON POLICY job_select ON "Job" IS 'System (jobkøen); admin læser antal ventende/fejlede på forsiden.';
CREATE POLICY job_write ON "Job" FOR ALL USING (rls.app_is_system()) WITH CHECK (rls.app_is_system());
COMMENT ON POLICY job_write ON "Job" IS 'Kun system (enqueueJob og jobprocessoren kører i systemkontekst).';

ALTER TABLE "RateLimit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimit" FORCE ROW LEVEL SECURITY;
CREATE POLICY rate_limit_all ON "RateLimit" FOR ALL USING (rls.app_is_system()) WITH CHECK (rls.app_is_system());
COMMENT ON POLICY rate_limit_all ON "RateLimit" IS 'Kun system (oprydning); alle andre kontekster via rls.rate_limit_hit/rate_limit_reset.';

ALTER TABLE "CvrLookupCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CvrLookupCache" FORCE ROW LEVEL SECURITY;
CREATE POLICY cvr_lookup_cache_all ON "CvrLookupCache" FOR ALL USING (rls.app_is_system()) WITH CHECK (rls.app_is_system());
COMMENT ON POLICY cvr_lookup_cache_all ON "CvrLookupCache" IS 'Kun system (lookupCvr kører cachen i systemkontekst).';

ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_key_all ON "IdempotencyKey" FOR ALL USING (rls.app_is_system()) WITH CHECK (rls.app_is_system());
COMMENT ON POLICY idempotency_key_all ON "IdempotencyKey" IS 'Kun system (withIdempotency kører nøglerne i systemkontekst; handlingen selv i kalderens kontekst).';

-- ------------------------------------------------------------------------------------------------ Rettigheder
-- Funktioner: intet til PUBLIC, EXECUTE til app-rollerne (også for fremtidige funktioner i schema rls).
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rls FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA rls REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $grants$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['abu_app', 'abu_jobs'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA rls TO %I', r);
      EXECUTE pg_catalog.format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rls TO %I', r);
      EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES IN SCHEMA rls GRANT EXECUTE ON FUNCTIONS TO %I', r);
      -- Kolonnerettigheder (gælder hele rollen): en brugers identitet (id, e-mail, rolle, oprettet) ændres aldrig af appen
      EXECUTE pg_catalog.format('REVOKE UPDATE ON TABLE "User" FROM %I', r);
      EXECUTE pg_catalog.format(
        'GRANT UPDATE (%s) ON TABLE "User" TO %I',
        (SELECT pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
           FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = '"User"'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND a.attname NOT IN ('id', 'email', 'role', 'createdAt')),
        r);
    END IF;
  END LOOP;
END
$grants$;

-- ------------------------------------------------------------------------------------------------ Kontrol
-- Migrationen fejler, hvis en tabel i public mangler ENABLE/FORCE (tests tjekker det samme løbende).
DO $check$
DECLARE
  missing text;
BEGIN
  SELECT pg_catalog.string_agg(c.relname, ', ') INTO missing
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS mangler på: %', missing;
  END IF;
END
$check$;
