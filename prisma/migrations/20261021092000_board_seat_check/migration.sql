-- =============================================================================================================
-- R-1 (docs/SECURITY-AUDIT-MFA-RLS.md): kunden kan kun sætte aktive, valgbare rådgivere i sit board – med rådgiverens
-- aktuelle mødepris – og kun en rådgiver med lead-tagget som ansvarlig. Det spejler resolveBoard
-- (src/lib/onboarding/board.ts: aktive profiler, prisen fra profilen) og assignLeadTx/leadEligibleIds (src/lib/lead.ts).
-- Admin og system sammensætter boards frit (board-admin.ts).
-- =============================================================================================================

-- Kan rådgiveren vælges (aktiv profil – som kataloget og resolveBoard)? Kun en boolean.
CREATE OR REPLACE FUNCTION rls.advisor_is_selectable(p_advisor_id text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT EXISTS (SELECT 1 FROM public."AdvisorProfile" p WHERE p."userId" = p_advisor_id AND p.active) $$;
COMMENT ON FUNCTION rls.advisor_is_selectable(text) IS 'R-1: aktiv, valgbar rådgiver (resolveBoard).';

-- En kundes plads i boardet: valgbar rådgiver, fastfrosset pris = rådgiverens aktuelle pris, og ansvarlig kun med
-- lead-tagget (de felter, kunden ellers ville kunne sætte selv: pris og ansvar, er admin-data).
CREATE OR REPLACE FUNCTION rls.board_seat_allowed(p_advisor_id text, p_price integer, p_is_lead boolean) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT EXISTS (
     SELECT 1 FROM public."AdvisorProfile" p
      WHERE p."userId" = p_advisor_id AND p.active AND p."pricePerMeetingDkk" = p_price
        AND (NOT coalesce(p_is_lead, false)
             OR EXISTS (SELECT 1 FROM public."AdvisorTag" at JOIN public."Tag" t ON t.id = at."tagId"
                         WHERE at."advisorId" = p."userId" AND t."systemKey" = 'lead'))) $$;
COMMENT ON FUNCTION rls.board_seat_allowed(text, integer, boolean) IS 'R-1: kundens boardplads – aktiv rådgiver, aktuel pris, ansvarlig kun med lead-tagget.';

DROP POLICY IF EXISTS subscription_advisor_write ON "SubscriptionAdvisor";
CREATE POLICY subscription_advisor_insert ON "SubscriptionAdvisor" FOR INSERT
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin()
              OR (rls.app_role() = 'CUSTOMER' AND rls.app_is_customer_of_subscription("subscriptionId")
                  AND rls.board_seat_allowed("advisorId", "pricePerMeetingDkk", "isLead")));
COMMENT ON POLICY subscription_advisor_insert ON "SubscriptionAdvisor" IS 'Kunden sammensætter eget board (checkout, changePlanAction) – kun aktive rådgivere til aktuel pris, ansvarlig kun med lead-tag (R-1); admin; system.';
CREATE POLICY subscription_advisor_update ON "SubscriptionAdvisor" FOR UPDATE
  USING (rls.app_is_system() OR rls.app_is_admin()
         OR (rls.app_role() = 'CUSTOMER' AND "subscriptionId" IN (SELECT rls.app_customer_subscription_ids())))
  WITH CHECK (rls.app_is_system() OR rls.app_is_admin()
              OR (rls.app_role() = 'CUSTOMER' AND rls.app_is_customer_of_subscription("subscriptionId")
                  AND rls.board_seat_allowed("advisorId", "pricePerMeetingDkk", "isLead")));
COMMENT ON POLICY subscription_advisor_update ON "SubscriptionAdvisor" IS 'Tildeling af ansvarlig ved køb/planskift (assignLeadTx) – samme regler som indsættelse (R-1); admin; system.';
CREATE POLICY subscription_advisor_delete ON "SubscriptionAdvisor" FOR DELETE
  USING (rls.app_is_system() OR rls.app_is_admin()
         OR (rls.app_role() = 'CUSTOMER' AND "subscriptionId" IN (SELECT rls.app_customer_subscription_ids())));
COMMENT ON POLICY subscription_advisor_delete ON "SubscriptionAdvisor" IS 'Kunden skifter eget board (changePlanAction); admin; system.';

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
