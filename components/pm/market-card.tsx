"use client"

import Link from "next/link"
import { Clock, Lock, Users, Layers, TrendingUp, ChevronRight } from "lucide-react"
import { Card } from "@/components/ui/card"
import { PoolBar } from "./pool-bar"
import { CountdownPill, KolAvatar } from "./pm-ui"
import type { RoundSummary } from "./types"
import { formatCompact, impliedYesPct, isPastLock, mintLabel, shortAddress } from "./pm-client"

const TYPE_STYLES: Record<string, string> = {
  DAILY: "bg-[rgba(57,255,20,0.1)] text-emerald-300 border-[rgba(57,255,20,0.28)]",
  WEEKLY: "bg-[rgba(124,255,107,0.08)] text-emerald-300/90 border-[rgba(124,255,107,0.24)]",
  MONTHLY: "bg-[rgba(124,255,107,0.06)] text-emerald-200/80 border-[rgba(124,255,107,0.2)]",
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
    <Link
      href={`/pm/rounds/${encodeURIComponent(round.round_id)}`}
      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.5)]"
    >
      <Card className="pm-panel pm-card-hover h-full gap-3.5 p-5">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                TYPE_STYLES[round.market_type] ?? "bg-muted text-muted-foreground border-border/40"
              }`}
            >
              {round.market_type}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                canBet ? "bg-[rgba(57,255,20,0.1)] text-emerald-400" : "bg-muted text-muted-foreground"
              }`}
            >
              {locked && isOpen ? "LOCKED" : round.status}
            </span>
          </div>
          <span className="pm-chip pm-chip-muted">{currency}</span>
        </div>

        {/* Headline outcome */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {top ? (
              <KolAvatar src={top.kols?.avatar_url} name={topName ?? "?"} size={36} className="h-9 w-9" ring />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(57,255,20,0.1)] text-emerald-400 ring-2 ring-[rgba(57,255,20,0.4)]">
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
            <div className="flex flex-col items-end leading-none">
              <div
                className={`pm-figure text-2xl ${
                  headlinePct >= 50 ? "pm-figure-glow text-emerald-400" : "text-red-400"
                }`}
              >
                {headlinePct}%
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">YES</div>
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
          <div className="rounded-lg border border-border/40 bg-[rgba(4,8,6,0.5)] px-2 py-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Volume
            </div>
            <div className="mt-0.5 font-bold tabular-nums">
              {round.hydrated ? `${formatCompact(round.totalPool)}` : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-[rgba(4,8,6,0.5)] px-2 py-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Users className="h-3 w-3" /> Bettors
            </div>
            <div className="mt-0.5 font-bold tabular-nums">
              {round.hydrated ? round.bettorCount : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-[rgba(4,8,6,0.5)] px-2 py-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Layers className="h-3 w-3" /> Markets
            </div>
            <div className="mt-0.5 font-bold tabular-nums">
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
          <span className="inline-flex items-center gap-0.5 text-xs font-bold uppercase tracking-wide text-emerald-400 opacity-0 transition-opacity group-hover:opacity-100">
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
    <Card className="pm-panel h-full gap-3.5 p-5">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          <div className="pm-skeleton h-5 w-12 rounded-full" />
          <div className="pm-skeleton h-5 w-12 rounded-full" />
        </div>
        <div className="pm-skeleton h-5 w-10 rounded-full" />
      </div>
      <div className="flex items-center gap-2.5">
        <div className="pm-skeleton h-9 w-9 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <div className="pm-skeleton h-4 w-3/4" />
          <div className="pm-skeleton h-3 w-1/2" />
        </div>
      </div>
      <div className="pm-skeleton h-2 w-full rounded-full" />
      <div className="grid grid-cols-3 gap-2">
        <div className="pm-skeleton h-10" />
        <div className="pm-skeleton h-10" />
        <div className="pm-skeleton h-10" />
      </div>
      <div className="pm-skeleton h-8 w-full" />
    </Card>
  )
}
