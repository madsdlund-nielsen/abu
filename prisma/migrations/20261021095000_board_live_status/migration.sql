-- =============================================================================================================
-- R-4 (docs/SECURITY-AUDIT-MFA-RLS.md): board-relationen (kunde ↔ rådgivere, rådgiver ↔ medrådgivere) gælder kun for
-- levende abonnementer (PENDING, ACTIVE, PAST_DUE – som LIVE_STATUSES i src/lib/lead.ts). Efter opsigelse (CANCELLED)
-- ser parterne ikke længere hinandens profil, tilgængelighed, fravær eller optagne tider. Fælles møder (også afholdte)
-- giver stadig navnene på deltagerne (mødesiden, historik).
-- =============================================================================================================
CREATE OR REPLACE FUNCTION rls.app_board_advisor_ids() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT sa."advisorId" FROM public."SubscriptionAdvisor" sa JOIN public."Subscription" s ON s.id = sa."subscriptionId"
    WHERE s."customerId" = rls.app_user_id() AND s.status IN ('PENDING', 'ACTIVE', 'PAST_DUE') $$;

CREATE OR REPLACE FUNCTION rls.app_board_peer_ids() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ WITH me AS (SELECT rls.app_user_id() AS id),
        boards AS (
          SELECT s.id FROM public."Subscription" s, me
           WHERE s."customerId" = me.id AND s.status IN ('PENDING', 'ACTIVE', 'PAST_DUE')
          UNION
          SELECT sa."subscriptionId" FROM public."SubscriptionAdvisor" sa JOIN public."Subscription" s ON s.id = sa."subscriptionId", me
           WHERE sa."advisorId" = me.id AND s.status IN ('PENDING', 'ACTIVE', 'PAST_DUE'))
   SELECT s."customerId" FROM public."Subscription" s WHERE s.id IN (SELECT id FROM boards)
   UNION SELECT sa."advisorId" FROM public."SubscriptionAdvisor" sa WHERE sa."subscriptionId" IN (SELECT id FROM boards)
   UNION SELECT other."userId" FROM public."MeetingParticipant" mine
           JOIN public."MeetingParticipant" other ON other."meetingId" = mine."meetingId", me
          WHERE mine."userId" = me.id $$;
COMMENT ON FUNCTION rls.app_board_peer_ids() IS 'R-4: kolleger i levende boards (ikke CANCELLED) og deltagere i fælles møder.';
