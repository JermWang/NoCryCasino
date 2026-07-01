import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive, logEscrowOperation } from "@/lib/escrow/security"
import { broadcastSignedTransaction, getConnection, withRpcFallback } from "@/lib/solana/rpc"
import { isUsdcMint, getUsdcMint, buildUsdcTransfer, getUsdcAtaBalanceHuman } from "@/lib/solana/spl"
import { getSolPriceUsd } from "@/lib/analytics/snapshot"
import { netSolPayoutLamports, netUsdcPayout } from "@/lib/pm/withdrawal-fees"

export const runtime = "nodejs"

type Body = {
  limit?: number
  dry_run?: boolean
}

function parseSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim()
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed)
    if (!Array.isArray(arr)) throw new Error("SECRET_KEY_JSON_INVALID")
    const bytes = Uint8Array.from(arr)
    if (bytes.length !== 64) throw new Error("SECRET_KEY_LENGTH_INVALID")
    return bytes
  }

  const bytes = Uint8Array.from(Buffer.from(trimmed, "base64"))
  if (bytes.length !== 64) throw new Error("SECRET_KEY_LENGTH_INVALID")
  return bytes
}

function getEscrowWalletConfigs(): Array<{ address: string; secret?: string }> {
  const rawList = process.env.ESCROW_WALLET_ADDRESSES
  const addresses = typeof rawList === "string" && rawList.trim().length > 0 ? rawList.split(",").map((s) => s.trim()) : []

  const a1 = process.env.ESCROW_WALLET_1_ADDRESS
  const a2 = process.env.ESCROW_WALLET_2_ADDRESS
  const a3 = process.env.ESCROW_WALLET_3_ADDRESS

  const list = addresses.length > 0 ? addresses : [a1, a2, a3].filter((v): v is string => typeof v === "string" && v.length > 0)

  const s1 = process.env.ESCROW_WALLET_1_SECRET_KEY
  const s2 = process.env.ESCROW_WALLET_2_SECRET_KEY
  const s3 = process.env.ESCROW_WALLET_3_SECRET_KEY

  const secrets: Array<string | undefined> = [s1, s2, s3]

  return list.slice(0, 3).map((address, idx) => ({ address, secret: secrets[idx] }))
}

async function pickKeypairForLamports(lamports: number): Promise<{ address: string; keypair: any }> {
  const { Keypair, PublicKey } = await import("@solana/web3.js")

  const requested = typeof process.env.PM_ESCROW_WALLET_ADDRESS === "string" ? process.env.PM_ESCROW_WALLET_ADDRESS.trim() : ""

  const all = getEscrowWalletConfigs()
    .filter((c) => typeof c.address === "string" && c.address.trim().length > 0)
    .filter((c) => typeof c.secret === "string" && c.secret.trim().length > 0)

  const candidates = requested ? all.filter((c) => c.address === requested) : all
  if (candidates.length === 0) throw new Error(requested ? "PM_ESCROW_SECRET_MISSING" : "ESCROW_SECRET_MISSING")

  const parsed = candidates.map((c) => {
    new PublicKey(c.address)
    let secret: Uint8Array
    try {
      secret = parseSecretKey(String(c.secret))
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (msg === "SECRET_KEY_LENGTH_INVALID") throw new Error("ESCROW_SECRET_KEY_INVALID_LENGTH")
      throw new Error("ESCROW_SECRET_KEY_INVALID_FORMAT")
    }
    return { address: c.address, keypair: Keypair.fromSecretKey(secret) }
  })

  const feeBufferLamports = 50_000
  const needed = Math.max(0, Math.floor(lamports)) + feeBufferLamports

  return withRpcFallback(async (connection) => {
    for (const p of parsed) {
      const bal = await connection.getBalance(new PublicKey(p.address), "confirmed")
      if (typeof bal === "number" && Number.isFinite(bal) && bal >= needed) return p
    }
    // Fail closed rather than broadcasting from an underfunded wallet.
    throw new Error("ESCROW_SOL_INSUFFICIENT")
  }, { maxRetries: 2, retryDelayMs: 500 })
}

async function sendSol(args: { fromKeypair: any; toAddress: string; lamports: number }): Promise<string> {
  const { PublicKey, SystemProgram, Transaction } = await import("@solana/web3.js")

  const toPubkey = new PublicKey(args.toAddress)

  // Build + sign ONCE, then retry only submit/confirm of the identical bytes. NEVER
  // rebuild/re-sign inside the retry loop: a new blockhash = a new signature that could
  // ALSO land, double-paying escrow. See lib/solana/rpc.ts broadcastSignedTransaction.
  const { rawTx, blockhash, lastValidBlockHeight } = await withRpcFallback(
    async (connection) => {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed")
      const tx = new Transaction({ feePayer: args.fromKeypair.publicKey, recentBlockhash: blockhash })
      tx.add(
        SystemProgram.transfer({
          fromPubkey: args.fromKeypair.publicKey,
          toPubkey,
          lamports: args.lamports,
        }),
      )
      tx.sign(args.fromKeypair)
      return { rawTx: tx.serialize(), blockhash, lastValidBlockHeight }
    },
    { maxRetries: 2, retryDelayMs: 500 },
  )

  return broadcastSignedTransaction({ rawTx, blockhash, lastValidBlockHeight })
}

