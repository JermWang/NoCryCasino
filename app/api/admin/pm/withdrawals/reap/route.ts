import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { withRpcFallback } from "@/lib/solana/rpc"
import { isUsdcMint, usdcUnits } from "@/lib/solana/spl"

export const runtime = "nodejs"

type Body = {
  limit?: number
  min_age_minutes?: number
  dry_run?: boolean
}

/** All configured escrow addresses (any of them may have paid the withdrawal). */
function getEscrowAddresses(): Set<string> {
  const set = new Set<string>()
  const list = process.env.ESCROW_WALLET_ADDRESSES
  if (typeof list === "string") {
    list.split(",").map((s) => s.trim()).filter((s) => s.length > 0).forEach((a) => set.add(a))
  }
  for (const k of ["PM_ESCROW_WALLET_ADDRESS", "ESCROW_WALLET_1_ADDRESS", "ESCROW_WALLET_2_ADDRESS", "ESCROW_WALLET_3_ADDRESS"]) {
    const v = process.env[k]
    if (typeof v === "string" && v.trim().length > 0) set.add(v.trim())
  }
  return set
}

/**
 * Scan the destination's recent transactions for a landed SOL payout of EXACTLY
 * `lamports` from one of our escrow wallets, at/after the send window. Returns the
 * signature if found, else null. Exact-amount + escrow-source match makes a false
 * positive extremely unlikely.
 */
async function findLandedSol(destination: string, lamports: number, sinceMs: number, escrow: Set<string>): Promise<string | null> {
  const { PublicKey } = await import("@solana/web3.js")
  const destPk = new PublicKey(destination)
  return withRpcFallback(
    async (connection) => {
      const sigs = await connection.getSignaturesForAddress(destPk, { limit: 40 })
      for (const s of sigs) {
        if (s.err) continue
        // Signatures come newest-first; stop once we pass below the send window.
        if (typeof s.blockTime === "number" && s.blockTime * 1000 < sinceMs - 180_000) break
        const tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
        if (!tx || tx.meta?.err) continue
        const keys = tx.transaction.message.accountKeys.map((k: any) => k.pubkey.toBase58())
        const idx = keys.indexOf(destination)
        if (idx < 0) continue
        const pre = tx.meta?.preBalances?.[idx]
        const post = tx.meta?.postBalances?.[idx]
        if (typeof pre !== "number" || typeof post !== "number") continue
        if (post - pre !== lamports) continue
        if (!keys.some((k: string) => escrow.has(k))) continue
        return s.signature
      }
      return null
    },
    { maxRetries: 2, retryDelayMs: 500 },
  )
}

/**
 * Scan the destination ATA's recent transactions for a landed USDC payout whose
 * token-balance delta for (destination owner, mint) equals `amountHuman`, from an
 * escrow wallet. Returns the signature if found, else null.
 */
async function findLandedUsdc(destination: string, amountHuman: number, mint: string, sinceMs: number, escrow: Set<string>): Promise<string | null> {
  const { PublicKey } = await import("@solana/web3.js")
  const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = await import("@solana/spl-token")
  const wantUnits = usdcUnits(amountHuman).toString()
  const mintPk = new PublicKey(mint)
  const destPk = new PublicKey(destination)
  const destAta = getAssociatedTokenAddressSync(mintPk, destPk, true, TOKEN_PROGRAM_ID)
  return withRpcFallback(
    async (connection) => {
      const sigs = await connection.getSignaturesForAddress(destAta, { limit: 40 })
      for (const s of sigs) {
        if (s.err) continue
        if (typeof s.blockTime === "number" && s.blockTime * 1000 < sinceMs - 180_000) break
        const tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
        if (!tx || tx.meta?.err) continue
        const keys = tx.transaction.message.accountKeys.map((k: any) => k.pubkey.toBase58())
        if (!keys.some((k: string) => escrow.has(k))) continue
        const pre: any[] = Array.isArray(tx.meta?.preTokenBalances) ? (tx.meta!.preTokenBalances as any[]) : []
        const post: any[] = Array.isArray(tx.meta?.postTokenBalances) ? (tx.meta!.postTokenBalances as any[]) : []
        const preByIdx = new Map<number, any>()
        for (const b of pre) preByIdx.set(b.accountIndex, b)
        for (const b of post) {
          if (b?.mint !== mint || b?.owner !== destination) continue
          const postAmt = /^\d+$/.test(String(b?.uiTokenAmount?.amount)) ? BigInt(b.uiTokenAmount.amount) : BigInt(0)
          const preB = preByIdx.get(b.accountIndex)
          const preAmt = /^\d+$/.test(String(preB?.uiTokenAmount?.amount)) ? BigInt(preB.uiTokenAmount.amount) : BigInt(0)
          if ((postAmt - preAmt).toString() === wantUnits) return s.signature
        }
      }
      return null
    },
    { maxRetries: 2, retryDelayMs: 500 },
  )
}

