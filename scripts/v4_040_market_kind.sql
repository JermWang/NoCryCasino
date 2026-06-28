-- =====================================================================
-- v4_040_market_kind.sql
-- Generalize KOL-profitability rounds to support multiple MARKET KINDS,
-- all resolving from the SAME realized-SOL-PnL leaderboard snapshot.
--
-- Until now every round resolved as "top-N". This migration records the
-- resolution rule on each round so the settle path can branch by kind:
--
--   * 'TOP_1'        winners = single highest realized-SOL-PnL eligible KOL.
--   * 'TOP_N'        winners = top N eligible by realized SOL PnL
--                    (N from kind_params->>'n', default 3).
--   * 'PROFITABLE'   winners = ALL eligible KOLs with realized SOL PnL > 0.
--   * 'HEAD_TO_HEAD' winners derived from kind_params {a,b} (settlement TODO).
--
-- The RPC pm_settle_round_parimutuel is unchanged: it still takes the final
-- winner-wallet array. Only the way that array is computed changes per kind.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Resolution-rule columns on market_rounds.
--
--    market_kind defaults to 'TOP_N' so every pre-existing round keeps
--    its current top-N semantics with no backfill required.
--    kind_params carries kind-specific config (e.g. {"n":3} for TOP_N,
--    {"a":"<wallet>","b":"<wallet>"} for HEAD_TO_HEAD).
-- ---------------------------------------------------------------------
alter table public.market_rounds
  add column if not exists market_kind text not null default 'TOP_N';

alter table public.market_rounds
  add column if not exists kind_params jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 2. Constrain market_kind to the four supported values.
--
--    Guarded so re-running does not error on the already-present
--    constraint. Dropping first keeps the definition authoritative if the
--    allowed set ever changes.
-- ---------------------------------------------------------------------
alter table public.market_rounds
  drop constraint if exists market_rounds_market_kind_check;

alter table public.market_rounds
  add constraint market_rounds_market_kind_check
  check (market_kind in ('TOP_1', 'TOP_N', 'PROFITABLE', 'HEAD_TO_HEAD'));
