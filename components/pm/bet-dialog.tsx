"use client"

import { useEffect, useMemo, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { toast } from "sonner"
import { ArrowRight, Wallet, TrendingUp, AlertCircle, Zap } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { OutcomeRow } from "./types"
import { KolAvatar, FeeWaiverBanner } from "./pm-ui"
import {
  base64FromBytes,
  buildPmMessage,
  formatAmount,
  formatCompact,
  impliedYesPct,
  makeNonce,
  mintLabel,
  payoutMultiple,
  previewPayout,
  shortAddress,
  type PmSide,
} from "./pm-client"

type BetDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  outcome: OutcomeRow | null
  side: PmSide
  collateralMint: string
  // Caller may disable betting (round locked / not open).
  disabled?: boolean
  // Optional available balance in the round's mint, for a quick MAX helper.
  available?: number | null
  // Rake in basis points (for the indicative net-of-fee return).
  rakeBps?: number
  // Whether the connected wallet currently qualifies for the $NOCRY fee waiver.
  feeWaived?: boolean
  // Called after a successful bet so the parent can refresh pools/balances.
  onBetPlaced?: () => void
}

const QUICK_AMOUNTS = [0.1, 0.5, 1, 5]

/**
 * Amount-input dialog that places a parimutuel bet. Builds + signs the
 * canonical "NoCryCasino PM Bet v1" message with the connected wallet and
 * POSTs it to /api/pm/bets/place. The signed-message contract is unchanged
 * from the original; only the surrounding UX is richer.
 */