/**
 * Recover withdrawals stranded in SENDING (worker crashed/timed out between the
 * balance-debiting claim and mark-sent/fail). For each stuck row older than the
 * min age (well past blockhash expiry, so the original attempt can never land):
 *   - if an on-chain payout matching (destination, exact amount, escrow source)
 *     is found -> mark SENT with that signature;
 *   - otherwise -> return to REQUESTED so the processor retries.
 * If the on-chain scan errors, the row is left SENDING (safe) for the next tick.
 */
export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:pm:withdrawals:reap", limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const body = (await request.json().catch(() => ({}))) as Body
    const dry_run = body?.dry_run === true
    const minAgeMinutes = Math.min(
      240,
      Math.max(3, typeof body?.min_age_minutes === "number" && Number.isFinite(body.min_age_minutes) ? Math.floor(body.min_age_minutes) : 8),
    )
    const limit = Math.min(100, Math.max(1, typeof body?.limit === "number" && Number.isFinite(body.limit) ? Math.floor(body.limit) : 20))

    const cutoffIso = new Date(Date.now() - minAgeMinutes * 60_000).toISOString()
    const supabase = createServiceClient()

    const { data: rows, error } = await supabase
      .from("escrow_withdrawals")
      .select("withdrawal_id, amount, mint, destination_pubkey, processing_nonce, processing_at")
      .eq("status", "SENDING")
      .is("tx_sig", null)
      .lt("processing_at", cutoffIso)
      .order("processing_at", { ascending: true })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const stuck = Array.isArray(rows) ? rows : []
    const escrow = getEscrowAddresses()
    const results: any[] = []

    for (const w of stuck) {
      const withdrawal_id = String((w as any)?.withdrawal_id ?? "")
      const processing_nonce = String((w as any)?.processing_nonce ?? "")
      const destination = String((w as any)?.destination_pubkey ?? "")
      const amount = Number((w as any)?.amount)
      const mint = String((w as any)?.mint ?? "SOL").trim() || "SOL"
      const sinceMs = Date.parse(String((w as any)?.processing_at ?? "")) || Date.now()

      if (!withdrawal_id || !processing_nonce || !destination || !Number.isFinite(amount) || amount <= 0) {
        results.push({ withdrawal_id, ok: false, error: "invalid stuck row" })
        continue
      }

      if (dry_run) {
        results.push({ withdrawal_id, mint, amount, destination, would_scan: true })
        continue
      }

      try {
        let landedSig: string | null = null
        if (mint === "SOL") {
          landedSig = await findLandedSol(destination, Math.round(amount * 1e9), sinceMs, escrow)
        } else if (isUsdcMint(mint)) {
          landedSig = await findLandedUsdc(destination, amount, mint, sinceMs, escrow)
        } else {
          results.push({ withdrawal_id, action: "left_sending", reason: "unsupported mint" })
          continue
        }

        if (landedSig) {
          // Payout already landed — record it so the user is not paid twice.
          const { error: mErr } = await supabase.rpc("pm_mark_withdrawal_sent", {
            p_withdrawal_id: withdrawal_id,
            p_processing_nonce: processing_nonce,
            p_tx_sig: landedSig,
          })
          results.push({ withdrawal_id, action: "marked_sent", tx_sig: landedSig, error: mErr?.message ?? null })
        } else {
          // No payout on-chain and the original attempt's blockhash has long expired
          // -> safe to requeue for a fresh send.
          const { data, error: rErr } = await supabase.rpc("pm_reclaim_stuck_withdrawal", {
            p_withdrawal_id: withdrawal_id,
            p_processing_nonce: processing_nonce,
          })
          results.push({ withdrawal_id, action: "reclaimed", result: data ?? null, error: rErr?.message ?? null })
        }
      } catch (e: any) {
        // On-chain scan failed — leave the row SENDING (safe) and retry next tick.
        results.push({ withdrawal_id, action: "deferred", error: e?.message ?? String(e) })
      }
    }

    return NextResponse.json({ ok: true, dry_run, min_age_minutes: minAgeMinutes, reaped: results.length, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
