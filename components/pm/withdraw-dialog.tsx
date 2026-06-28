"use client"

import { useEffect, useMemo, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { toast } from "sonner"
import { ArrowRight, AlertCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { base64FromBytes, buildPmMessage, formatAmount, makeNonce, mintLabel, SOL_MINT } from "./pm-client"
import type { BalanceRow } from "./types"

type WithdrawDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  balances: BalanceRow[]
  // Pre-select a mint when opened from a specific balance card.
  initialMint?: string
  onWithdrawn?: () => void
}

/** Request a withdrawal of available collateral to an external Solana address. */
export function WithdrawDialog({ open, onOpenChange, balances, initialMint, onWithdrawn }: WithdrawDialogProps) {
  const { publicKey, connected, signMessage } = useWallet()

  const [mint, setMint] = useState<string>(initialMint ?? SOL_MINT)
  const [destination, setDestination] = useState("")
  const [amount, setAmount] = useState("0.1")
  const [submitting, setSubmitting] = useState(false)

  const mints = useMemo(() => {
    const set = new Set<string>(balances.map((b) => b.mint))
    set.add(SOL_MINT)
    return Array.from(set)
  }, [balances])

  useEffect(() => {
    if (open) {
      setMint(initialMint ?? balances[0]?.mint ?? SOL_MINT)
      setDestination(publicKey?.toBase58() ?? "")
      setSubmitting(false)
    }
  }, [open, initialMint, balances, publicKey])

  const available = useMemo(() => {
    const row = balances.find((b) => b.mint === mint)
    return row ? Number(row.available_collateral) : 0
  }, [balances, mint])

  const numericAmount = Number(amount)
  const amountValid = Number.isFinite(numericAmount) && numericAmount > 0
  const overBalance = amountValid && numericAmount > available + 1e-9
  const destValid = destination.trim().length >= 32

  async function submit() {
    if (!publicKey || !connected || !signMessage) {
      toast.error("Connect wallet", { description: "Connect a Solana wallet that supports message signing." })
      return
    }
    if (!destValid) {
      toast.error("Invalid destination", { description: "Enter a valid Solana address." })
      return
    }
    if (!amountValid) {
      toast.error("Invalid amount", { description: "Amount must be greater than 0." })
      return
    }
    if (overBalance) {
      toast.error("Exceeds balance", { description: `You have ${formatAmount(available, 4)} ${mintLabel(mint)} available.` })
      return
    }

    setSubmitting(true)
    try {
      const wallet_address = publicKey.toBase58()
      const destination_pubkey = destination.trim()
      const issued_at = new Date().toISOString()
      const nonce = makeNonce()
      const idempotency_key = makeNonce()
      const amount_sol = numericAmount

      const message = buildPmMessage("NoCryCasino PM Withdraw Request v1", {
        wallet_address,
        destination_pubkey,
        amount_sol: String(amount_sol),
        mint,
        idempotency_key,
        nonce,
        issued_at,
      })

      const sigBytes = await signMessage(new TextEncoder().encode(message))
      const signature_base64 = base64FromBytes(sigBytes)

      const res = await fetch("/api/pm/withdrawals/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet_address,
          destination_pubkey,
          amount_sol,
          mint,
          idempotency_key,
          nonce,
          issued_at,
          signature_base64,
          message,
        }),
      })

      const json = (await res.json().catch(() => null)) as any
      if (!res.ok || json?.error) throw new Error(humanizeWithdrawError(json?.error))

      toast.success("Withdrawal requested", {
        description: `${formatAmount(amount_sol)} ${mintLabel(mint)} → ${destination_pubkey.slice(0, 4)}…${destination_pubkey.slice(-4)}`,
      })
      onOpenChange(false)
      onWithdrawn?.()
    } catch (e: any) {
      toast.error("Withdrawal failed", { description: e?.message ?? String(e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pm-theme border-[rgba(124,255,107,0.22)] bg-[#070b09]/95 backdrop-blur-xl">
        <DialogHeader>
          <span className="pm-kicker">No Cry Casino</span>
          <DialogTitle className="pm-display text-foreground">Withdraw collateral</DialogTitle>
          <DialogDescription>Send your available balance to an external Solana wallet.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Currency</label>
              <select
                value={mint}
                onChange={(e) => setMint(e.target.value)}
                className="pm-input px-3 py-2 text-sm"
              >
                {mints.map((m) => (
                  <option key={m} value={m}>
                    {mintLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Amount</label>
              <div className="relative">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  aria-invalid={overBalance}
                  className="pm-input px-3 py-2 text-sm tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => setAmount(String(available))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/10"
                >
                  Max
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Available</span>
            <span className="tabular-nums">
              {formatAmount(available, 4)} {mintLabel(mint)}
            </span>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Destination address</label>
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Solana wallet address"
              className="pm-input px-3 py-2 font-mono text-xs"
            />
          </div>

          {overBalance && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5" /> Amount exceeds your available balance.
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || !amountValid || !destValid || overBalance}
            className="pm-btn-green inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.6)]"
          >
            {submitting ? "Requesting…" : "Request withdrawal"}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </button>

          <p className="text-center text-[11px] text-muted-foreground">
            Withdrawals are processed automatically. Reserved (in-play) balance can&apos;t be withdrawn until rounds settle.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function humanizeWithdrawError(code: unknown): string {
  const s = String(code ?? "").trim()
  if (!s) return "Withdrawal failed"
  if (/INSUFFICIENT/i.test(s)) return "Insufficient available balance."
  if (/Emergency halt/i.test(s)) return "Withdrawals are temporarily halted."
  return s
}
