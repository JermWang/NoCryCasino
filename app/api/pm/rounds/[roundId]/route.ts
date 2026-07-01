import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { normalizeKolDisplayName } from "@/lib/utils"

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

    // Enrich each outcome with KOL identity (name / avatar / socials). pm_round_outcomes
    // returns only kol_wallet_address, so without this every market renders as a truncated
    // wallet. The UI reads outcome.kols.{display_name,avatar_url,twitter_handle,twitter_url}.
    const list = Array.isArray(outcomes) ? (outcomes as any[]) : []
    const wallets = Array.from(
      new Set(list.map((o) => String(o?.kol_wallet_address ?? "")).filter((w) => w.length > 0)),
    )

    const kolByWallet = new Map<string, any>()
    if (wallets.length > 0) {
      const { data: kolRows } = await supabase
        .from("kols")
        .select("wallet_address, display_name, avatar_url, twitter_handle, twitter_url")
        .in("wallet_address", wallets)
      for (const k of (kolRows ?? []) as any[]) {
        kolByWallet.set(String(k.wallet_address), k)
      }
    }

    const enriched = list.map((o) => {
      const k = kolByWallet.get(String(o?.kol_wallet_address ?? ""))
      const kols = k
        ? {
            display_name: normalizeKolDisplayName(k.display_name),
            avatar_url: k.avatar_url ?? null,
            twitter_handle: k.twitter_handle ?? null,
            twitter_url: k.twitter_url ?? null,
          }
        : (o?.kols ?? null)
      return { ...o, kols }
    })

    return NextResponse.json({ ok: true, round, outcomes: enriched })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
