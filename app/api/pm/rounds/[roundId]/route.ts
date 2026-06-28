import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

export const runtime = "nodejs"

export async function GET(_request: NextRequest, context: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await context.params
    const decoded = typeof roundId === "string" ? decodeURIComponent(roundId) : ""
    if (!decoded) return NextResponse.json({ error: "Missing roundId" }, { status: 400 })

    const supabase = createServiceClient()

    const { data: round, error: roundErr } = await supabase
      .from("market_rounds")
      .select(
        "round_id, market_type, start_ts, lock_ts, settle_ts, status, collateral_mint, escrow_wallet_pubkey, rake_bps, inputs_hash, snapshot_hash, created_at, updated_at",
      )
      .eq("round_id", decoded)
      .maybeSingle()

    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 })
    if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 })

    const { data: outcomes, error: outcomesErr } = await supabase.rpc("pm_round_outcomes", { p_round_id: decoded })

    if (outcomesErr) return NextResponse.json({ error: outcomesErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, round, outcomes: outcomes ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
