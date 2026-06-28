import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

export const runtime = "nodejs"

const VALID_STATUSES = new Set(["OPEN", "LOCKED", "SETTLING", "SETTLED", "CANCELLED"])

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const statusRaw = (url.searchParams.get("status") ?? "OPEN").toUpperCase()
    const status = VALID_STATUSES.has(statusRaw) ? statusRaw : "OPEN"

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from("market_rounds")
      .select(
        "round_id, market_type, start_ts, lock_ts, settle_ts, status, collateral_mint, escrow_wallet_pubkey, rake_bps, inputs_hash, snapshot_hash, created_at, updated_at",
      )
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, status, rounds: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