// Parse all configured escrow keypairs (honors PM_ESCROW_WALLET_ADDRESS).
async function getEscrowKeypairs(): Promise<Array<{ address: string; keypair: any }>> {
  const { Keypair, PublicKey } = await import("@solana/web3.js")

  const requested = typeof process.env.PM_ESCROW_WALLET_ADDRESS === "string" ? process.env.PM_ESCROW_WALLET_ADDRESS.trim() : ""

  const all = getEscrowWalletConfigs()
    .filter((c) => typeof c.address === "string" && c.address.trim().length > 0)
    .filter((c) => typeof c.secret === "string" && c.secret.trim().length > 0)

  const candidates = requested ? all.filter((c) => c.address === requested) : all
  if (candidates.length === 0) throw new Error(requested ? "PM_ESCROW_SECRET_MISSING" : "ESCROW_SECRET_MISSING")

  return candidates.map((c) => {
    new PublicKey(c.address)
    let secret: Uint8Array
    try {
      secret = parseSecretKey(String(c.secret))
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (msg === "SECRET_KEY_LENGTH_INVALID") throw new Error("ESCROW_SECRET_KEY_INVALID_LENGTH")
      throw new Error("ESCROW_SECRET_KEY_INVALID_FORMAT")
    }
    return { address: c.address, keypair: Keypair.fromSecretKey(secret) }
  })
}

// Pick an escrow keypair whose USDC ATA covers `amountHuman` and that holds a
// little SOL for fees / a possible destination-ATA rent. Throws if none does.
async function pickKeypairForUsdc(amountHuman: number, mint: string): Promise<{ address: string; keypair: any }> {
  const { PublicKey } = await import("@solana/web3.js")
  const parsed = await getEscrowKeypairs()
  const minLamportsForFees = 2_500_000

  return withRpcFallback(async (connection) => {
    for (const p of parsed) {
      const bal = await getUsdcAtaBalanceHuman({ connection, owner: p.address, mint })
      if (bal + 1e-9 < amountHuman) continue
      const sol = await connection.getBalance(new PublicKey(p.address), "confirmed")
      if (typeof sol !== "number" || !Number.isFinite(sol) || sol < minLamportsForFees) continue
      return p
    }
    throw new Error("ESCROW_USDC_INSUFFICIENT")
  }, { maxRetries: 2, retryDelayMs: 500 })
}

