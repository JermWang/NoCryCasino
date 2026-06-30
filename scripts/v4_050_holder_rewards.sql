-- =====================================================================
-- v4_050_holder_rewards.sql
-- $NOCRY token-holder fee-rewards feature.
--
-- Holders of >= 1,000,000 $NOCRY receive 50% of platform house fees
-- (rake recorded in public.pm_protocol_fees), split pro-rata among them,
-- claimable from their profile. Distribution runs once per UTC day
-- ("lock holders + split fees daily").
--
-- This migration:
--   1. Marks fees that have been distributed (pm_protocol_fees.distribution_id).
--   2. Adds nocry_fee_distributions (one row per UTC day per mint).
--   3. Adds nocry_reward_claims (per-holder claimable shares).
--   4. Adds the nocry_claim_rewards(p_wallet) RPC (credits balances, marks claimed).
--   5. Hardens RLS + RPC grants (service_role only), matching v4_020/v4_030.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Mark fees already folded into a distribution.
--    NULL distribution_id == undistributed (eligible for the next run).
-- ---------------------------------------------------------------------
ALTER TABLE public.pm_protocol_fees
  ADD COLUMN IF NOT EXISTS distribution_id uuid;

-- ---------------------------------------------------------------------
-- 2. Daily distribution ledger. One row per (UTC day, mint).
--    The UNIQUE(day, mint) constraint enforces "once per UTC day per mint":
--    the distribute endpoint relies on it to stay idempotent.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nocry_fee_distributions (
  distribution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day             date NOT NULL,
  mint            text NOT NULL,
  total_fees      numeric NOT NULL DEFAULT 0,
  holder_pool     numeric NOT NULL DEFAULT 0,
  holder_count    int     NOT NULL DEFAULT 0,
  total_holdings  numeric NOT NULL DEFAULT 0,
  status          text    NOT NULL DEFAULT 'DISTRIBUTED',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One distribution per UTC day per mint.
CREATE UNIQUE INDEX IF NOT EXISTS nocry_fee_distributions_day_mint_key
  ON public.nocry_fee_distributions (day, mint);

-- FK target for pm_protocol_fees.distribution_id (informational; we attach it
-- via a NOT VALID constraint so existing NULL rows are unaffected).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pm_protocol_fees_distribution_id_fkey'
  ) THEN
    ALTER TABLE public.pm_protocol_fees
      ADD CONSTRAINT pm_protocol_fees_distribution_id_fkey
      FOREIGN KEY (distribution_id)
      REFERENCES public.nocry_fee_distributions (distribution_id)
      NOT VALID;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 3. Per-holder reward shares for a given distribution.
--    UNIQUE(distribution_id, wallet_pubkey) keeps one share per holder
--    per day; the claim is idempotent on status.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nocry_reward_claims (
  claim_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id uuid NOT NULL REFERENCES public.nocry_fee_distributions (distribution_id),
  wallet_pubkey   text NOT NULL,
  mint            text NOT NULL,
  holder_balance  numeric NOT NULL DEFAULT 0,
  share_bps       numeric NOT NULL DEFAULT 0,
  amount          numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'CLAIMABLE'
                    CHECK (status IN ('CLAIMABLE', 'CLAIMED')),
  claimed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (distribution_id, wallet_pubkey)
);

CREATE INDEX IF NOT EXISTS nocry_reward_claims_wallet_status_idx
  ON public.nocry_reward_claims (wallet_pubkey, status);

-- ---------------------------------------------------------------------
-- 4. RLS: deny-all to anon/authenticated on both tables.
--    All legitimate access is server-side via service_role (bypasses RLS).
-- ---------------------------------------------------------------------
ALTER TABLE public.nocry_fee_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nocry_reward_claims     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "no public access nocry_fee_distributions" ON public.nocry_fee_distributions;
CREATE POLICY "no public access nocry_fee_distributions"
  ON public.nocry_fee_distributions
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "no public access nocry_reward_claims" ON public.nocry_reward_claims;
CREATE POLICY "no public access nocry_reward_claims"
  ON public.nocry_reward_claims
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------
-- 5. Claim RPC: sum CLAIMABLE amounts per mint for a wallet, credit each
--    via pm__credit_balance, mark those claims CLAIMED, return totals.
--    Idempotent: only ever touches rows still CLAIMABLE, so a double call
--    credits nothing the second time.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nocry_claim_rewards(p_wallet text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet text := nullif(btrim(p_wallet), '');
  v_total  numeric := 0;
  r record;
  v_by_mint jsonb := '{}'::jsonb;
BEGIN
  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MISSING_WALLET');
  END IF;

  -- Lock this wallet's claimable rows so concurrent calls can't double-credit
  -- (FOR UPDATE can't be combined with GROUP BY, so lock in a CTE then sum).
  -- Credit the custodial balance per mint, then flip the rows CLAIMED below.
  FOR r IN
    WITH locked AS (
      SELECT claim_id, mint, amount
      FROM public.nocry_reward_claims
      WHERE wallet_pubkey = v_wallet
        AND status = 'CLAIMABLE'
      FOR UPDATE
    )
    SELECT mint, sum(amount) AS amount
    FROM locked
    GROUP BY mint
  LOOP
    IF r.amount IS NOT NULL AND r.amount > 0 THEN
      PERFORM public.pm__credit_balance(v_wallet, r.mint, r.amount);
      v_total := v_total + r.amount;
      v_by_mint := v_by_mint || jsonb_build_object(r.mint, r.amount);
    END IF;
  END LOOP;

  UPDATE public.nocry_reward_claims
  SET status = 'CLAIMED', claimed_at = now()
  WHERE wallet_pubkey = v_wallet
    AND status = 'CLAIMABLE';

  RETURN jsonb_build_object(
    'ok', true,
    'wallet', v_wallet,
    'claimed_total', v_total,
    'by_mint', v_by_mint
  );
END
$$;

-- ---------------------------------------------------------------------
-- 6. Harden the mutation RPC: revoke from public/anon/authenticated,
--    grant only service_role (matches v4_020/v4_030 hardening pattern).
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.nocry_claim_rewards(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nocry_claim_rewards(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nocry_claim_rewards(text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.nocry_claim_rewards(text) TO service_role;

-- =====================================================================
-- End v4_050_holder_rewards.sql
-- =====================================================================
