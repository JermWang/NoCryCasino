# No Cry Casino — Real-Money Go-Live Readiness Assessment

## 1. Verdict

**NOT READY.** The parimutuel money core (place-bet + settlement RPCs, auth, deposits) is solid and solvent-by-construction, but the automation, oracle-trust, and legacy-surface layers around it contain launch-blocking defects that stall the bet/settle loop, pay the wrong winners on stale data, and can double-send or freeze escrow funds. All blockers are fixable and none live in the parimutuel RPCs themselves.

---

## 2. Critical Blockers (must fix before launch)

1. **Settlement has no ingestion-freshness gate.** `app/api/admin/pm/rounds/settle/route.ts:207-242` never calls `checkIngestionFreshness` (which exists at `lib/analytics/snapshot.ts:201`), and cron runs `settle` (step 2) before `heliusSync` (step 4) in `app/api/cron/tick/route.ts:130-132`. A lagging/dead Helius feed yields `profit_sol=0` for un-ingested wallets and settlement pays the wrong side with real money; `pm_settle` is idempotent so there is no un-settle. **Fix:** gate settle on freshness (min event count + max staleness, and latest `tx_events.block_time >= lock_ts`); run heliusSync/backfill before settle; park the round instead of settling stale windows.

2. **Withdrawal double-send via retry.** `lib/solana/rpc.ts:60-87` retries the entire build+sign+broadcast+confirm `fn`; a `confirmTransaction` timeout re-enters `fn`, fetches a new blockhash, re-signs (new signature) and re-broadcasts (`app/api/admin/pm/withdrawals/send/route.ts:110-198`). Two signatures both land → escrow pays 2-3x, invisible to the `tx_sig` UNIQUE constraint. **Fix:** build+sign once outside the retry loop; retry only submit/confirm of the identical signed tx (same blockhash → same signature → on-chain dedup), or use a deterministic memo + pre-send on-chain lookup.

3. **No fresh round ever auto-opens.** `app/api/cron/tick/route.ts:129-141` fans out lock→settle→withdrawals→heliusSync→nocryDistribute and never calls `bootstrap`. After seeded rounds lock/settle there are zero open markets; MONTHLY is already SETTLED in prod with no replacement. **Fix:** add an idempotent insert-if-absent bootstrap step to the tick, guarded to NOT reset the status of an existing round.

4. **Stranded SENDING withdrawals have no recovery.** `scripts/v3_030_prediction_withdrawals.sql:102-157`: a crash/timeout after `pm_begin_withdrawal_send` leaves the row `SENDING` forever (re-claim requires `status='REQUESTED'`), balance already debited → user funds frozen. **Fix:** add a reaper RPC (verify on-chain, then mark SENT or return to REQUESTED) called from cron before the process step; never blind-refund without an on-chain check.

5. **USDC send double-transfers + double-creates the destination ATA on retry.** `lib/solana/spl.ts:106-167` rebuilds the tx (fresh blockhash, re-checks ATA existence) each retry, compounding blocker #2 on the token rail and wasting escrow SOL on duplicate rent. **Fix:** same build-and-sign-once retry fix.

6. **Settlement oracle is fully spoofable.** `app/api/webhooks/helius/route.ts:108-135` authenticates only with a single static shared bearer, no body signature; PnL is computed verbatim from stored `raw` with no on-chain re-verification. A leaked token lets an attacker inject fake swaps and steer real payouts. **Fix:** cross-verify each ingested signature on-chain at snapshot time and recompute PnL from authoritative data; rotate the token and isolate prod/preview secrets.

---

## 3. Findings by Severity

### Critical
- Settlement + payout — Settlement runs with no ingestion-freshness gate — `app/api/admin/pm/rounds/settle/route.ts:207-242` — stale/empty feed silently pays the wrong side, no un-settle — gate on `checkIngestionFreshness` + reorder cron.
- Withdrawals — `withRpcFallback` retry can double-send a withdrawal — `lib/solana/rpc.ts:60-87` — real on-chain double payout from escrow, invisible to `tx_sig` UNIQUE — build+sign once, retry only submit/confirm.

