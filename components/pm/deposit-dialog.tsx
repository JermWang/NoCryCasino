"use client"

import { useEffect, useMemo, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { toast } from "sonner"
import { Copy, Check, ExternalLink, ArrowRight, Info } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { base64FromBytes, buildPmMessage, makeNonce, mintLabel, shortAddress } from "./pm-client"
import type { RoundRow } from "./types"

type DepositDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeposited?: () => void
}

type OpenRound = RoundRow & { escrow_wallet_pubkey?: string | null }

/**
 * Guided deposit flow. Collateral is custodied per round, so a deposit must be
 * scoped to an OPEN round's escrow wallet: the user sends SOL/USDC there, then
 * submits the transaction signature, which the signed credit endpoint verifies
 * on-chain before crediting their available balance.
 */
export function DepositDialog({ open, onOpenChange, onDeposited }: DepositDialogProps) {
  const { publicKey, connected, signMessage } = useWallet()

  const [rounds, setRounds] = useState<OpenRound[]>([])
  const [loadingRounds, setLoadingRounds] = useState(false)
  const [roundId, setRoundId] = useState<string>("")
  const [amount, setAmount] = useState("0.1")
  const [txSig, setTxSig] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    let mounted = true
    setLoadingRounds(true)
    void (async () => {
      try {
        const res = await fetch(`/api/pm/rounds?status=OPEN`)
        const json = (await res.json().catch(() => null)) as any
        const list: OpenRound[] = Array.isArray(json?.rounds) ? json.rounds : []
        const withEscrow = list.filter((r) => typeof r.escrow_wallet_pubkey === "string" && r.escrow_wallet_pubkey)
        if (!mounted) return
        setRounds(withEscrow)
        if (withEscrow[0]) setRoundId(withEscrow[0].round_id)
      } finally {
        if (mounted) setLoadingRounds(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [open])

  const selected = useMemo(() => rounds.find((r) => r.round_id === roundId) ?? null, [rounds, roundId])
  const escrow = selected?.escrow_wallet_pubkey ?? ""
  const currency = mintLabel(selected?.collateral_mint)
  const mint = selected?.collateral_mint && mintLabel(selected.collateral_mint) === "USDC" ? selected.collateral_mint : "SOL"

  const numericAmount = Number(amount)
  const amountValid = Number.isFinite(numericAmount) && numericAmount > 0
  const sigValid = txSig.trim().length >= 20

  async function copyEscrow() {
    if (!escrow) return
    await navigator.clipboard.writeText(escrow)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function submitCredit() {
    if (!publicKey || !connected || !signMessage) {
      toast.error("Connect wallet", { description: "Connect a Solana wallet that supports message signing." })
      return
    }
    if (!selected || !escrow) {
      toast.error("No open round", { description: "There is no open round to deposit into right now." })
      return
    }
    if (!amountValid) {
      toast.error("Invalid amount", { description: "Enter the amount you sent (greater than 0)." })
      return
    }
    if (!sigValid) {
      toast.error("Missing transaction", { description: "Paste the signature of your deposit transfer." })
      return
    }

    setSubmitting(true)
    try {
      const wallet_address = publicKey.toBase58()
      const issued_at = new Date().toISOString()
      const nonce = makeNonce()
      const tx_sig = txSig.trim()
      const min_amount_sol = numericAmount
      const round_scope = selected.round_id

      const message = buildPmMessage("NoCryCasino PM Deposit Credit v1", {
        wallet_address,
        tx_sig,
        min_amount_sol: String(min_amount_sol),
        mint,
        round_scope,
        nonce,
        issued_at,
      })

      const sigBytes = await signMessage(new TextEncoder().encode(message))
      const signature_base64 = base64FromBytes(sigBytes)

      const res = await fetch("/api/pm/deposits/credit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet_address,
          tx_sig,
          min_amount_sol,
          mint,
          round_scope,
          nonce,
          issued_at,
          signature_base64,
          message,
        }),
      })

      const json = (await res.json().catch(() => null)) as any
      if (!res.ok || json?.error) throw new Error(humanizeDepositError(json?.error))

      const credited = Number(json?.credited_amount ?? json?.credited_amount_sol ?? min_amount_sol)
      toast.success("Deposit credited", { description: `${credited} ${currency} added to your balance.` })
      setTxSig("")
      onOpenChange(false)
      onDeposited?.()
    } catch (e: any) {
      toast.error("Deposit failed", { description: e?.message ?? String(e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/60 bg-card/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle>Deposit collateral</DialogTitle>
          <DialogDescription>
            Send {currency} to the round escrow, then submit your transaction to credit your balance.
          </DialogDescription>
        </DialogHeader>

        {loadingRounds ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading open rounds…</div>
        ) : rounds.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
            No open round is currently accepting deposits. Check back when a round opens.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Round selector */}
            {rounds.length > 1 && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Round</label>
                <select
                  value={roundId}
                  onChange={(e) => setRoundId(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none"
                >
                  {rounds.map((r) => (
                    <option key={r.round_id} value={r.round_id}>
                      {r.market_type} · {mintLabel(r.collateral_mint)} · {shortAddress(r.round_id)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Step 1: send to escrow */}
            <div className="rounded-xl border border-border/50 bg-background/30 p-3.5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] text-emerald-400">
                  1
                </span>
                Send {currency} to the escrow wallet
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 p-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{escrow}</code>
                <button
                  type="button"
                  onClick={copyEscrow}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  title="Copy escrow address"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                Send from your connected wallet ({shortAddress(publicKey?.toBase58())}). Other senders won&apos;t be credited.
              </p>
            </div>

            {/* Step 2: amount + sig */}
            <div className="rounded-xl border border-border/50 bg-background/30 p-3.5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] text-emerald-400">
                  2
                </span>
                Confirm your transfer
              </div>
              <div className="space-y-2.5">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Amount sent ({currency})</label>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    className="w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm tabular-nums focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Transaction signature</label>
                  <input
                    value={txSig}
                    onChange={(e) => setTxSig(e.target.value)}
                    placeholder="Paste the deposit tx signature"
                    className="w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 font-mono text-xs focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  {sigValid && (
                    <a
                      href={`https://solscan.io/tx/${txSig.trim()}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
                    >
                      View on Solscan <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>

            <Button
              onClick={submitCredit}
              disabled={submitting || !amountValid || !sigValid}
              className={cn("h-11 w-full gap-2 font-semibold")}
            >
              {submitting ? "Verifying on-chain…" : "Credit my deposit"}
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </Button>

            <p className="text-center text-[11px] text-muted-foreground">
              We verify the transfer on-chain before crediting. Funds are custodied per round.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function humanizeDepositError(code: unknown): string {
  const s = String(code ?? "").trim()
  if (!s) return "Deposit failed"
  if (/not found/i.test(s)) return "That transaction wasn't found yet. Wait for confirmation and retry."
  if (/too low/i.test(s)) return "The on-chain amount was lower than what you entered."
  if (/not verified/i.test(s)) return "Couldn't verify a matching transfer to the escrow wallet."
  if (/Emergency halt/i.test(s)) return "Deposits are temporarily halted."
  return s
}
