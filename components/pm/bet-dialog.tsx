"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { OutcomeRow } from "./types"
import { KolNeonAvatar } from "./market-card-bits"
import { DepositDialog } from "./deposit-dialog"
import {
  base64FromBytes,
  buildPmMessage,
  formatAmount,
  formatCompact,
  impliedYesPct,
  makeNonce,
  mintLabel,
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

/**
 * The No Cry Casino BET SLIP panel (design canvas spec) as a dialog: selected
 * market header, YES/NO toggle with odds·multiplier, a WAGER input with a SOL/
 * USDC chip + quick chips, the dashed payout summary, the $NOCRY "0 fees"
 * banner, and the big glowing PLACE BET button.
 *
 * The signed-message contract + POST to /api/pm/bets/place are UNCHANGED from
 * the original; only the surrounding UX/skin is the design's.
 */
export function BetDialog({
  open,
  onOpenChange,
  outcome,
  side: initialSide,
  collateralMint,
  disabled,
  available,
  rakeBps = 250,
  feeWaived,
  onBetPlaced,
}: BetDialogProps) {
  const { publicKey, connected, signMessage } = useWallet()
  const { setVisible } = useWalletModal()

  const [side, setSide] = useState<PmSide>(initialSide)
  const [amount, setAmount] = useState("0.5")
  const [submitting, setSubmitting] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)

  const currency = mintLabel(collateralMint)
  const isYes = side === "YES"

  // Reset side/amount whenever the dialog opens for a fresh outcome/side.
  useEffect(() => {
    if (open) {
      setSide(initialSide)
      setAmount("0.5")
      setSubmitting(false)
    }
  }, [open, outcome?.outcome_id, initialSide])

  const kolName = useMemo(() => {
    if (!outcome) return ""
    const dn = outcome.kols?.display_name
    return dn && dn.length > 0 ? dn : shortAddress(outcome.kol_wallet_address)
  }, [outcome])

  const yesPool = Number(outcome?.yes_pool ?? 0)
  const noPool = Number(outcome?.no_pool ?? 0)
  const totalPool = Number(outcome?.total_pool ?? yesPool + noPool)
  const numericAmount = Number(amount)
  const amountValid = Number.isFinite(numericAmount) && numericAmount > 0

  const balance = typeof available === "number" ? available : null
  const insufficient = balance != null && amountValid && numericAmount > balance + 1e-9

  const oddsNow = impliedYesPct(yesPool, noPool, outcome?.yes_prob)
  const yesShare = yesPool > 0 ? yesPool : totalPool > 0 ? totalPool : 1
  const noShare = noPool > 0 ? noPool : totalPool > 0 ? totalPool : 1
  const yesMult = totalPool > 0 ? totalPool / yesShare : 1
  const noMult = totalPool > 0 ? totalPool / noShare : 1
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
    if (feeWaived) return grossReturn
    const fee = (profit * rakeBps) / 10_000
    return grossReturn - fee
  }, [grossReturn, numericAmount, rakeBps, feeWaived])

  const feeAmount = useMemo(() => {
    if (grossReturn == null) return 0
    const profit = grossReturn - numericAmount
    if (profit <= 0 || feeWaived) return 0
    return (profit * rakeBps) / 10_000
  }, [grossReturn, numericAmount, rakeBps, feeWaived])

  const netWin = netReturn != null && amountValid ? Math.max(0, netReturn - numericAmount) : 0
  const sideColor = isYes ? "#39FF14" : "#FF5E5E"

  function quick(frac: number | "max") {
    if (frac === "max") {
      const b = balance ?? 0
      setAmount(b > 0 ? String(b) : "0")
      return
    }
    setAmount(String(frac))
  }

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

  const needsDeposit = connected && insufficient
  const placeReady = connected && amountValid && !insufficient && !disabled && !submitting
  const ctaLabel = submitting
    ? "Placing…"
    : disabled
      ? "Betting closed"
      : !connected
        ? "Connect Wallet to Bet"
        : needsDeposit
          ? `Deposit ${currency} to bet →`
          : !amountValid
            ? "Enter a stake"
            : `Place Bet · ${formatAmount(numericAmount, 2)} ${currency}`

  // One tap from the bet slip: connect if needed, open the deposit dialog when
  // the balance is short (no dead "insufficient" wall), otherwise place the bet.
  function onCta() {
    if (!connected || !publicKey) {
      onOpenChange(false)
      setVisible(true)
      return
    }
    if (needsDeposit) {
      setDepositOpen(true)
      return
    }
    void placeBet()
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="pm-theme p-0"
        style={{
          background: "linear-gradient(180deg,rgba(124,255,107,.04),rgba(0,0,0,0)),#0b110d",
          border: "1px solid rgba(124,255,107,.16)",
          borderRadius: 18,
          boxShadow: "0 20px 50px rgba(0,0,0,.5)",
        }}
      >
        <div style={{ padding: 22 }}>
          {/* Header: BET SLIP + balance */}
          <DialogHeader>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <DialogTitle asChild>
                <h3 style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: ".04em", margin: 0, color: "#E6EFE8" }}>
                  BET SLIP
                </h3>
              </DialogTitle>
              <span style={{ fontSize: 11, color: "#84938A", fontFamily: "'JetBrains Mono', monospace" }}>
                Balance {balance != null ? `${formatAmount(balance, 2)} ${currency}` : `— ${currency}`}
              </span>
            </div>
            <DialogDescription className="sr-only">
              Place a parimutuel bet on {kolName}.
            </DialogDescription>
          </DialogHeader>

          {/* Selected market line */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <KolNeonAvatar src={outcome?.kols?.avatar_url} name={kolName || "?"} size={40} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#E6EFE8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {kolName}
              </div>
              <div style={{ fontSize: 12, color: "#6E7C72", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>
                {outcome?.question_text ?? "Stake into this outcome's parimutuel pool."}
              </div>
            </div>
          </div>

          {/* YES / NO toggle */}
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <button type="button" onClick={() => setSide("YES")} style={sideTab(true, isYes)}>
              <div style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 15, color: "#39FF14" }}>YES</div>
              <div style={{ fontSize: 12, color: "#84938A", marginTop: 3 }}>{oddsNow}% · ×{yesMult.toFixed(2)}</div>
            </button>
            <button type="button" onClick={() => setSide("NO")} style={sideTab(false, !isYes)}>
              <div style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 15, color: "#FF5E5E" }}>NO</div>
              <div style={{ fontSize: 12, color: "#84938A", marginTop: 3 }}>{100 - oddsNow}% · ×{noMult.toFixed(2)}</div>
            </button>
          </div>

          {/* WAGER input */}
          <label style={{ fontSize: 12, color: "#84938A", letterSpacing: ".06em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
            Your wager
          </label>
          <div style={{ position: "relative", marginBottom: 10 }}>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              inputMode="decimal"
              autoFocus
              aria-invalid={insufficient}
              className="pm-slip-input"
              style={{
                width: "100%",
                background: "rgba(4,8,6,.7)",
                border: `1px solid ${insufficient ? "rgba(255,94,94,.55)" : "rgba(124,255,107,.2)"}`,
                borderRadius: 12,
                color: "#E6EFE8",
                fontFamily: "'Orbitron', sans-serif",
                fontWeight: 700,
                fontSize: 22,
                padding: "14px 60px 14px 16px",
                outline: "none",
              }}
            />
            <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", fontSize: 13, fontWeight: 600, color: "#7CFF6B" }}>
              {currency}
            </span>
          </div>
          <div style={{ display: "flex", gap: 7, marginBottom: 18 }}>
            {([0.5, 1, 5] as const).map((q) => (
              <button key={q} type="button" onClick={() => quick(q)} style={quickChip()}>
                {q}
              </button>
            ))}
            <button type="button" onClick={() => quick("max")} style={quickChip()}>
              MAX
            </button>
          </div>

          {/* $NOCRY fee-waiver banner */}
          {feeWaived ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 14, padding: "14px 16px", border: "1px solid rgba(57,255,20,.4)", background: "rgba(57,255,20,.08)", marginBottom: 16 }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(57,255,20,.16)", fontSize: 16 }}>⚡</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: ".04em", textTransform: "uppercase", color: "#7CFF6B", textShadow: "0 0 10px rgba(57,255,20,.4)" }}>0 fees active</div>
                <div style={{ fontSize: 12, color: "#84938A", marginTop: 1 }}>Your $NOCRY balance waives all rake.</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 14, padding: "14px 16px", border: "1px solid rgba(124,255,107,.28)", background: "rgba(124,255,107,.05)", marginBottom: 16 }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(124,255,107,.1)", fontSize: 16 }}>◆</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: ".04em", textTransform: "uppercase", color: "#7CFF6B" }}>Hold 10k $NOCRY → 0 fees</div>
                <div style={{ fontSize: 12, color: "#84938A", marginTop: 1 }}>Otherwise a small rake applies to winnings only.</div>
              </div>
            </div>
          )}

          {/* Payout summary */}
          <div style={{ borderTop: "1px dashed rgba(124,255,107,.14)", paddingTop: 16, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <SummaryRow label="Odds multiplier" value={`×${(isYes ? yesMult : noMult).toFixed(2)}`} color={sideColor} mono />
            <SummaryRow
              label="Est. payout"
              value={`${formatAmount(netReturn ?? grossReturn ?? 0, 2)} ${currency}`}
              color="#E6EFE8"
              mono
            />
            <SummaryRow label="To win" value={`+${formatAmount(netWin, 2)} ${currency}`} color="#5CFF7A" mono />
            <SummaryRow
              label="Fee (rake)"
              value={feeWaived ? "0 · waived" : `${formatAmount(feeAmount, 3)} ${currency}`}
              color={feeWaived ? "#7CFF6B" : sideColor}
              mono
            />
            <SummaryRow label="Implied after bet" value={`${isYes ? oddsNow : 100 - oddsNow}% → ${isYes ? oddsAfter : 100 - oddsAfter}%`} color="#84938A" />
          </div>

          {/* Place bet CTA */}
          <button
            type="button"
            onClick={onCta}
            disabled={submitting || disabled}
            style={{
              width: "100%",
              padding: 16,
              borderRadius: 12,
              border: "none",
              cursor: submitting || disabled ? "not-allowed" : "pointer",
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              background: placeReady ? "linear-gradient(180deg,#6CFF4A,#39FF14)" : "rgba(57,255,20,.14)",
              color: placeReady ? "#04130a" : "#7CFF6B",
              boxShadow: placeReady ? "0 10px 30px rgba(57,255,20,.32), inset 0 1px 0 rgba(255,255,255,.4)" : "none",
              transition: "filter .18s ease",
            }}
          >
            {ctaLabel}
          </button>

          <p style={{ textAlign: "center", fontSize: 11, lineHeight: 1.5, color: "#6E7C72", marginTop: 14, marginBottom: 0 }}>
            Winners split both pools pro-rata, minus rake. Hold 10k $NOCRY → 0 fees. Final payout depends on pool sizes at lock.
          </p>
        </div>
      </DialogContent>
    </Dialog>

      {/* Deposit shortcut: opened straight from the bet slip when balance is short. */}
      <DepositDialog
        open={depositOpen}
        onOpenChange={setDepositOpen}
        onDeposited={() => {
          setDepositOpen(false)
          onBetPlaced?.()
        }}
      />
    </>
  )
}

