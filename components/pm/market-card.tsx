"use client"

import Link from "next/link"
import { Clock, Lock, Users, Layers, TrendingUp, ChevronRight } from "lucide-react"
import { Card } from "@/components/ui/card"
import { PoolBar } from "./pool-bar"
import { CountdownPill, KolAvatar } from "./pm-ui"
import type { RoundSummary } from "./types"
import { formatCompact, impliedYesPct, isPastLock, mintLabel, shortAddress } from "./pm-client"

const TYPE_STYLES: Record<string, string> = {
  DAILY: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  WEEKLY: "bg-purple-500/10 text-purple-300 border-purple-500/20",
  MONTHLY: "bg-amber-500/10 text-amber-300 border-amber-500/20",
}

/**
 * A Polymarket/Kalshi-style market card for a parimutuel round. Shows the
 * headline (most-traded) outcome's odds, the round's total volume + bettors,
 * the collateral currency, and a live lock countdown. When pool aggregates
 * haven't hydrated yet, falls back to a lean-but-complete card.
 */
export function MarketCard({ round }: { round: RoundSummary }) {
  const currency = mintLabel(round.collateral_mint)
  const isOpen = round.status === "OPEN"
  const locked = isPastLock(round.lock_ts)
  const canBet = isOpen && !locked
  const top = round.topOutcome
  const topName =
    top?.kols?.display_name && top.kols.display_name.length > 0
      ? top.kols.display_name
      : top
        ? shortAddress(top.kol_wallet_address)
        : null
  const headlinePct =
    round.avgYesProb != null
      ? Math.round(round.avgYesProb * 100)
      : top
        ? impliedYesPct(top.yes_pool, top.no_pool, top.yes_prob)
        : 50

  return (
    <Link href={`/pm/rounds/${encodeURIComponent(round.round_id)}`} className="group block">
      <Card className="h-full gap-3.5 border-border/50 bg-card/40 p-5 backdrop-blur-sm transition-all hover:border-emerald-500/30 hover:bg-card/60 hover:shadow-lg hover:shadow-emerald-500/5">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                TYPE_STYLES[round.market_type] ?? "bg-muted text-muted-foreground border-border/40"
              }`}
            >
              {round.market_type}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                canBet ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"
              }`}
            >
              {locked && isOpen ? "LOCKED" : round.status}
            </span>
          </div>
          <span className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {currency}
          </span>
        </div>

        {/* Headline outcome */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {top ? (
              <KolAvatar src={top.kols?.avatar_url} name={topName ?? "?"} size={36} className="h-9 w-9" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                <TrendingUp className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold leading-tight transition-colors group-hover:text-emerald-400">
                {topName ? `Will ${topName} finish Top-N?` : "KOL Performance Round"}
              </h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {round.outcomeCount > 0
                  ? `${round.outcomeCount} KOL${round.outcomeCount === 1 ? "" : "s"} in this round`
                  : "Lineup pending"}
              </p>
            </div>
          </div>
          {round.hydrated && top && (
            <div className="text-right leading-none">
              <div
                className={`text-2xl font-bold tabular-nums ${
                  headlinePct >= 50 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {headlinePct}%
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">YES</div>
            </div>
          )}
        </div>

        {/* Odds bar */}
        {round.hydrated && top ? (
          <PoolBar yesPool={top.yes_pool ?? 0} noPool={top.no_pool ?? 0} yesProb={top.yes_prob} />
        ) : (
          <div className="h-2 w-full animate-pulse rounded-full bg-muted/40" />
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Volume
            </div>
            <div className="mt-0.5 font-semibold tabular-nums">
              {round.hydrated ? `${formatCompact(round.totalPool)}` : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Users className="h-3 w-3" /> Bettors
            </div>
            <div className="mt-0.5 font-semibold tabular-nums">
              {round.hydrated ? round.bettorCount : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-background/30 px-2 py-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Layers className="h-3 w-3" /> Markets
            </div>
            <div className="mt-0.5 font-semibold tabular-nums">
              {round.hydrated ? round.outcomeCount : "—"}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between border-t border-border/40 pt-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {canBet ? <Clock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {canBet ? <CountdownPlain lockTs={round.lock_ts} /> : "Betting closed"}
          </span>
          <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-400 opacity-0 transition-opacity group-hover:opacity-100">
            Trade <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </Card>
    </Link>
  )
}

/** Inline "Locks in …" text that shares the live ticker from CountdownPill. */
function CountdownPlain({ lockTs }: { lockTs: string }) {
  return (
    <span className="tabular-nums">
      <CountdownPill lockTs={lockTs} size="sm" className="border-0 bg-transparent px-0 py-0 text-muted-foreground" />
    </span>
  )
}

/** Skeleton placeholder card for the loading grid. */
export function MarketCardSkeleton() {
  return (
    <Card className="h-full gap-3.5 border-border/50 bg-card/40 p-5">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          <div className="h-5 w-12 animate-pulse rounded-full bg-muted/40" />
          <div className="h-5 w-12 animate-pulse rounded-full bg-muted/40" />
        </div>
        <div className="h-5 w-10 animate-pulse rounded-full bg-muted/40" />
      </div>
      <div className="flex items-center gap-2.5">
        <div className="h-9 w-9 animate-pulse rounded-full bg-muted/40" />
        <div className="flex-1 space-y-1.5">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted/40" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted/30" />
        </div>
      </div>
      <div className="h-2 w-full animate-pulse rounded-full bg-muted/40" />
      <div className="grid grid-cols-3 gap-2">
        <div className="h-10 animate-pulse rounded-lg bg-muted/30" />
        <div className="h-10 animate-pulse rounded-lg bg-muted/30" />
        <div className="h-10 animate-pulse rounded-lg bg-muted/30" />
      </div>
      <div className="h-8 w-full animate-pulse rounded bg-muted/20" />
    </Card>
  )
}