async function sendUsdc(args: { fromKeypair: any; toOwner: string; amountHuman: number; mint: string }): Promise<string> {
  // Build + sign ONCE (includes any destination-ATA creation), then retry only the
  // submit/confirm of the identical bytes — cannot double-transfer or double-create the ATA.
  const { rawTx, blockhash, lastValidBlockHeight } = await withRpcFallback(
    async (connection) => {
      const tx = await buildUsdcTransfer({
        connection,
        fromOwnerKeypair: args.fromKeypair,
        toOwner: args.toOwner,
        amountHuman: args.amountHuman,
        mint: args.mint,
      })
      const blockhash = tx.recentBlockhash as string
      const currentHeight = await connection.getBlockHeight("confirmed")
      return { rawTx: tx.serialize(), blockhash, lastValidBlockHeight: currentHeight + 150 }
    },
    { maxRetries: 2, retryDelayMs: 500 },
  )

  return broadcastSignedTransaction({ rawTx, blockhash, lastValidBlockHeight })
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:pm:withdrawals:process", limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  const custody = typeof process.env.CUSTODY_MODE === "string" ? process.env.CUSTODY_MODE.trim().toLowerCase() : "single"
  if (custody === "squads") {
    return NextResponse.json({ error: "CUSTODY_MODE=squads not supported by this processor" }, { status: 500 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Body
    const dry_run = body?.dry_run === true
    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.min(100, Math.floor(body.limit)) : 25

    const supabase = createServiceClient()

    const { data: rows, error } = await supabase
      .from("escrow_withdrawals")
      .select("withdrawal_id, user_pubkey, amount, mint, destination_pubkey, tx_sig, status")
      .eq("status", "REQUESTED")
      .is("tx_sig", null)
      .order("created_at", { ascending: true })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const withdrawals = Array.isArray(rows) ? rows : []
    const results: any[] = []

    for (const w of withdrawals) {
      const withdrawal_id = String((w as any)?.withdrawal_id ?? "").trim()
      const toAddress = String((w as any)?.destination_pubkey ?? "").trim()
      const amount = Number((w as any)?.amount)
      const rowMint = String((w as any)?.mint ?? "SOL").trim() || "SOL"
      if (!withdrawal_id || !toAddress || !Number.isFinite(amount) || amount <= 0) {
        results.push({ withdrawal_id, ok: false, error: "Invalid withdrawal row" })
        continue
      }

      const processing_nonce = `${Date.now()}-${withdrawal_id}-${Math.random().toString(16).slice(2)}`

      if (dry_run) {
        results.push({ withdrawal_id, ok: true, dry_run: true, to: toAddress, amount_sol: amount, mint: rowMint })
        continue
      }

      const { data: begin, error: beginErr } = await supabase.rpc("pm_begin_withdrawal_send", {
        p_withdrawal_id: withdrawal_id,
        p_processing_nonce: processing_nonce,
      })

      if (beginErr) {
        results.push({ withdrawal_id, ok: false, error: beginErr.message })
        continue
      }

      const status = String(begin?.status ?? "")
      if (status !== "SENDING") {
        results.push({ withdrawal_id, ok: true, skipped: true, status })
        continue
      }

      // Use the mint claimed under the processing-nonce lock (authoritative).
      const mint = String(begin?.mint ?? rowMint).trim() || "SOL"
      const isUsdc = isUsdcMint(mint)
      const isSol = mint === "SOL"
      if (!isSol && !isUsdc) {
        const failMsg = "UNSUPPORTED_MINT"
        await supabase.rpc("pm_fail_withdrawal", {
          p_withdrawal_id: withdrawal_id,
          p_processing_nonce: processing_nonce,
          p_error: failMsg,
        })
        results.push({ withdrawal_id, ok: false, error: failMsg })
        continue
      }

      try {
        let sig: string
        let escrowAddress: string
        let fromWallet: string | undefined

        if (isUsdc) {
          const usdcMint = getUsdcMint()
          // User pays gas: deduct the SOL fee (+ ATA rent if the recipient ATA must be
          // created) from the payout, priced in USDC, so the house never eats gas.
          const solPriceUsd = await getSolPriceUsd()
          const { sendHuman } = await netUsdcPayout({
            connection: getConnection(),
            destinationOwner: toAddress,
            mint: usdcMint,
            amountHuman: amount,
            solPriceUsd,
          })
          if (!(sendHuman > 0)) throw new Error("AMOUNT_BELOW_NETWORK_FEE")
          const picked = await pickKeypairForUsdc(sendHuman, usdcMint)
          escrowAddress = picked.address
          fromWallet = picked.keypair.publicKey?.toBase58?.() ?? undefined
          sig = await sendUsdc({ fromKeypair: picked.keypair, toOwner: toAddress, amountHuman: sendHuman, mint: usdcMint })
        } else {
          // User pays gas: send (amount − network fee); the escrow's net outflow
          // (payout + fee it pays as signer) equals the amount debited from the user.
          const { sendLamports } = netSolPayoutLamports(amount)
          if (!(sendLamports > 0)) throw new Error("AMOUNT_BELOW_NETWORK_FEE")
          const picked = await pickKeypairForLamports(sendLamports)
          escrowAddress = picked.address
          fromWallet = picked.keypair.publicKey?.toBase58?.() ?? undefined
          sig = await sendSol({ fromKeypair: picked.keypair, toAddress, lamports: sendLamports })
        }

        await logEscrowOperation({
          operation: "payout",
          escrow_address: escrowAddress,
          amount_sol: amount,
          signature: sig,
          from_wallet: fromWallet,
          to_wallet: toAddress,
        })

        const { error: markErr } = await supabase.rpc("pm_mark_withdrawal_sent", {
          p_withdrawal_id: withdrawal_id,
          p_processing_nonce: processing_nonce,
          p_tx_sig: sig,
        })

        if (markErr) {
          results.push({ withdrawal_id, ok: false, error: markErr.message, tx_sig: sig })
          continue
        }

        results.push({ withdrawal_id, ok: true, status: "SENT", mint, tx_sig: sig })
      } catch (e: any) {
        const msg = e?.message ?? String(e)
        await supabase.rpc("pm_fail_withdrawal", {
          p_withdrawal_id: withdrawal_id,
          p_processing_nonce: processing_nonce,
          p_error: msg,
        })
        results.push({ withdrawal_id, ok: false, error: msg })
      }
    }

    return NextResponse.json({ ok: true, dry_run, processed: results.length, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