### High
- Round lifecycle — No fresh round ever auto-opens — `app/api/cron/tick/route.ts:129-141` — market goes permanently dark after first lock/settle — add idempotent bootstrap step to tick.
- Live probe — No OPEN MONTHLY round exists; cron never bootstraps — same location — monthly market already dead — verify OPEN MONTHLY at launch + fix cron.
- Withdrawals — SENDING rows have no recovery path — `scripts/v3_030_prediction_withdrawals.sql:102-157` — user funds frozen indefinitely — add reaper RPC with on-chain check.
- Withdrawals — USDC send omits idempotent guard; retry double-transfers + double-funds ATA — `lib/solana/spl.ts:106-167` — USDC solvency drain + wasted escrow SOL — build+sign once.
- $NOCRY rewards — Non-atomic distribution dead-ends on partial failure — `app/api/admin/nocry/distribute/route.ts:87-168` — DISTRIBUTED row with zero claim rows; holders lose a day, unrecoverable — wrap per-mint distribution in one SECURITY DEFINER RPC.
- Helius ingestion — Spoofable oracle: single static bearer, no body signature — `app/api/webhooks/helius/route.ts:108-135` — leaked token rigs real-money payouts — cross-verify signatures on-chain; rotate token.
- Helius ingestion — Settlement never enforces the freshness guard — `app/api/admin/pm/rounds/settle/route.ts:204-242` — dead webhook silently settles on incomplete PnL — call freshness guard before pricing.
- Frontend — Round-detail endpoint returns no KOL identity — `app/api/pm/rounds/[roundId]/route.ts:25-29` + `scripts/v4_010_parimutuel.sql:444-462` — every market shows a truncated wallet + initials, suppressing volume — LEFT JOIN `kols` in `pm_round_outcomes` or enrich in route.
- Legacy surface — `/api/markets/[marketId]/orders` still takes real SOL cron never settles — `app/api/markets/[marketId]/orders/route.ts:160-308` — funds stranded outside solvency design — 410/delete the `/api/markets/*` tree.

### Medium
- Round lifecycle — Monthly settlement window is a fixed 30 days, misaligned with the calendar month — `app/api/admin/pm/rounds/bootstrap/route.ts:74-91` + `lib/analytics/snapshot.ts:56-68` — monthly winners computed on a rolling window that can flip TOP_N membership — derive calendar-month cutoff.
- $NOCRY rewards — Unpaginated `getProgramAccounts` fails-to-empty — `lib/solana/nocry-holders.ts:53-107` — an RPC hiccup writes NO_HOLDERS and burns a day's rewards — add dataSlice + retry; distinguish RPC-error from zero-holders and abort.
- Legacy surface — Primary "Markets" nav points to the deprecated escrow engine — `components/header.tsx:27-31` → `/markets` — flagship link sends users into the unsettled legacy path — repoint nav to `/pm`.
- Legacy surface — Legacy engine armable at any time via live admin bootstrap — `app/api/admin/markets/bootstrap/route.ts:61-133` — one call re-arms a money path with no auto-settlement — delete/410 `/api/admin/markets/*`.
- Legacy surface — No cross-engine deposit dedup on shared escrow — `app/api/markets/[marketId]/orders/route.ts` vs `app/api/pm/deposits/credit/route.ts` — one on-chain deposit can credit both engines (double-count) — retire legacy or add a shared tx_sig ledger.

