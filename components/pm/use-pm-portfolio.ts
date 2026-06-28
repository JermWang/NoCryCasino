"use client"

import { useEffect, useMemo, useState } from "react"
import { betSideLabel, type BetRow, type OutcomeRow, type RoundRow } from "./types"
import { previewPayout } from "./pm-client"

export type EnrichedBet = BetRow & {
  sideLabel: "YES" | "NO"
  marketType?: string
  kolName?: string
  questionText?: string
  outcomeStatus?: string
  finalOutcome?: boolean | null
  lockTs?: string
  // Live implied value if the position settled at current pools (open bets only).
  currentValue?: number | null
  currentMultiple?: number | null
}

type RoundDetail = { round: RoundRow; outcomes: OutcomeRow[] }

async function fetchRoundDetail(roundId: string): Promise<RoundDetail | null> {
  try {
    const res = await fetch(`/api/pm/rounds/${encodeURIComponent(roundId)}`)
    const json = (await res.json().catch(() => null)) as any
    if (!res.ok || !json?.ok || !json?.round) return null
    return { round: json.round as RoundRow, outcomes: Array.isArray(json.outcomes) ? json.outcomes : [] }
  } catch {
    return null
  }
}

/**
 * Enriches the user's bets with live market context: the owning round's type
 * and lock time, the outcome's KOL/question/settlement state, and — for still-
 * open positions — an indicative "current value" computed from the live pools
 * (what the stake would return if the round settled right now).
 */
export function usePmPortfolio(bets: BetRow[]) {
  const [details, setDetails] = useState<Map<string, RoundDetail>>(new Map())
  const [loading, setLoading] = useState(false)

  // Distinct round ids referenced by the bets.
  const roundIds = useMemo(() => {
    const set = new Set<string>()
    for (const b of bets) if (b.round_id) set.add(b.round_id)
    return Array.from(set)
  }, [bets])

  useEffect(() => {
    let cancelled = false
    if (roundIds.length === 0) {
      setDetails(new Map())
      return
    }
    setLoading(true)
    void (async () => {
      const entries = await Promise.all(
        roundIds.map(async (id) => [id, await fetchRoundDetail(id)] as const),
      )
      if (cancelled) return
      const map = new Map<string, RoundDetail>()
      for (const [id, d] of entries) if (d) map.set(id, d)
      setDetails(map)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [roundIds.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps

  const enriched: EnrichedBet[] = useMemo(() => {
    return bets.map((b) => {
      const sideLabel = betSideLabel(b.side)
      const detail = b.round_id ? details.get(b.round_id) : undefined
      const outcome = detail?.outcomes.find((o) => o.outcome_id === b.outcome_id)

      let currentValue: number | null = null
      let currentMultiple: number | null = null
      const isOpen = b.status === "ACTIVE" || b.status === "OPEN"
      if (isOpen && outcome) {
        const yesPool = Number(outcome.yes_pool ?? 0)
        const noPool = Number(outcome.no_pool ?? 0)
        // Pools already include this bet; estimate marginal return on the stake.
        const gross = previewPayout({
          amount: Number(b.amount),
          side: sideLabel,
          yesPool: sideLabel === "YES" ? Math.max(0, yesPool - Number(b.amount)) : yesPool,
          noPool: sideLabel === "NO" ? Math.max(0, noPool - Number(b.amount)) : noPool,
        })
        currentValue = gross
        currentMultiple = gross != null && Number(b.amount) > 0 ? gross / Number(b.amount) : null
      }

      return {
        ...b,
        sideLabel,
        marketType: detail?.round.market_type,
        lockTs: detail?.round.lock_ts,
        kolName: outcome?.kols?.display_name ?? undefined,
        questionText: outcome?.question_text,
        outcomeStatus: outcome?.status,
        finalOutcome: outcome?.final_outcome ?? null,
        currentValue,
        currentMultiple,
      }
    })
  }, [bets, details])

  return { enriched, loading }
}
