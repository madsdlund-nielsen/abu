-- =============================================================================================================
-- R-3 (docs/SECURITY-AUDIT-MFA-RLS.md): rls.advisor_busy giver kun det, beregningen af ledige tider bruger:
-- start/slut for møder, der optager kalenderen (BOOKED, COMPLETED – ADVISOR_BLOCKING_STATUSES i
-- src/lib/meeting-status.ts), i et afgrænset vindue. Ingen status, ingen mødeid'er, ingen kunder.
--  * Kunde/rådgiver: vinduet klippes til [nu − 1 dag, nu + 16 uger + 2 dage] (bookingvinduet i src/lib/slots.ts:
--    maxWeeksAhead = 16, plus loadAvailability's margen på et døgn og mødets længde).
--  * Admin/system (flyt/udskift et konkret møde – også et afholdt): højst 20 ugers vindue.
--  * Argumenterne valideres: 1–20 rådgivere uden NULL, from < to.
-- =============================================================================================================
DROP FUNCTION IF EXISTS rls.advisor_busy(text[], timestamp(3), timestamp(3), text);

CREATE OR REPLACE FUNCTION rls.advisor_busy(p_ids text[], p_from timestamp(3), p_to timestamp(3), p_exclude_meeting text)
  RETURNS TABLE (advisor_id text, starts_at timestamp(3), ends_at timestamp(3))
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_now timestamp(3) := (pg_catalog.now() AT TIME ZONE 'UTC');
  v_from timestamp(3) := p_from;
  v_to timestamp(3) := p_to;
  v_privileged boolean := rls.app_is_admin() OR rls.app_caller_is_system();
BEGIN
  IF rls.app_role() IS NULL THEN
    RAISE EXCEPTION 'RLS: ingen databasekontekst' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL OR pg_catalog.cardinality(p_ids) = 0 OR pg_catalog.cardinality(p_ids) > 20 OR pg_catalog.array_position(p_ids, NULL) IS NOT NULL
     OR p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'Ugyldige argumenter til rls.advisor_busy' USING ERRCODE = '22023';
  END IF;
  IF NOT v_privileged
     AND EXISTS (SELECT 1 FROM pg_catalog.unnest(p_ids) AS x(id)
                  WHERE x.id IS DISTINCT FROM rls.app_user_id() AND x.id NOT IN (SELECT rls.app_board_advisor_ids())) THEN
    RAISE EXCEPTION 'RLS: ingen adgang til rådgivernes kalender' USING ERRCODE = '42501';
  END IF;
  IF v_privileged THEN
    IF p_to - p_from > interval '20 weeks' THEN
      RAISE EXCEPTION 'RLS: for langt vindue til rls.advisor_busy' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_from := GREATEST(p_from, v_now - interval '1 day');
    v_to := LEAST(p_to, v_now + interval '16 weeks' + interval '2 days');
    IF v_from >= v_to THEN
      RETURN;
    END IF;
  END IF;
  RETURN QUERY
    SELECT mp."userId", m."startsAt", m."endsAt"
      FROM public."MeetingParticipant" mp JOIN public."Meeting" m ON m.id = mp."meetingId"
     WHERE mp."userId" = ANY (p_ids)
       AND m.status IN ('BOOKED', 'COMPLETED')
       AND m."endsAt" > v_from AND m."startsAt" < v_to
       AND (p_exclude_meeting IS NULL OR m.id <> p_exclude_meeting);
END
$$;
COMMENT ON FUNCTION rls.advisor_busy(text[], timestamp(3), timestamp(3), text) IS 'R-3: optagne tider (kun start/slut for BOOKED/COMPLETED) i et afgrænset vindue; kunde: egne boardrådgivere, rådgiver: sig selv, admin/system: alle.';

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
