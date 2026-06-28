"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Clock, Lock, Info, Sparkles, ShieldCheck, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { timeUntil, isPastLock } from "./pm-client"

/* -------------------------------------------------------------------------- */
/*  Live countdown pill                                                       */
/* -------------------------------------------------------------------------- */

type CountdownPillProps = {
  lockTs: string | null | undefined
  closed?: boolean
  size?: "sm" | "md"
  className?: string
}

/** A self-ticking "Locks in 1h 23m" / "Betting closed" pill. */
export function CountdownPill({ lockTs, closed, size = "md", className }: CountdownPillProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const isClosed = closed ?? isPastLock(lockTs)
  const label = isClosed ? "Betting closed" : `Locks in ${timeUntil(lockTs)}`
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm"
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border font-semibold uppercase tracking-wide tabular-nums",
        pad,
        isClosed
          ? "border-border/60 bg-muted/30 text-muted-foreground"
          : "border-[rgba(57,255,20,0.4)] bg-[rgba(57,255,20,0.1)] text-emerald-400 [text-shadow:0_0_10px_rgba(57,255,20,0.45)]",
        className,
      )}
    >
      {isClosed ? <Lock className={icon} /> : <Clock className={icon} />}
      {label}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/*  Stat tile                                                                 */
/* -------------------------------------------------------------------------- */

type StatTileProps = {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  accent?: "default" | "emerald" | "red" | "amber"
  className?: string
}

const ACCENT: Record<NonNullable<StatTileProps["accent"]>, string> = {
  default: "text-foreground",
  emerald: "text-emerald-400",
  red: "text-red-400",
  amber: "text-amber-400",
}

/** A compact labelled metric used across market cards and the portfolio. */
export function StatTile({ label, value, sub, icon, accent = "default", className }: StatTileProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-background/30 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("mt-0.5 text-lg font-bold tabular-nums leading-tight", ACCENT[accent])}>
        {value}
      </div>
      {sub != null && <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Odds dial — big implied-probability figure                               */
/* -------------------------------------------------------------------------- */

type OddsDialProps = {
  yesPct: number
  size?: "sm" | "md" | "lg"
  className?: string
}

/** Prominent YES odds figure (Polymarket-style "62%"). */
export function OddsDial({ yesPct, size = "md", className }: OddsDialProps) {
  const pct = Math.min(100, Math.max(0, Math.round(yesPct)))
  const tone = pct >= 50 ? "text-emerald-400 pm-figure-glow" : "text-red-400"
  const num = size === "lg" ? "text-4xl" : size === "sm" ? "text-xl" : "text-2xl"
  return (
    <div className={cn("flex flex-col items-end leading-none", className)}>
      <div className={cn("pm-figure", num, tone)}>{pct}%</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">YES</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Fee-waiver badge                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Badge shown when the connected wallet qualifies for the $NOCRY fee waiver.
 * `qualifies` is typically derived from a placed bet's `fee_exempt` flag; pass
 * undefined to render the generic eligibility note instead.
 */
export function FeeWaiverBadge({ qualifies }: { qualifies?: boolean }) {
  if (qualifies) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(57,255,20,0.45)] bg-[rgba(57,255,20,0.12)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-300 [text-shadow:0_0_10px_rgba(57,255,20,0.5)]">
        <ShieldCheck className="h-3.5 w-3.5" />
        Fees waived · $NOCRY holder
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(124,255,107,0.28)] bg-[rgba(124,255,107,0.06)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-300/90">
      <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
      Hold 10k+ $NOCRY → 0 fees
    </span>
  )
}

/**
 * Prominent fee-waiver call-out for the bet slip. Loud green banner reminding
 * the user that holding 10k $NOCRY waives all rake on winnings.
 */
export function FeeWaiverBanner({ qualifies }: { qualifies?: boolean }) {
  const active = qualifies === true
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3",
        active
          ? "border-[rgba(57,255,20,0.5)] bg-[rgba(57,255,20,0.1)]"
          : "border-[rgba(124,255,107,0.28)] bg-[rgba(124,255,107,0.05)]",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          active ? "bg-[rgba(57,255,20,0.18)]" : "bg-[rgba(124,255,107,0.1)]",
        )}
      >
        <Zap className="h-4 w-4 text-emerald-400" />
      </span>
      <div className="min-w-0 text-xs leading-tight">
        {active ? (
          <>
            <div className="font-bold uppercase tracking-wide text-emerald-300 [text-shadow:0_0_10px_rgba(57,255,20,0.5)]">
              0 fees active
            </div>
            <div className="text-muted-foreground">Your $NOCRY balance waives all rake on winnings.</div>
          </>
        ) : (
          <>
            <div className="font-bold uppercase tracking-wide text-emerald-300">
              Hold 10k $NOCRY → 0 fees
            </div>
            <div className="text-muted-foreground">Otherwise a small rake applies to winnings only.</div>
          </>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  How-payouts-work explainer                                               */
/* -------------------------------------------------------------------------- */

/** Trustworthy, plain-language explainer of the parimutuel payout mechanics. */
export function PayoutExplainer({ rakeBps = 250 }: { rakeBps?: number }) {
  const rakePct = (rakeBps / 100).toFixed(2).replace(/\.00$/, "")
  return (
    <div className="pm-panel p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(57,255,20,0.12)] text-emerald-400">
          <Info className="h-4 w-4" />
        </div>
        <h3 className="pm-display text-sm">How payouts work</h3>
      </div>
      <ol className="space-y-2.5 text-sm text-muted-foreground">
        <li className="flex gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">
            1
          </span>
          <span>
            Every bet on an outcome goes into one of two pools — <span className="font-medium text-emerald-400">YES</span> or{" "}
            <span className="font-medium text-red-400">NO</span>. The split sets the live implied odds.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">
            2
          </span>
          <span>
            When the round settles, the <span className="font-medium text-foreground">winning side splits both pools</span>{" "}
            pro-rata to each bettor&apos;s stake. Bigger stake, bigger share.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">
            3
          </span>
          <span>
            A <span className="font-medium text-foreground">{rakePct}% rake</span> is taken from winnings only. Hold{" "}
            <span className="font-medium text-emerald-400">10,000+ $NOCRY</span> and your bets pay{" "}
            <span className="font-medium text-emerald-400">zero fees</span>.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">
            4
          </span>
          <span>
            If an outcome is cancelled or has no opposing liquidity, stakes are{" "}
            <span className="font-medium text-foreground">refunded</span> in full.
          </span>
        </li>
      </ol>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Avatar with fallback                                                      */
/* -------------------------------------------------------------------------- */

export function KolAvatar({
  src,
  name,
  size = 40,
  className,
  ring = false,
}: {
  src?: string | null
  name: string
  size?: number
  className?: string
  /** Render a glowing neon-green ring (banner-style KOL cards). */
  ring?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const initials = name.trim().slice(0, 2).toUpperCase() || "?"

  const ringCls = ring
    ? "ring-2 ring-[rgba(57,255,20,0.55)] shadow-[0_0_14px_rgba(57,255,20,0.35)]"
    : "ring-1 ring-border/60"

  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/25 to-teal-500/10 text-xs font-bold uppercase text-emerald-300",
          ringCls,
          className,
        )}
        style={{ height: size, width: size }}
      >
        {initials}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full object-cover", ringCls, className)}
      style={{ height: size, width: size }}
    />
  )
}
