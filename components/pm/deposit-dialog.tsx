"use client"

import { useEffect, useMemo, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { toast } from "sonner"
import { Copy, Check, ArrowRight, Info, ChevronDown } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { base64FromBytes, buildPmMessage, makeNonce, mintLabel, shortAddress } from "./pm-client"
import type { RoundRow } from "./types"

type DepositDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeposited?: () => void
}

type OpenRound = RoundRow & { escrow_wallet_pubkey?: string | null }

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"

/**
 * One-click deposit. Collateral is custodied per round: the user picks an OPEN
 * round, enters an amount, and the connected wallet sends SOL straight to that
 * round's escrow — then we credit their balance automatically (no manual
 * copy/paste of a tx signature). A manual "already sent?" fallback is kept for
 * USDC rounds and edge cases.
 */
export function DepositDialog({ open, onOpenChange, onDeposited }: DepositDialogProps) {
  const { publicKey, connected, signMessage, sendTransaction } = useWallet()

  const [rounds, setRounds] = useState<OpenRound[]>([])
  const [loadingRounds, setLoadingRounds] = useState(false)
  const [roundId, setRoundId] = useState<string>("")
  const [amount, setAmount] = useState("0.1")
  const [txSig, setTxSig] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [stage, setStage] = useState<"" | "sending" | "confirming" | "crediting">("")
  const [copied, setCopied] = useState(false)
  const [showManual, setShowManual] = useState(false)

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
  const isSol = currency === "SOL"
  const mint = !isSol && selected?.collateral_mint ? selected.collateral_mint : "SOL"

  const numericAmount = Number(amount)
  const amountValid = Number.isFinite(numericAmount) && numericAmount > 0

  async function copyEscrow() {
    if (!escrow) return
    await navigator.clipboard.writeText(escrow)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  /** Build + sign the on-chain deposit credit request for a known tx signature. */
  async function credit(tx_sig: string) {
    if (!publicKey || !signMessage || !selected) throw new Error("Wallet not ready")
    const wallet_address = publicKey.toBase58()
    const issued_at = new Date().toISOString()
    const nonce = makeNonce()
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
    const signature_base64 = base64FromBytes(await signMessage(new TextEncoder().encode(message)))

    const res = await fetch("/api/pm/deposits/credit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet_address, tx_sig, min_amount_sol, mint, round_scope, nonce, issued_at, signature_base64, message }),
    })
    const json = (await res.json().catch(() => null)) as any
    if (!res.ok || json?.error) throw new Error(humanizeDepositError(json?.error))
    return Number(json?.credited_amount ?? json?.credited_amount_sol ?? min_amount_sol)
  }

  /** One-click: wallet sends SOL to escrow, we confirm, then credit. */
  async function depositOneClick() {
    if (!publicKey || !connected || !signMessage || !sendTransaction) {
      toast.error("Connect wallet", { description: "Connect a Solana wallet that supports signing." })
      return
    }
    if (!selected || !escrow) {
      toast.error("No open round", { description: "There is no open round to deposit into right now." })
      return
    }
    if (!amountValid) {
      toast.error("Invalid amount", { description: "Enter an amount greater than 0." })
      return
    }
    if (!isSol) {
      toast.info("USDC deposit", { description: "Send USDC to the escrow, then use ‘Already sent?’ below to credit it." })
      setShowManual(true)
      return
    }

    setSubmitting(true)
    try {
      const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = await import("@solana/web3.js")
      const conn = new Connection(RPC_URL, "confirmed")
      const toPubkey = new PublicKey(escrow)
      const lamports = Math.round(numericAmount * LAMPORTS_PER_SOL)

      setStage("sending")
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed")
      const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey, lamports }),
      )
      const sig = await sendTransaction(tx, conn)

      setStage("confirming")
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed")

      setStage("crediting")
      const credited = await credit(sig)

      toast.success("Deposit credited", { description: `${credited} ${currency} added to your balance.` })
      setTxSig("")
      onOpenChange(false)
      onDeposited?.()
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      toast.error("Deposit failed", {
        description: /reject|denied|user/i.test(msg) ? "Transaction was rejected in your wallet." : msg,
      })
    } finally {
      setSubmitting(false)
      setStage("")
    }
  }

  /** Manual fallback: user already sent funds, just credit by signature. */
  async function submitManual() {
    if (!amountValid) return toast.error("Invalid amount")
    if (txSig.trim().length < 20) return toast.error("Paste the deposit tx signature")
    setSubmitting(true)
    try {
      const credited = await credit(txSig.trim())
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

  const cta = submitting
    ? stage === "sending"
      ? "Approve in your wallet…"
      : stage === "confirming"
        ? "Confirming on-chain…"
        : "Crediting balance…"
    : `Deposit ${amountValid ? numericAmount : ""} ${currency}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pm-theme border-[rgba(124,255,107,0.22)] bg-[#070b09]/95 backdrop-blur-xl">
        <DialogHeader>
          <span className="pm-kicker">No Cry Casino</span>
          <DialogTitle className="pm-display text-foreground">Deposit collateral</DialogTitle>
          <DialogDescription>One click — your wallet sends {currency} and we credit your balance.</DialogDescription>
        </DialogHeader>

        {loadingRounds ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading open rounds…</div>
        ) : rounds.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
            No open round is currently accepting deposits. Check back when a round opens.
          </div>
        ) : (
          <div className="space-y-4">
            {rounds.length > 1 && (
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Round</label>
                <select value={roundId} onChange={(e) => setRoundId(e.target.value)} className="pm-input px-3 py-2 text-sm">
                  {rounds.map((r) => (
                    <option key={r.round_id} value={r.round_id}>
                      {r.market_type} · {mintLabel(r.collateral_mint)} · {shortAddress(r.round_id)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Amount ({currency})</label>
              <div className="flex gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  className="pm-input flex-1 px-3 py-2 text-sm tabular-nums"
                />
                {[0.1, 0.5, 1].map((q) => (
                  <button key={q} type="button" onClick={() => setAmount(String(q))} className="rounded-lg border border-border/60 px-3 text-xs text-muted-foreground hover:text-foreground">
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={depositOneClick}
              disabled={submitting || !amountValid}
              className="pm-btn-green inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.6)]"
            >
              {cta}
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </button>

            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              We verify the transfer on-chain before crediting. Funds are custodied per round and withdrawable any time.
            </p>

            {/* Manual fallback (USDC / already-sent) */}
            <button type="button" onClick={() => setShowManual((s) => !s)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-3 w-3 transition-transform ${showManual ? "rotate-180" : ""}`} /> Already sent it manually?
            </button>
            {showManual && (
              <div className="space-y-2 rounded-xl border border-border/50 bg-background/30 p-3.5">
                <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 p-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{escrow}</code>
                  <button type="button" onClick={copyEscrow} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground" title="Copy escrow address">
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <input value={txSig} onChange={(e) => setTxSig(e.target.value)} placeholder="Paste deposit tx signature" className="pm-input w-full px-3 py-2 font-mono text-xs" />
                <button type="button" onClick={submitManual} disabled={submitting} className="pm-btn-green-outline inline-flex h-9 w-full items-center justify-center rounded-lg text-sm">
                  Credit by signature
                </button>
                <p className="text-[11px] text-muted-foreground">Send from your connected wallet ({shortAddress(publicKey?.toBase58())}). Other senders won&apos;t be credited.</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function humanizeDepositError(code: unknown): string {
  const s = String(code ?? "").trim()
  if (!s) return "Deposit failed"
  if (/not found/i.test(s)) return "Transaction not confirmed yet — wait a moment and retry."
  if (/too low/i.test(s)) return "The on-chain amount was lower than entered."
  if (/not verified/i.test(s)) return "Couldn't verify a matching transfer to the escrow wallet."
  if (/Emergency halt/i.test(s)) return "Deposits are temporarily halted."
  return s
}
