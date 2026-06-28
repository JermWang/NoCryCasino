// Shared types for the parimutuel prediction-market UI.

export type MarketType = "DAILY" | "WEEKLY" | "MONTHLY"

export type RoundRow = {
  round_id: string
  market_type: MarketType
  start_ts: string
  lock_ts: string
  settle_ts: string
  status: string
  collateral_mint: string
  rake_bps: number
  // Present in the rounds-list/detail payloads but not required by the UI.
  escrow_wallet_pubkey?: string | null
  snapshot_hash?: string | null
}

// Parimutuel outcome as returned by pm_round_outcomes / the canonical
// GET /api/pm/rounds/[roundId] payload. Pool fields are optional so the UI
// also tolerates the leaner /rounds/[roundId]/outcomes shape (no pools).
export type OutcomeRow = {
  outcome_id: string
  round_id?: string
  kol_wallet_address: string
  question_text: string
  status: string
  final_outcome: boolean | null
  collateral_mint?: string | null
  yes_pool?: number | null
  no_pool?: number | null
  total_pool?: number | null
  yes_prob?: number | null
  yes_bettor_count?: number | null
  no_bettor_count?: number | null
  // KOL profile join (optional).
  kols?: {
    display_name: string | null
    avatar_url: string | null
    twitter_url: string | null
    twitter_handle: string | null
  } | null
}

// Per-mint balance row (canonical me/state balances[] entry). The route may
// still return a single `balance` object; the me page normalizes both.
export type BalanceRow = {
  mint: string
  available_collateral: number
  reserved_collateral: number
  updated_at?: string
}

// A user's parimutuel bet (from me/state bets[]).
export type BetRow = {
  bet_id: string
  round_id?: string
  outcome_id: string
  side: boolean | "YES" | "NO"
  amount: number
  mint: string
  payout?: number | null
  fee?: number | null
  fee_exempt?: boolean
  status: string
  created_at: string
  settled_at?: string | null
}

/** Normalize a bet side that may arrive as a boolean (YES=true) or string. */
export function betSideLabel(side: boolean | "YES" | "NO"): "YES" | "NO" {
  if (typeof side === "boolean") return side ? "YES" : "NO"
  return side === "YES" ? "YES" : "NO"
}

// A round enriched with aggregates derived from its outcomes. The rounds-list
// endpoint returns no pool data (pools live on outcomes), so the markets page
// hydrates each round's detail and folds the outcomes into these fields for
// sorting (volume / liquidity) and headline display.
export type RoundSummary = RoundRow & {
  outcomes: OutcomeRow[]
  outcomeCount: number
  totalPool: number
  yesPool: number
  noPool: number
  bettorCount: number
  // Volume-weighted average implied YES probability across active outcomes.
  avgYesProb: number | null
  // The single most-traded outcome, used as the card's headline market.
  topOutcome: OutcomeRow | null
  hydrated: boolean
}

/** Fold a round + its outcomes into a RoundSummary with pool aggregates. */
export function summarizeRound(round: RoundRow, outcomes: OutcomeRow[]): RoundSummary {
  let yesPool = 0
  let noPool = 0
  let bettorCount = 0
  let probWeightSum = 0
  let probWeight = 0
  let topOutcome: OutcomeRow | null = null
  let topTotal = -1

  for (const o of outcomes) {
    const y = Number(o.yes_pool ?? 0)
    const n = Number(o.no_pool ?? 0)
    const total = Number(o.total_pool ?? y + n)
    yesPool += y
    noPool += n
    bettorCount += Number(o.yes_bettor_count ?? 0) + Number(o.no_bettor_count ?? 0)

    if (total > 0) {
      const prob =
        typeof o.yes_prob === "number" && Number.isFinite(o.yes_prob)
          ? o.yes_prob
          : total > 0
            ? y / total
            : null
      if (prob != null) {
        probWeightSum += prob * total
        probWeight += total
      }
    }

    if (total > topTotal) {
      topTotal = total
      topOutcome = o
    }
  }

  const totalPool = yesPool + noPool
  return {
    ...round,
    outcomes,
    outcomeCount: outcomes.length,
    totalPool,
    yesPool,
    noPool,
    bettorCount,
    avgYesProb: probWeight > 0 ? probWeightSum / probWeight : null,
    topOutcome,
    hydrated: true,
  }
}
