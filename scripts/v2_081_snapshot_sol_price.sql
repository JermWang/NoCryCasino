-- Migration: pin SOL/USD price into leaderboard snapshots
-- Supports settlement-oracle correctness: the price used to value PnL must be
-- captured at lock time (snapshot creation) and reused at settle, never
-- re-fetched live. See lib/analytics/snapshot.ts.

alter table if exists public.leaderboard_snapshots
  add column if not exists sol_price_usd numeric;