function SummaryRow({ label, value, color, mono }: { label: string; value: string; color: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: "#84938A" }}>{label}</span>
      <span style={{ color, fontWeight: 700, fontFamily: mono ? "'JetBrains Mono', monospace" : undefined }}>{value}</span>
    </div>
  )
}

/** YES/NO toggle tab style (selected = glowing tinted, else faint). */
function sideTab(isYes: boolean, selected: boolean): CSSProperties {
  const c = isYes ? "#39FF14" : "#FF5E5E"
  return {
    flex: 1,
    padding: "14px 12px",
    borderRadius: 12,
    cursor: "pointer",
    textAlign: "center",
    border: `1px solid ${selected ? `${c}99` : "rgba(124,255,107,.12)"}`,
    background: selected ? (isYes ? "rgba(57,255,20,.14)" : "rgba(255,94,94,.12)") : "rgba(255,255,255,.02)",
    boxShadow: selected ? `0 0 24px ${c}33, inset 0 1px 0 ${c}22` : "none",
    transition: "all .18s ease",
  }
}

/** Quick-stake chip style (0.5 / 1 / 5 / MAX). */
function quickChip(): CSSProperties {
  return {
    flex: 1,
    textAlign: "center",
    padding: "8px 0",
    borderRadius: 9,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid rgba(124,255,107,.12)",
    background: "transparent",
    color: "#9FB0A4",
    transition: "background-color .15s ease",
  }
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
