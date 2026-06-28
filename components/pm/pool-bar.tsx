"use client"

import { cn } from "@/lib/utils"
import { formatCompact, impliedYesPct } from "./pm-client"

type PoolBarProps = {
  yesPool: number
  noPool: number
  // Implied YES probability in [0,1]; if null we derive from the pools.
  yesProb?: number | null
  // "thin" (default) is the compact card bar; "thick" is the detail hero bar.
  variant?: "thin" | "thick"
  // Show the pool amounts under each side label.
  showAmounts?: boolean
  currency?: string
  className?: string
}

/**
 * Horizontal split bar showing the YES (emerald) vs NO (red) share of a
 * parimutuel pool, with the implied YES probability as the headline number.
 * Empty pools render a neutral 50/50 split. The "thick" variant adds a center
 * seam and larger percentages for the market-detail hero.
 */
export function PoolBar({
  yesPool,
  noPool,
  yesProb,
  variant = "thin",
  showAmounts = false,
  currency,
  className,
}: PoolBarProps) {
  const total = (Number(yesPool) || 0) + (Number(noPool) || 0)
  const hasLiquidity = total > 0
  const yesPct = impliedYesPct(yesPool, noPool, yesProb)
  const noPct = 100 - yesPct

  const barHeight = variant === "thick" ? "h-3" : "h-2"
  const pctText = variant === "thick" ? "text-sm" : "text-xs"

  return (
    <div className={cn(variant === "thick" ? "space-y-2" : "space-y-1.5", className)}>
      <div className={cn("flex items-end justify-between font-medium", pctText)}>
        <div className="flex flex-col">
          <span className="text-emerald-400">
            YES <span className="tabular-nums">{hasLiquidity ? yesPct : 50}%</span>
          </span>
          {showAmounts && (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {formatCompact(yesPool)}
              {currency ? ` ${currency}` : ""}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end">
          <span className="text-red-400">
            NO <span className="tabular-nums">{hasLiquidity ? noPct : 50}%</span>
          </span>
          {showAmounts && (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {formatCompact(noPool)}
              {currency ? ` ${currency}` : ""}
            </span>
          )}
        </div>
      </div>
      <div className={cn("flex w-full overflow-hidden rounded-full bg-muted/50", barHeight)}>
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500"
          style={{ width: `${hasLiquidity ? yesPct : 50}%` }}
        />
        <div className="h-full w-px bg-background/60" />
        <div
          className="h-full flex-1 bg-gradient-to-r from-rose-500 to-red-500 transition-all duration-500"
        />
      </div>
      {!hasLiquidity && (
        <div className="text-[11px] text-muted-foreground">No bets yet — be the first to set the line.</div>
      )}
    </div>
  )
}