### Low
- Betting — Fee-exempt $NOCRY lookup is an un-timed public-RPC call in the bet hot path — `app/api/pm/bets/place/route.ts:109`; `lib/pm/fees.ts:35-53` — bets can hang near lock under RPC brownout (fails safe to false) — add hard timeout + dedicated paid RPC.
- Betting/Settlement — Per-bet `round(...,9)` half-up can make Σprofit exceed the losing pool by dust — `scripts/v4_010_parimutuel.sql:307-320` — bounded solvency-invariant leak; USDC dust un-withdrawable — floor to mint precision, last winner absorbs remainder.
- Settlement — Profit rounded to 9 dp regardless of mint (USDC is 6) — `scripts/v4_010_parimutuel.sql:309-311` — ledger drifts sub-cent from on-chain USDC reality — round to mint decimals.
- Settlement — SOL price fallback differs (settle route hardcodes 124 vs snapshot 0) — `app/api/admin/pm/rounds/settle/route.ts:121-124` — on dual-oracle outage a fresh snapshot pins a stale price, can flip winners — hard-stop on failed price.
- Betting — No minimum stake; sub-lamport dust bets accepted — `app/api/pm/bets/place/route.ts:61` — feeds rounding leak + un-withdrawable dust — enforce per-mint MIN_BET + quantize.
- Balances — Reward-claim RPC can mark a freshly-distributed claim CLAIMED without crediting — `scripts/v4_050_holder_rewards.sql:137-159` — claim during the daily window loses that day's reward — credit + flip the same locked set (RETURNING).
- Balances — `availableFor()` cross-mint fallback shows wrong mint's balance — `components/pm/use-pm-state.ts:129-140` — misleading MAX/balance (server still safe) — match strictly on mint.
- Deposits — SOL verify only scans top-level instructions (misses CPI transfers) — `app/api/pm/deposits/credit/route.ts:54-68` — smart-wallet deposits silently rejected (never over-credits) — also flatten innerInstructions / use balance delta.
- Deposits — Nonce consumed before on-chain verify — `app/api/pm/deposits/credit/route.ts:152-217` — transient RPC lag forces re-sign — consume nonce after verify.
- Withdrawals — Destination not validated as a real Solana address before debit — `app/api/pm/withdrawals/request/route.ts:36,46` — debit→send→fail→refund churn on malformed input — validate PublicKey at request time.
- Auth — In-memory rate limiter is per-instance, bypassable on Vercel — `lib/api/guards.ts:19-55` — weak throttle on money endpoints (not an auth bypass) — back with shared store keyed by wallet.
- Auth — `deposits/credit` bearer check not timing-safe/sanitized — `app/api/pm/deposits/credit/route.ts:24-30` — theoretical timing side-channel (blast radius capped by on-chain verify) — use `requireBearerIfConfigured`.
- Auth — `issued_at` freshness allows future-dated signatures — `lib/pm/signing.ts:7-12` — negligible given single-use nonces — reject future timestamps beyond small skew.
- $NOCRY rewards — Solvency snapshot double-counts distributed fees — `scripts/v4_010_parimutuel.sql:483,487` — overstates liability once wired to alerting (no current caller) — add `distribution_id is null` filter.
- Helius — Events with null block_time silently dropped from every window — `app/api/webhooks/helius/route.ts:34-40` + `lib/analytics/snapshot.ts:341-344` — occasional trades omitted from PnL — reject/flag/backfill missing block_time.
- Frontend — Fee-waiver badge is global-across-bets and stale — `app/pm/rounds/[roundId]/page.tsx:99-102` — bet slip over-promises zero rake (server charges correctly) — drive from live fee-status.
- Frontend — Withdraw destination validated only by length ≥32 — `components/pm/withdraw-dialog.tsx:57` — bad address passes client gate — validate with PublicKey.
- Legacy surface — Legacy order endpoint lacks single-use nonce — `app/api/markets/[marketId]/orders/route.ts:194-241` — weaker replay posture (deposit_sig UNIQUE bounds it) — retire the endpoint.

### Info (no action / cosmetic)
- Deposits — idempotent replay returns 200 + credited_amount → false "credited" toast (`deposits/credit/route.ts:219-229`).
- Deposits — emergency-halt check fails open on DB error (low risk for deposits) (`lib/escrow/security.ts:215-228`).
- Auth — malformed signature/pubkey surfaces as 500 not 401, leaks error text (`lib/pm/signing.ts:14-24`).
- Auth — nonce table has no TTL/pruning; grows unbounded (`scripts/v3_050_prediction_nonces.sql`).
- Frontend — retired CLOB order/fill endpoints correctly return 410 (verified healthy).
- Live probe — `/api/kolscan/leaderboard` returns 502 but is orphaned (not on settlement path).

---

