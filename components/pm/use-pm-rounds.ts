"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { summarizeRound, type OutcomeRow, type RoundRow, type RoundSummary } from "./types"

type Status = "OPEN" | "ALL"

/** Fetch one round's detail (round + outcomes with pools). */
async function fetchRoundDetail(roundId: string, signal?: AbortSignal): Promise<{ round: RoundRow; outcomes: OutcomeRow[] } | null> {
  try {
    const res = await fetch(`/api/pm/rounds/${encodeURIComponent(roundId)}`, { signal })
    const json = (await res.json().catch(() => null)) as any
    if (!res.ok || !json?.ok || !json?.round) return null
    const outcomes: OutcomeRow[] = Array.isArray(json.outcomes) ? json.outcomes : []
    return { round: json.round as RoundRow, outcomes }
  } catch {
    return null
  }
}

/** Run async tasks with a bounded concurrency pool. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i]!, i)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Loads the prediction-market rounds for a given status and progressively
 * hydrates each round's pool aggregates (the rounds-list endpoint returns no
 * pools — they live on outcomes). Renders fast with lean cards, then fills in
 * volume / odds / bettor counts as each round's detail resolves.
 */
export function usePmRounds(status: Status) {
  const [rounds, setRounds] = useState<RoundSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [hydrating, setHydrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++reqRef.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    try {
      // The list route only filters by status; "ALL" means union the lifecycle.
      const statuses = status === "OPEN" ? ["OPEN"] : ["OPEN", "LOCKED", "SETTLING", "SETTLED"]
      const lists = await Promise.all(
        statuses.map(async (s) => {
          const res = await fetch(`/api/pm/rounds?status=${s}`, { signal: controller.signal })
          const json = (await res.json().catch(() => null)) as any
          if (!res.ok || !json?.ok) return [] as RoundRow[]
          return Array.isArray(json.rounds) ? (json.rounds as RoundRow[]) : []
        }),
      )

      // Dedupe by round_id and seed un-hydrated summaries for an instant grid.
      const seen = new Set<string>()
      const base: RoundRow[] = []
      for (const list of lists) {
        for (const r of list) {
          if (seen.has(r.round_id)) continue
          seen.add(r.round_id)
          base.push(r)
        }
      }

      if (reqRef.current !== seq) return
      setRounds(base.map((r) => summarizeRound(r, [])))
      setLoading(false)

      if (base.length === 0) {
        setHydrating(false)
        return
      }

      // Hydrate pool aggregates with bounded concurrency, updating in place.
      setHydrating(true)
      await mapPool(base, 5, async (r) => {
        const detail = await fetchRoundDetail(r.round_id, controller.signal)
        if (reqRef.current !== seq) return
        if (!detail) return
        const summary = summarizeRound(detail.round, detail.outcomes)
        setRounds((prev) => prev.map((p) => (p.round_id === r.round_id ? summary : p)))
      })
      if (reqRef.current === seq) setHydrating(false)
    } catch (e: any) {
      if (reqRef.current !== seq) return
      if (controller.signal.aborted) return
      setError(e?.message ?? String(e))
      setRounds([])
      setLoading(false)
      setHydrating(false)
    }
  }, [status])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  return { rounds, loading, hydrating, error, reload: load }
}
