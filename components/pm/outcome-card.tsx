"use client"

import { useState } from "react"
import { Users, TrendingUp, CheckCircle2, XCircle, Trophy } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { PoolBar } from "./pool-bar"
import { BetDialog } from "./bet-dialog"
import { KolAvatar } from "./pm-ui"
import type { OutcomeRow } from "./types"
import { formatCompact, impliedYesPct, mintLabel, shortAddress, type PmSide } from "./pm-client"

type OutcomeCardProps = {
  outcome: OutcomeRow
  collateralMint: string
  // Disable betting (round not OPEN or past lock).
  bettingClosed?: boolean
  available?: number | null
  rakeBps?: number
  onBetPlaced?: () => void
}

/**
 * Card for one KOL outcome in a parimutuel round: avatar, the live YES/NO odds
 * bar, implied probability, pool sizes, bettor activity, settlement state, and
 * YES/NO buttons that open the BetDialog.
 */
export function OutcomeCard({
  outcome,
  collateralMint,
  bettingClosed,
  available,
  rakeBps = 250,
  onBetPlaced,
}: OutcomeCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [side, setSide] = useState<PmSide>("YES")

  const currency = mintLabel(collateralMint)
  const name =
    outcome.kols?.display_name && outcome.kols.display_name.length > 0
      ? outcome.kols.display_name
      : shortAddress(outcome.kol_wallet_address)

  const yesPool = Number(outcome.yes_pool ?? 0)
  const noPool = Number(outcome.no_pool ?? 0)
  const totalPool = Number(outcome.total_pool ?? yesPool + noPool)
  const yesCount = Number(outcome.yes_bettor_count ?? 0)
  const noCount = Number(outcome.no_bettor_count ?? 0)
  const bettors = yesCount + noCount
  const yesPct = impliedYesPct(yesPool, noPool, outcome.yes_prob)

  const settled = outcome.status === "SETTLED"
  const cancelled = outcome.status === "CANCELLED"
  const disabled = Boolean(bettingClosed) || settled || cancelled || outcome.status !== "ACTIVE"

  function openBet(s: PmSide) {
    setSide(s)
    setDialogOpen(true)
  }

  return (
    <Card className="group gap-4 border-border/60 bg-card/50 p-5 backdrop-blur-sm transition-all hover:border-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <KolAvatar src={outcome.kols?.avatar_url} name={name} size={40} className="h-10 w-10" />
          <div className="min-w-0">
            <div className="truncate font-semibold leading-tight">{name}</div>
            {outcome.kols?.twitter_handle ? (
              <a
                href={outcome.kols.twitter_url ?? `https://x.com/${outcome.kols.twitter_handle}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="truncate text-xs text-muted-foreground hover:text-emerald-400"
              >
                @{outcome.kols.twitter_handle}
              </a>
            ) : (
              <div className="truncate text-xs text-muted-foreground">
                {shortAddress(outcome.kol_wallet_address)}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          {settled ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold",
                outcome.final_outcome
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-red-500/15 text-red-400",
              )}
            >
              {outcome.final_outcome ? (
                <>
                  <Trophy className="h-3 w-3" /> YES won
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3" /> NO won
                </>
              )}
            </span>
          ) : cancelled ? (
            <span className="inline-flex shrink-0 items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              Cancelled
            </span>
          ) : (
            <div className="text-right leading-none">
              <div
                className={cn(
                  "text-xl font-bold tabular-nums",
                  yesPct >= 50 ? "text-emerald-400" : "text-red-400",
                )}
              >
                {yesPct}%
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">YES odds</div>
            </div>
          )}
        </div>
      </div>

      {outcome.question_text ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">{outcome.question_text}</p>
      ) : null}

      <PoolBar yesPool={yesPool} noPool={noPool} yesProb={outcome.yes_prob} />

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-border/50 bg-background/30 px-2.5 py-2">
          <div className="text-muted-foreground">YES pool</div>
          <div className="mt-0.5 font-semibold tabular-nums text-emerald-400">{formatCompact(yesPool)}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/30 px-2.5 py-2">
          <div className="text-muted-foreground">NO pool</div>
          <div className="mt-0.5 font-semibold tabular-nums text-red-400">{formatCompact(noPool)}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/30 px-2.5 py-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <TrendingUp className="h-3 w-3" /> Volume
          </div>
          <div className="mt-0.5 font-semibold tabular-nums">{formatCompact(totalPool)}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {bettors} bettor{bettors === 1 ? "" : "s"}
        </span>
        <span className="text-emerald-400/80">{yesCount} YES</span>
        <span className="text-red-400/80">{noCount} NO</span>
      </div>

      {settled ? (
        <div className="flex items-center justify-center gap-1.5 rounded-lg border border-border/50 bg-muted/20 py-2.5 text-xs font-medium text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5" /> Settled — payouts distributed
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => openBet("YES")}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Bet YES · {yesPct}%
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => openBet("NO")}
            className="rounded-lg border border-red-500/30 bg-red-500/10 py-2.5 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Bet NO · {100 - yesPct}%
          </button>
        </div>
      )}

      <BetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        outcome={outcome}
        side={side}
        collateralMint={collateralMint}
        disabled={disabled}
        available={available}
        rakeBps={rakeBps}
        onBetPlaced={onBetPlaced}
      />
    </Card>
  )
}
