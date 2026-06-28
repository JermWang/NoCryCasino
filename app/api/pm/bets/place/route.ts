import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { buildPmMessage, requireFreshIssuedAt, requireSignedBody } from "@/lib/pm/signing"
import { consumePmNonce, isPmNonceRequired } from "@/lib/pm/nonce"
import { isFeeExempt } from "@/lib/pm/fees"

export const runtime = "nodejs"

type Side = "YES" | "NO"

type Body = {
  outcome_id: string
  wallet_address: string
  side: Side
  amount: number
  idempotency_key: string
  nonce?: string
  issued_at: string
  signature_base64: string
  message?: string
}

// User-facing errors raised by pm_place_bet -> map to 400 instead of 500.
const USER_ERRORS = new Set([
  "INSUFFICIENT_COLLATERAL",
  "ROUND_NOT_OPEN",
  "ROUND_LOCKED",
  "OUTCOME_NOT_ACTIVE",
  "OUTCOME_NOT_FOUND",
  "INVALID_AMOUNT",
  "MISSING_IDEMPOTENCY_KEY",
])

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "pm:bets:place", limit: 120, windowMs: 60_000 })
  if (limited) return limited

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const outcome_id = String(body?.outcome_id ?? "").trim()
    const wallet_address = String(body?.wallet_address ?? "").trim()
    const side = body?.side
    const amount = Number(body?.amount)
    const idempotency_key = String(body?.idempotency_key ?? "").trim()
    const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : ""
    const issued_at = String(body?.issued_at ?? "").trim()
    const signature_base64 = String(body?.signature_base64 ?? "").trim()

    if (!outcome_id) return NextResponse.json({ error: "Missing outcome_id" }, { status: 400 })
    if (!wallet_address) return NextResponse.json({ error: "Missing wallet_address" }, { status: 400 })
    if (side !== "YES" && side !== "NO") return NextResponse.json({ error: "Invalid side" }, { status: 400 })
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
    if (!idempotency_key || idempotency_key.length < 8) return NextResponse.json({ error: "Missing idempotency_key" }, { status: 400 })
    if (nonce.length > 0 && nonce.length < 8) return NextResponse.json({ error: "Invalid nonce" }, { status: 400 })
    if (!issued_at) return NextResponse.json({ error: "Missing issued_at" }, { status: 400 })
    if (!signature_base64) return NextResponse.json({ error: "Missing signature_base64" }, { status: 400 })

    const nonceRequired = isPmNonceRequired()
    if (nonceRequired && nonce.length === 0) return NextResponse.json({ error: "Missing nonce" }, { status: 400 })

    const freshness = requireFreshIssuedAt(issued_at, 5 * 60 * 1000)
    if (!freshness.ok) return NextResponse.json({ error: freshness.error }, { status: 400 })

    const expectedMessage = buildPmMessage("NoCryCasino PM Bet v1", {
      outcome_id,
      wallet_address,
      side,
      amount: String(amount),
      idempotency_key,
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
        action: "pm_bet_place",
        issuedAt: issued_at,
      })
      if (!used.ok) return NextResponse.json({ error: used.error }, { status: used.status })
    }

    // Snapshot the $NOCRY fee waiver at bet time (fail-safe: false on any error).
    const fee_exempt = await isFeeExempt(wallet_address)

    const { data, error } = await supabase.rpc("pm_place_bet", {
      p_user_pubkey: wallet_address,
      p_outcome_id: outcome_id,
      p_side: side === "YES",
      p_amount: amount,
      p_idempotency_key: idempotency_key,
      p_fee_exempt: fee_exempt,
    })

    if (error) {
      const code = String(error.message ?? "").trim()
      const status = [...USER_ERRORS].some((e) => code.includes(e)) ? 400 : 500
      return NextResponse.json({ error: code }, { status })
    }

    return NextResponse.json({ ...data, fee_exempt })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