export function BetDialog({
  open,
  onOpenChange,
  outcome,
  side,
  collateralMint,
  disabled,
  available,
  rakeBps = 250,
  feeWaived,
  onBetPlaced,
}: BetDialogProps) {
  const { publicKey, connected, signMessage } = useWallet()
  const { setVisible } = useWalletModal()

  const [amount, setAmount] = useState("0.5")
  const [submitting, setSubmitting] = useState(false)

  const currency = mintLabel(collateralMint)

  // Reset the amount whenever the dialog opens for a fresh outcome/side.
  useEffect(() => {
    if (open) {
      setAmount("0.5")
      setSubmitting(false)
    }
  }, [open, outcome?.outcome_id, side])

  const kolName = useMemo(() => {
    if (!outcome) return ""
    const dn = outcome.kols?.display_name
    return dn && dn.length > 0 ? dn : shortAddress(outcome.kol_wallet_address)
  }, [outcome])

  const yesPool = Number(outcome?.yes_pool ?? 0)
  const noPool = Number(outcome?.no_pool ?? 0)
  const numericAmount = Number(amount)
  const amountValid = Number.isFinite(numericAmount) && numericAmount > 0
  const isYes = side === "YES"

  const balance = typeof available === "number" ? available : null
  const insufficient = balance != null && amountValid && numericAmount > balance + 1e-9

  // Implied odds shift this bet would cause (purely indicative).
  const oddsNow = impliedYesPct(yesPool, noPool, outcome?.yes_prob)
  const oddsAfter = useMemo(() => {
    if (!amountValid) return oddsNow
    return impliedYesPct(isYes ? yesPool + numericAmount : yesPool, isYes ? noPool : noPool + numericAmount)
  }, [amountValid, isYes, numericAmount, yesPool, noPool, oddsNow])

  const grossReturn = useMemo(
    () => (amountValid ? previewPayout({ amount: numericAmount, side, yesPool, noPool }) : null),
    [amountValid, numericAmount, side, yesPool, noPool],
  )

  // Net of rake (best-effort indicative; the real waiver is decided server-side).
  const netReturn = useMemo(() => {
    if (grossReturn == null) return null
    const profit = grossReturn - numericAmount
    if (profit <= 0) return grossReturn
    const fee = (profit * rakeBps) / 10_000
    return grossReturn - fee
  }, [grossReturn, numericAmount, rakeBps])

  async function placeBet() {
    if (!outcome) return

    if (!connected || !publicKey) {
      onOpenChange(false)
      setVisible(true)
      toast.info("Connect your wallet", { description: "Connect a Solana wallet to place a bet." })
      return
    }

    if (!signMessage) {
      toast.error("Wallet unsupported", { description: "Your wallet doesn't support message signing." })
      return
    }

    if (!amountValid) {
      toast.error("Invalid amount", { description: "Enter an amount greater than 0." })
      return
    }

    if (insufficient) {
      toast.error("Insufficient balance", {
        description: `You have ${formatAmount(balance ?? 0, 3)} ${currency}. Deposit more on your account page.`,
      })
      return
    }

    setSubmitting(true)
    try {
      const wallet_address = publicKey.toBase58()
      const issued_at = new Date().toISOString()
      const nonce = makeNonce()
      const idempotency_key = makeNonce()
      // Send the amount as a stable string in BOTH the signed message and the
      // body so the server's String(amount) re-derivation matches our signature.
      const amountStr = String(numericAmount)

      const message = buildPmMessage("NoCryCasino PM Bet v1", {
        outcome_id: outcome.outcome_id,
        wallet_address,
        side,
        amount: amountStr,
        idempotency_key,
        nonce,
        issued_at,
      })

      const sigBytes = await signMessage(new TextEncoder().encode(message))
      const signature_base64 = base64FromBytes(sigBytes)

      const res = await fetch("/api/pm/bets/place", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcome_id: outcome.outcome_id,
          wallet_address,
          side,
          amount: numericAmount,
          idempotency_key,
          nonce,
          issued_at,
          signature_base64,
          message,
        }),
      })

      const json = (await res.json().catch(() => null)) as any
      if (!res.ok || json?.ok === false || json?.error) {
        throw new Error(humanizeBetError(json?.error))
      }

      if (json?.duplicate) {
        toast.success("Bet already placed", { description: "This bet was already recorded." })
      } else {
        toast.success(`${side} bet placed`, {
          description: `${formatAmount(numericAmount)} ${currency} on ${kolName}${
            json?.fee_exempt ? " · 0% fee ($NOCRY)" : ""
          }`,
        })
      }

      onOpenChange(false)
      onBetPlaced?.()
    } catch (e: any) {
      toast.error("Bet failed", { description: e?.message ?? String(e) })
    } finally {
      setSubmitting(false)
    }
  }

  const multiplier = payoutMultiple(numericAmount, netReturn)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pm-theme border-[rgba(124,255,107,0.22)] bg-[#070b09]/95 backdrop-blur-xl">
        <DialogHeader>
          <div className="mb-1 flex items-center justify-between">
            <span className="pm-kicker">Bet Slip</span>
            <span className="pm-chip pm-chip-muted">{currency}</span>
          </div>
          <DialogTitle className="flex items-center gap-3">
            <KolAvatar src={outcome?.kols?.avatar_url} name={kolName} size={40} className="h-10 w-10" ring />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-base font-bold text-foreground">{kolName}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {outcome?.question_text ? "Market" : "Will be #1 this week?"}
              </span>
            </div>
          </DialogTitle>
          <DialogDescription className="line-clamp-2 text-left">
            {outcome?.question_text ?? "Will be #1 this week? Stake into this outcome's parimutuel pool."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Selected side pill + odds */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--pm-line)] bg-[rgba(4,8,6,0.6)] p-3">
            <span
              className={cn(
                "inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-extrabold uppercase tracking-wide",
                isYes
                  ? "bg-[rgba(57,255,20,0.16)] text-emerald-300 [text-shadow:0_0_10px_rgba(57,255,20,0.5)]"
                  : "bg-[rgba(255,77,77,0.14)] text-red-300",
              )}
            >
              {side}
            </span>
            <div className="flex items-center gap-4 text-right">
              <div className="leading-none">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Odds</div>
                <div className={cn("pm-figure text-lg", isYes ? "text-emerald-400" : "text-red-400")}>
                  {multiplier}
                </div>
              </div>
              <div className="leading-none">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Implied</div>
                <div className="pm-figure text-lg text-foreground">{isYes ? oddsNow : 100 - oddsNow}%</div>
              </div>
            </div>
          </div>

          {/* Live pools */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-[rgba(57,255,20,0.2)] bg-[rgba(57,255,20,0.06)] p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">YES · {oddsNow}%</div>
              <div className="font-bold tabular-nums text-emerald-400">
                {formatCompact(yesPool)} {currency}
              </div>
            </div>
            <div className="rounded-lg border border-[rgba(255,77,77,0.2)] bg-[rgba(255,77,77,0.06)] p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">NO · {100 - oddsNow}%</div>
              <div className="font-bold tabular-nums text-red-400">
                {formatCompact(noPool)} {currency}
              </div>
            </div>
          </div>

          {/* Wager amount with SOL/USDC chip */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="bet-amount" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Wager
              </label>
              {balance != null && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Wallet className="h-3 w-3" />
                  <span className="tabular-nums">{formatAmount(balance, 3)}</span> available
                </span>
              )}
            </div>
            <div className="relative">
              <input
                id="bet-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoFocus
                placeholder="0.0"
                aria-invalid={insufficient}
                className="pm-input px-3 py-3 pr-20 text-2xl font-extrabold tabular-nums"
              />
              <span className="pm-chip absolute right-2.5 top-1/2 -translate-y-1/2">{currency}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmount(String(q))}
                  className="rounded-md border border-border/50 px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground transition-colors hover:border-[rgba(57,255,20,0.4)] hover:text-emerald-400"
                >
                  {q}
                </button>
              ))}
              {balance != null && balance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(String(balance))}
                  className="rounded-md border border-[rgba(57,255,20,0.3)] bg-[rgba(57,255,20,0.06)] px-2.5 py-1 text-xs font-bold uppercase text-emerald-400 transition-colors hover:bg-[rgba(57,255,20,0.12)]"
                >
                  Max
                </button>
              )}
            </div>
            {insufficient && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle className="h-3.5 w-3.5" />
                Exceeds your {currency} balance.
              </div>
            )}
          </div>

          {/* $NOCRY fee waiver — prominent in the slip */}
          <FeeWaiverBanner qualifies={feeWaived} />

          {/* Return preview */}
          {grossReturn != null && (
            <div className="rounded-xl border border-[var(--pm-line)] bg-[rgba(4,8,6,0.6)] p-3.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Est. return if {side} wins
                </span>
                <span className="rounded-md bg-[rgba(57,255,20,0.12)] px-2 py-0.5 text-xs font-bold tabular-nums text-emerald-400">
                  {multiplier}
                </span>
              </div>
              <div className="pm-figure pm-figure-glow mt-1.5 text-2xl">
                ~{formatAmount(netReturn ?? grossReturn, 3)} {currency}
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  Odds {oddsNow}%{" "}
                  <ArrowRight className="inline h-3 w-3 -translate-y-px" /> {oddsAfter}% after your bet
                </span>
                <span>{feeWaived ? "0% fee · $NOCRY" : `net of ${(rakeBps / 100).toFixed(2).replace(/\.00$/, "")}% rake`}</span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={placeBet}
            disabled={submitting || disabled || !amountValid || insufficient}
            className={cn(
              "flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.6)]",
              isYes ? "pm-btn-green" : "pm-btn-red-outline",
            )}
          >
            <Zap className="h-4 w-4" />
            {submitting
              ? "Placing…"
              : disabled
                ? "Betting closed"
                : !connected
                  ? "Connect wallet to bet"
                  : insufficient
                    ? "Insufficient balance"
                    : `Place Bet · ${formatAmount(numericAmount, 3)} ${currency}`}
          </button>

          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            Winners split both pools pro-rata, minus rake. Hold 10k $NOCRY → 0 fees.
            Final payout depends on pool sizes at lock.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Map known server error codes from pm_place_bet to friendly copy. */
function humanizeBetError(code: unknown): string {
  const s = String(code ?? "").trim()
  if (!s) return "Bet failed"
  if (s.includes("INSUFFICIENT_COLLATERAL"))
    return "Insufficient balance. Deposit collateral on your account page first."
  if (s.includes("ROUND_LOCKED")) return "This round is locked — betting has closed."
  if (s.includes("ROUND_NOT_OPEN")) return "This round is not open for betting."
  if (s.includes("OUTCOME_NOT_ACTIVE")) return "This outcome is no longer active."
  if (s.includes("OUTCOME_NOT_FOUND")) return "Outcome not found."
  if (s.includes("INVALID_AMOUNT")) return "Invalid bet amount."
  if (s.includes("Emergency halt")) return "Betting is temporarily halted."
  return s
}
