-- =====================================================================
-- v4_030_security.sql
-- Production security hardening for the KOL prediction-market backend.
--
-- Remediates Supabase security advisor findings (database linter):
--   * 0028 anon_security_definer_function_executable
--   * 0029 authenticated_security_definer_function_executable
--
-- Goals:
--   1. Remove the retired CLOB order-book RPC entirely.
--   2. Leave ZERO anon/authenticated-executable mutation-capable RPCs in
--      the exposed `public` schema.
--   3. Keep a defence-in-depth RLS posture (RLS on + restrictive policies)
--      on the sensitive `pm_bets` and `pm_protocol_fees` tables.
--   4. Pin search_path on remaining SECURITY DEFINER functions.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Drop the retired CLOB order-book function.
--
--    The central limit order book was retired in favour of the
--    parimutuel pool engine. The HTTP endpoint
--    (app/api/pm/outcomes/[outcomeId]/orderbook/route.ts) now returns
--    410 Gone and nothing in the app calls this RPC. It only existed as
--    an anon-executable SECURITY DEFINER function reading public.orders,
--    so we remove it outright. This clears the two advisor findings
--    (anon + authenticated) attached to it.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pm_public_orderbook(uuid, public.pm_order_side, integer);

-- ---------------------------------------------------------------------
-- 2. Lock down pm_round_outcomes to server-side (service_role) callers.
--
--    This read-only SECURITY DEFINER function exposes public round/pool
--    data, but it is only ever invoked server-side through the Supabase
--    service-role client (app/api/pm/rounds/[roundId]/route.ts). The
--    service_role bypasses GRANTs, so revoking EXECUTE from anon /
--    authenticated / PUBLIC keeps the app working while removing the
--    advisor findings for callable-by-untrusted-roles.
--
--    We do NOT drop it (still used) and we keep its search_path pinned.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'pm_round_outcomes'
      AND pg_get_function_identity_arguments(p.oid) = 'p_round_id text'
  ) THEN
    -- Revoke from the publicly-reachable PostgREST roles.
    REVOKE EXECUTE ON FUNCTION public.pm_round_outcomes(text) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.pm_round_outcomes(text) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.pm_round_outcomes(text) FROM authenticated;

    -- Keep server-side callers working explicitly.
    GRANT EXECUTE ON FUNCTION public.pm_round_outcomes(text) TO service_role;

    -- Defence-in-depth: pin search_path (already set, enforced here too).
    ALTER FUNCTION public.pm_round_outcomes(text) SET search_path = public;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 3. Pin search_path on ANY remaining SECURITY DEFINER function in
--    public that is missing it. No-op today (all are pinned) but keeps
--    future-added definer functions from slipping through.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND (p.proconfig IS NULL OR NOT (p.proconfig::text LIKE '%search_path%'))
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public;',
      r.proname, r.args
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- 4. RLS hardening on sensitive tables.
--
--    pm_bets and pm_protocol_fees must never be readable or writable by
--    the anon / authenticated PostgREST roles. All legitimate access is
--    server-side via the service_role (which bypasses RLS). We enable
--    RLS (idempotent) and install a single restrictive ALL policy with
--    USING(false) / WITH CHECK(false), replacing the prior SELECT-only
--    policies so writes are denied too.
--
--    Guarded by existence checks so the migration never fails on a fresh
--    branch that hasn't created these tables yet.
-- ---------------------------------------------------------------------

-- pm_bets ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'pm_bets' AND c.relkind = 'r'
  ) THEN
    ALTER TABLE public.pm_bets ENABLE ROW LEVEL SECURITY;

    -- Replace any prior permissive/SELECT-only policy with a deny-all one.
    DROP POLICY IF EXISTS "Users can view their own pm_bets" ON public.pm_bets;
    DROP POLICY IF EXISTS "no public access pm_bets" ON public.pm_bets;

    CREATE POLICY "no public access pm_bets"
      ON public.pm_bets
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;

-- pm_protocol_fees ---------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'pm_protocol_fees' AND c.relkind = 'r'
  ) THEN
    ALTER TABLE public.pm_protocol_fees ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "no public read pm_protocol_fees" ON public.pm_protocol_fees;
    DROP POLICY IF EXISTS "no public access pm_protocol_fees" ON public.pm_protocol_fees;

    CREATE POLICY "no public access pm_protocol_fees"
      ON public.pm_protocol_fees
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;

-- =====================================================================
-- End v4_030_security.sql
-- =====================================================================