## 4. Per-Subsystem Health

| Subsystem | Status | Note |
|---|---|---|
| Betting engine (parimutuel place-bet) | working | Atomic, advisory-locked, idempotent, replay-safe; only low-severity hot-path/rounding nits. |
| Settlement + payout solvency | risky | Solvent-by-construction, but settles on unguarded oracle data (blocker) + decimal/window nits. |
| Round lifecycle + cron automation | broken | No auto-open of rounds; market goes dark after first lock (blocker). |
| Deposits (on-chain → credit) | working | On-chain-verified, tx_sig-unique, atomic; only false-negative/UX nits. |
| Withdrawals (custodial → send) | risky | Debit-before-send is sound, but retry double-send + no SENDING reaper (blockers). |
| Balances, positions, claims | working | Per-mint safe and idempotent; one narrow reward-claim race + one UI cross-mint nit. |
| $NOCRY holder rewards + fee exemption | risky | Correct math, but non-atomic distribution dead-ends + unpaginated holder scan. |
| Auth (ed25519, nonces, admin bearer) | working | No bypass/replay/double-spend; hardening nits only. |
| Helius ingestion (oracle) | risky | Correct dedup/mapping, but spoofable single-bearer + no settle-time freshness enforcement. |
| Leaderboard / realized-PnL analytics | risky | Depends on Helius window; monthly window truncated by ~1 week of data. |
| Frontend PM pages + dialogs | working | Money flows correct; KOL identity never rendered + stale fee badge. |
| Live production probe | risky | Core read/bet surface healthy; MONTHLY dead + stall risk confirmed live. |
| Legacy / deprecated surface | risky | Second live escrow engine reachable, nav points to it, shared escrow, no cross-engine dedup. |

---

## 5. Verified Working (confirmed healthy)

- **Bet placement is atomic and safe** (`scripts/v4_010_parimutuel.sql:169-341`): `pm_place_bet` takes `pg_advisory_xact_lock(outcome)` + `SELECT FOR UPDATE`, debits via a guarded conditional UPDATE (no TOCTOU, no negative balances), is idempotent on `(user_pubkey, idempotency_key)`, and rejects bets when `round_status<>'OPEN'`, `outcome<>'ACTIVE'`, or `now()>=lock_ts`.
- **Settlement is solvent-by-construction and idempotent** (`scripts/v4_010_parimutuel.sql:250-341`): winners split both pools pro-rata, `Σpayout + Σfee = win_pool + lose_pool`; triple idempotency (status claim under advisory lock, per-outcome skip, ON CONFLICT ledger keys); empty-winning-side refunds 1:1; rake clamped to `[0, profit]` and honors snapshotted `fee_exempt`.
- **Deposits credit only real on-chain funds** (`app/api/pm/deposits/credit/route.ts`, `lib/solana/spl.ts`): chain amount (not client-claimed) is credited with correct per-mint decimals, escrow-destination + sender binding enforced, `tx_sig` single-use via UNIQUE index + advisory lock, all in one SECURITY DEFINER transaction.
- **Withdrawal money-safety invariants hold** (`pm_request_withdrawal`, `pm_begin_withdrawal_send`, `pm_fail_withdrawal`): balance debited before send, single-writer SENDING claim, idempotent re-credit on failure, `tx_sig` UNIQUE, liabilities counted; user RPCs granted only to postgres/service_role (verified on prod DB).
- **Auth model is sound** (`lib/pm/signing.ts`, `lib/api/guards.ts`): ed25519 verified against wallet, per-action message binding with distinct titles, globally single-use nonces via `INSERT ... ON CONFLICT DO NOTHING`, fail-closed admin bearer with timing-safe compare, RLS deny-all + REVOKE on money RPCs/tables.
- **Retired CLOB endpoints** (`pm/orders/*`, `pm/outcomes/[id]/orderbook|fills`) correctly return 410 with no dangling UI.
- **Live prod surface** healthy for reads/bets: OPEN DAILY/WEEKLY rounds with future lock_ts, non-empty outcomes with pools/probabilities, live SOL price, and money POSTs cleanly reject empty bodies with 400.