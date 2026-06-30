"use client"

import Link from "next/link"
import { use, useCallback, useEffect, useMemo, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import {
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  Users,
  Layers,
  Droplets,
  Wallet,
  ArrowUpDown,
  ChevronRight,
  Trophy,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { PmShell } from "@/components/pm/pm-shell"
import { OutcomeCard } from "@/components/pm/outcome-card"
import { CountdownPill, PayoutExplainer, FeeWaiverBadge } from "@/components/pm/pm-ui"
import { usePmState } from "@/components/pm/use-pm-state"
import { summarizeRound, type OutcomeRow, type RoundRow } from "@/components/pm/types"
import { formatAmount, formatCompact, impliedYesPct, isPastLock, mintLabel, shortAddress } from "@/components/pm/pm-client"

type OutcomeSort = "volume" | "yes" | "no" | "az"

async function loadRound(roundId: string): Promise<{ round: RoundRow; outcomes: OutcomeRow[] }> {
  const res = await fetch(`/api/pm/rounds/${encodeURIComponent(roundId)}`)
  const json = (await res.json().catch(() => null)) as any
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load round")

  const round = json.round as RoundRow
  let outcomes: OutcomeRow[] = Array.isArray(json?.outcomes) ? (json.outcomes as OutcomeRow[]) : []

  if (outcomes.length === 0) {
    const r2 = await fetch(`/api/pm/rounds/${encodeURIComponent(roundId)}/outcomes`)
    const j2 = (await r2.json().catch(() => null)) as any
    if (r2.ok && j2?.ok && Array.isArray(j2?.outcomes)) {
      outcomes = j2.outcomes as OutcomeRow[]
    }
  }

  return { round, outcomes }
}

export default function PmRoundPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId: rawRoundId } = use(params)
  const { connected } = useWallet()
  const { setVisible } = useWalletModal()
  const { state, refresh, availableFor } = usePmState()

  const roundId = useMemo(() => decodeURIComponent(rawRoundId ?? ""), [rawRoundId])

  const [round, setRound] = useState<RoundRow | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sort, setSort] = useState<OutcomeSort>("volume")

  const reload = useCallback(async () => {
    try {
      const { round: r, outcomes: o } = await loadRound(roundId)
      setRound(r)
      setOutcomes(o)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setRound(null)
      setOutcomes([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [roundId])

  useEffect(() => {
    if (!roundId) return
    setLoading(true)
    void reload()
  }, [roundId, reload])

  const currency = mintLabel(round?.collateral_mint)
  const locked = round ? isPastLock(round.lock_ts) : false
  const isOpen = round?.status === "OPEN"
  const bettingClosed = !isOpen || locked
  const available = availableFor(round?.collateral_mint)
  const rakeBps = round?.rake_bps ?? 250

  const summary = useMemo(
    () => (round ? summarizeRound(round, outcomes) : null),
    [round, outcomes],
  )

  // Detect $NOCRY fee waiver: if any of the user's recorded bets are fee-exempt,
  // they qualify. Otherwise show the generic eligibility note.
  const feeWaived = useMemo(() => {
    const bets = state?.bets ?? []
    return bets.some((b) => b.fee_exempt === true)
  }, [state])

  const sortedOutcomes = useMemo(() => {
    const list = outcomes.slice()
    list.sort((a, b) => {
      switch (sort) {
        case "volume":
          return Number(b.total_pool ?? 0) - Number(a.total_pool ?? 0)
        case "yes":
          return impliedYesPct(b.yes_pool, b.no_pool, b.yes_prob) - impliedYesPct(a.yes_pool, a.no_pool, a.yes_prob)
        case "no":
          return impliedYesPct(a.yes_pool, a.no_pool, a.yes_prob) - impliedYesPct(b.yes_pool, b.no_pool, b.yes_prob)
        case "az": {
          const an = a.kols?.display_name ?? a.kol_wallet_address
          const bn = b.kols?.display_name ?? b.kol_wallet_address
          return an.localeCompare(bn)
        }
        default:
          return 0
      }
    })
    return list
  }, [outcomes, sort])

  function onBetPlaced() {
    void reload()
    void refresh({ silent: true })
  }

  function handleRefresh() {
    setRefreshing(true)
    void reload()
  }

  if (loading) {
    return (
      <PmShell maxWidth="6xl">
        <BackLink />
        <div className="pm-skeleton mb-6 h-32 rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="pm-skeleton h-72 rounded-2xl" />
          ))}
        </div>
      </PmShell>
    )
  }

  if (error || !round || !summary) {
    return (
      <PmShell maxWidth="6xl">
        <BackLink />
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center text-red-400">
          Failed to load round: {error ?? "Not found"}
        </div>
      </PmShell>
    )
  }

  const settledCount = outcomes.filter((o) => o.status === "SETTLED").length
  const activeCount = outcomes.filter((o) => o.status === "ACTIVE").length

  return (
    <PmShell maxWidth="6xl">
      <BackLink />

      {/* Hero */}
      <div className="pm-panel mb-6 overflow-hidden">
        <div className="flex flex-col gap-4 p-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="pm-chip">{round.market_type}</span>
              <span className={`pm-chip ${isOpen && !locked ? "" : "pm-chip-muted"}`}>
                {locked && isOpen ? "LOCKED" : round.status}
              </span>
              <span className="pm-chip pm-chip-muted">Stake in {currency}</span>
              {rakeBps > 0 && (
                <span className="pm-chip pm-chip-muted">{(rakeBps / 100).toFixed(2).replace(/\.00$/, "")}% rake</span>
              )}
            </div>
            <h1 className="pm-display text-2xl text-foreground sm:text-3xl">
              {round.market_type.charAt(0) + round.market_type.slice(1).toLowerCase()} KOL Performance Round
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
              Bet YES or NO on each KOL. Winners split both pools pro-rata, minus rake.
            </p>
            <div className="mt-3">
              <FeeWaiverBadge qualifies={connected && feeWaived ? true : undefined} />
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
            <CountdownPill lockTs={round.lock_ts} closed={bettingClosed} />
            <div className="flex items-center gap-2">
              {connected ? (
                <Link
                  href="/pm/me"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Wallet className="h-3.5 w-3.5" />
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatAmount(available, 3)} {currency}
                  </span>
                </Link>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setVisible(true)}>
                  Connect wallet
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={handleRefresh} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-2 gap-px border-t border-[var(--pm-line)] bg-[var(--pm-line)] md:grid-cols-4">
          <HeroStat icon={<TrendingUp className="h-4 w-4" />} label="Total volume" value={`${formatCompact(summary.totalPool)} ${currency}`} />
          <HeroStat icon={<Droplets className="h-4 w-4" />} label="Liquidity (YES/NO)" value={`${formatCompact(summary.yesPool)} / ${formatCompact(summary.noPool)}`} />
          <HeroStat icon={<Users className="h-4 w-4" />} label="Total bettors" value={String(summary.bettorCount)} />
          <HeroStat icon={<Layers className="h-4 w-4" />} label="Markets" value={`${activeCount} active${settledCount > 0 ? ` · ${settledCount} settled` : ""}`} />
        </div>
      </div>

      {!connected && (
        <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-xl border border-[var(--pm-line)] bg-[rgba(4,8,6,0.5)] p-4 text-sm text-muted-foreground sm:flex-row sm:items-center">
          <span>
            Connect a wallet and deposit collateral on your{" "}
            <Link href="/pm/me" className="text-emerald-400 hover:underline">
              account page
            </Link>{" "}
            to start betting.
          </span>
          <Button size="sm" onClick={() => setVisible(true)} className="gap-2">
            <Wallet className="h-4 w-4" /> Connect wallet
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Outcomes */}
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="pm-display text-lg text-foreground">
              Markets <span className="text-muted-foreground">({outcomes.length})</span>
            </h2>
            {outcomes.length > 1 && (
              <div className="relative inline-flex items-center">
                <ArrowUpDown className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as OutcomeSort)}
                  aria-label="Sort outcomes"
                  className="pm-input h-9 cursor-pointer appearance-none pl-8 pr-8 text-sm font-semibold"
                >
                  <option value="volume">Top volume</option>
                  <option value="yes">Highest YES</option>
                  <option value="no">Highest NO</option>
                  <option value="az">A–Z</option>
                </select>
                <ChevronRight className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 rotate-90 text-muted-foreground" />
              </div>
            )}
          </div>

          {outcomes.length === 0 ? (
            <div className="pm-panel p-12 text-center">
              <h3 className="pm-display text-lg text-foreground">No outcomes yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Outcomes appear once the KOL lineup for this round is set.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {sortedOutcomes.map((o) => (
                <OutcomeCard
                  key={o.outcome_id}
                  outcome={o}
                  collateralMint={round.collateral_mint}
                  bettingClosed={bettingClosed}
                  available={available}
                  rakeBps={rakeBps}
                  feeWaived={connected && feeWaived ? true : undefined}
                  onBetPlaced={onBetPlaced}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <PayoutExplainer rakeBps={rakeBps} />

          {/* Leaderboard snapshot */}
          {summary.totalPool > 0 && (
            <div className="pm-panel p-5">
              <h3 className="mb-3 flex items-center gap-2 pm-display text-sm">
                <Trophy className="h-4 w-4 text-emerald-400" /> Leaderboard
              </h3>
              <div className="space-y-1">
                {outcomes
                  .slice()
                  .sort((a, b) => Number(b.total_pool ?? 0) - Number(a.total_pool ?? 0))
                  .slice(0, 5)
                  .map((o, i) => {
                    const name =
                      o.kols?.display_name && o.kols.display_name.length > 0
                        ? o.kols.display_name
                        : shortAddress(o.kol_wallet_address)
                    const pct = impliedYesPct(o.yes_pool, o.no_pool, o.yes_prob)
                    return (
                      <div key={o.outcome_id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                            i === 0
                              ? "bg-[rgba(57,255,20,0.18)] text-emerald-300"
                              : "bg-white/5 text-muted-foreground"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="tabular-nums">{formatCompact(o.total_pool ?? 0)}</span>
                          <span
                            className={`tabular-nums font-bold ${pct >= 50 ? "pm-figure-glow text-emerald-400" : "text-red-400"}`}
                          >
                            {pct}%
                          </span>
                        </span>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Round meta */}
          <div className="pm-panel p-5 text-xs text-muted-foreground">
            <h3 className="mb-3 pm-display text-sm text-foreground">Round details</h3>
            <dl className="space-y-2">
              <MetaRow label="Opens" value={new Date(round.start_ts).toLocaleString()} />
              <MetaRow label="Locks" value={new Date(round.lock_ts).toLocaleString()} />
              <MetaRow label="Settles" value={new Date(round.settle_ts).toLocaleString()} />
              <MetaRow label="Collateral" value={currency} />
              <MetaRow label="Round ID" value={shortAddress(round.round_id)} mono />
            </dl>
          </div>
        </aside>
      </div>
    </PmShell>
  )
}

function BackLink() {
  return (
    <Link href="/pm" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Back to markets
    </Link>
  )
}

function HeroStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-[rgba(4,8,6,0.55)] px-5 py-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="text-emerald-400">{icon}</span>
        {label}
      </div>
      <div className="pm-figure mt-1 text-base text-foreground">{value}</div>
    </div>
  )
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>{label}</dt>
      <dd className={`text-foreground ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  )
}
