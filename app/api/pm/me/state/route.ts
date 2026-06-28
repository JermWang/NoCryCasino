import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { buildPmMessage, requireFreshIssuedAt, requireSignedBody } from "@/lib/pm/signing"
import { consumePmNonce, isPmNonceRequired } from "@/lib/pm/nonce"

export const runtime = "nodejs"

type Body = {
  wallet_address: string
  nonce?: string
  issued_at: string
  signature_base64: string
  message?: string
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "pm:me:state", limit: 120, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 25_000)
  if (tooLarge) return tooLarge

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const wallet_address = String(body?.wallet_address ?? "").trim()
    const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : ""
    const issued_at = String(body?.issued_at ?? "").trim()
    const signature_base64 = String(body?.signature_base64 ?? "").trim()

    if (!wallet_address) return NextResponse.json({ error: "Missing wallet_address" }, { status: 400 })
    if (nonce.length > 0 && nonce.length < 8) return NextResponse.json({ error: "Invalid nonce" }, { status: 400 })
    if (!issued_at) return NextResponse.json({ error: "Missing issued_at" }, { status: 400 })
    if (!signature_base64) return NextResponse.json({ error: "Missing signature_base64" }, { status: 400 })

    const nonceRequired = isPmNonceRequired()
    if (nonceRequired && nonce.length === 0) return NextResponse.json({ error: "Missing nonce" }, { status: 400 })

    const freshness = requireFreshIssuedAt(issued_at, 5 * 60 * 1000)
    if (!freshness.ok) return NextResponse.json({ error: freshness.error }, { status: 400 })

    const expectedMessage = buildPmMessage("NoCryCasino PM Me v1", {
      wallet_address,
      ...(nonce.length > 0 ? { nonce } : {}),
      issued_at,
    })

    if (typeof body?.message === "string" && body.message.length > 0 && body.message !== expectedMessage) {
      return NextResponse.json({ error: "Message mismatch" }, { status: 400 })
    }

    const sigCheck = await requireSignedBody({
      request,
      expectedMessage,
      walletAddress: wallet_address,
      signatureB64: signature_base64,
    })

    if (!sigCheck.ok) return NextResponse.json({ error: sigCheck.error }, { status: sigCheck.status })

    const supabase = createServiceClient()

    if (nonce.length > 0) {
      const used = await consumePmNonce({
        supabase,
        walletAddress: wallet_address,
        nonce,
        action: "pm_me_state",
        issuedAt: issued_at,
      })
      if (!used.ok) return NextResponse.json({ error: used.error }, { status: used.status })
    }

    const [balances, bets, deposits, withdrawals] = await Promise.all([
      supabase.from("user_balances").select("mint, available_collateral, reserved_collateral, updated_at").eq("user_pubkey", wallet_address).limit(100),
      supabase.from("pm_bets").select("bet_id, round_id, outcome_id, user_pubkey, side, amount, mint, fee_exempt, payout, fee, status, idempotency_key, created_at, settled_at").eq("user_pubkey", wallet_address).order("created_at", { ascending: false }).limit(100),
      supabase.from("escrow_deposits").select("deposit_id, user_pubkey, round_scope, amount, mint, tx_sig, status, created_at").eq("user_pubkey", wallet_address).order("created_at", { ascending: false }).limit(200),
      supabase.from("escrow_withdrawals").select("withdrawal_id, user_pubkey, amount, mint, destination_pubkey, tx_sig, status, idempotency_key, processing_nonce, processing_at, error, created_at").eq("user_pubkey", wallet_address).order("created_at", { ascending: false }).limit(200),
    ])

    const anyErr = balances.error || bets.error || deposits.error || withdrawals.error
    if (anyErr) {
      return NextResponse.json({
        error:
          balances.error?.message ||
          bets.error?.message ||
          deposits.error?.message ||
          withdrawals.error?.message ||
          "Failed to load state",
      }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      emergency_halt_active: await isEmergencyHaltActive(),
      wallet_address,
      balances: balances.data ?? [],
      bets: bets.data ?? [],
      deposits: deposits.data ?? [],
      withdrawals: withdrawals.data ?? [],
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
