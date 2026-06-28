"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { ArrowLeft, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PmShell } from "@/components/pm/pm-shell"
import { OutcomeCard } from "@/components/pm/outcome-card"
import { CountdownPill, PayoutExplainer, FeeWaiverBadge } from "@/components/pm/pm-ui"
import { usePmState } from "@/components/pm/use-pm-state"
import type { OutcomeRow, RoundRow } from "@/components/pm/types"
import { formatAmount, isPastLock, mintLabel } from "@/components/pm/pm-client"

type MarketType = "DAILY" | "WEEKLY" | "MONTHLY"

/**
 * Resolve a single outcome (with parimutuel pools) plus its round. There is no
 * standalone outcome endpoint, so we locate the round that contains the
 * outcome: try the optional ?round=<id> hint first, otherwise scan recent open
 * rounds across market types and match on outcome_id via pm_round_outcomes.
 */
async function loadOutcome(
  outcomeId: string,
  roundHint: string | null,
): Promise<{ round: RoundRow; outcome: OutcomeRow }> {
  async function fromRound(roundId: string) {
    const res = await fetch(`/api/pm/rounds/${encodeURIComponent(roundId)}`)
    const json = (await res.json().catch(() => null)) as any
    if (!res.ok || !json?.ok) return null
    const round = json.round as RoundRow
    const outcomes: OutcomeRow[] = Array.isArray(json?.outcomes) ? json.outcomes : []
    const outcome = outcomes.find((o) => o.outcome_id === outcomeId)
    return outcome ? { round, outcome } : null
  }

  if (roundHint) {
    const hit = await fromRound(roundHint)
    if (hit) return hit
  }

  const types: MarketType[] = ["DAILY", "WEEKLY", "MONTHLY"]
  const statuses = ["OPEN", "LOCKED", "SETTLING", "SETTLED"]
  const lists = await Promise.all(
    statuses.map(async (s) => {
      const r = await fetch(`/api/pm/rounds?status=${s}`)
      const j = (await r.json().catch(() => null)) as any
      return Array.isArray(j?.rounds) ? (j.rounds as RoundRow[]) : []
    }),
  )
  const seen = new Set<string>()
  const allRounds: RoundRow[] = []
  for (const list of lists) {
    for (const r of list) {
      if (seen.has(r.round_id)) continue
      seen.add(r.round_id)
      allRounds.push(r)
    }
  }

  for (const r of allRounds) {
    const hit = await fromRound(r.round_id)
    if (hit) return hit
  }

  // Last resort: scan by market type (covers any status the list filter missed).
  for (const mt of types) {
    const r = await fetch(`/api/pm/rounds?market_type=${mt}`)
    const j = (await r.json().catch(() => null)) as any
    const rs: RoundRow[] = Array.isArray(j?.rounds) ? j.rounds : []
    for (const rr of rs) {
      if (seen.has(rr.round_id)) continue
      seen.add(rr.round_id)
      const hit = await fromRound(rr.round_id)
      if (hit) return hit
    }
  }

  throw new Error("Outcome not found")
}

export default function PmOutcomePage({ params }: { params: { outcomeId: string } }) {
  const { connected } = useWallet()
  const { setVisible } = useWalletModal()
  const { state, refresh, availableFor } = usePmState()

  const outcomeId = useMemo(() => decodeURIComponent(params.outcomeId ?? ""), [params.outcomeId])
  const roundHint = useMemo(() => {
    if (typeof window === "undefined") return null
    return new URLSearchParams(window.location.search).get("round")
  }, [])

  const [round, setRound] = useState<RoundRow | null>(null)
  const [outcome, setOutcome] = useState<OutcomeRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const { round: r, outcome: o } = await loadOutcome(outcomeId, roundHint)
      setRound(r)
      setOutcome(o)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setRound(null)
      setOutcome(null)
    } finally {
      setLoading(false)
    }
  }, [outcomeId, roundHint])

  useEffect(() => {
    if (!outcomeId) return
    setLoading(true)
    void reload()
  }, [outcomeId, reload])

  const currency = mintLabel(round?.collateral_mint)
  const locked = round ? isPastLock(round.lock_ts) : false
  const isOpen = round?.status === "OPEN"
  const bettingClosed = !isOpen || locked
  const available = availableFor(round?.collateral_mint)
  const rakeBps = round?.rake_bps ?? 250

  const feeWaived = useMemo(() => {
    const bets = state?.bets ?? []
    return bets.some((b) => b.fee_exempt === true)
  }, [state])

  function onBetPlaced() {
    void reload()
    void refresh({ silent: true })
  }

  if (loading) {
    return (
      <PmShell maxWidth="2xl">
        <BackLink href="/pm" label="Back to markets" />
        <div className="pm-skeleton h-96 rounded-2xl" />
      </PmShell>
    )
  }

  if (error || !round || !outcome) {
    return (
      <PmShell maxWidth="2xl">
        <BackLink href="/pm" label="Back to markets" />
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center text-red-400">
          Failed to load outcome: {error ?? "Not found"}
        </div>
      </PmShell>
    )
  }

  return (
    <PmShell maxWidth="2xl">
      <BackLink href={`/pm/rounds/${encodeURIComponent(round.round_id)}`} label="Back to round" />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="pm-chip">{round.market_type}</span>
          <span className={`pm-chip ${isOpen && !locked ? "" : "pm-chip-muted"}`}>
            {locked && isOpen ? "LOCKED" : round.status}
          </span>
          <span className="pm-chip pm-chip-muted">Stake in {currency}</span>
        </div>
        <CountdownPill lockTs={round.lock_ts} closed={bettingClosed} size="sm" />
      </div>

      <div className="mb-5">
        <FeeWaiverBadge qualifies={connected && feeWaived ? true : undefined} />
      </div>

      {!connected ? (
        <div className="mb-5 flex items-center justify-between rounded-xl border border-[var(--pm-line)] bg-[rgba(4,8,6,0.5)] p-4 text-sm text-muted-foreground">
          <span>Connect a wallet to place a bet.</span>
          <Button size="sm" variant="outline" onClick={() => setVisible(true)}>
            Connect wallet
          </Button>
        </div>
      ) : (
        <div className="mb-5 text-sm text-muted-foreground">
          Balance:{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {formatAmount(available, 3)} {currency}
          </span>
        </div>
      )}

      <OutcomeCard
        outcome={outcome}
        collateralMint={round.collateral_mint}
        bettingClosed={bettingClosed}
        available={available}
        rakeBps={rakeBps}
        feeWaived={connected && feeWaived ? true : undefined}
        onBetPlaced={onBetPlaced}
      />

      <div className="mt-5">
        <PayoutExplainer rakeBps={rakeBps} />
      </div>
    </PmShell>
  )
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> {label}
    </Link>
  )
}
