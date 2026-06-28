/**
 * Admin endpoint: preview the AUTHORITATIVE settlement snapshot for a window.
 *
 * Settlement fairness requires the ranking users can preview to match the
 * ranking that settles. The lock-time snapshot (keyed by window_key + closes_at)
 * is authoritative. This route exposes it:
 *   - if a snapshot has already been saved (at/after lock), it is returned as-is
 *     (this is exactly what the settle path will use), and
 *   - otherwise a snapshot is computed with the same builder used by settle
 *     (createLeaderboardSnapshot) and returned WITHOUT persisting it.
 *
 * It also returns an ingestion-freshness report so callers can see whether the
 * underlying tx_events coverage looks complete before trusting/settling.
 */

import { NextResponse, type NextRequest } from "next/server"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import {
  createLeaderboardSnapshot,
  getLeaderboardSnapshot,
  checkIngestionFreshness,
  type WindowKey,
} from "@/lib/analytics/snapshot"

export const runtime = "nodejs"

type Body = {
  window_key?: WindowKey
  closes_at?: string
  apply_anti_manipulation?: boolean
  top_n?: number
  max_staleness_minutes?: number
  min_event_count?: number
}

function normalizeWindowKey(v: unknown): WindowKey | null {
  const s = String(v ?? "").toLowerCase()
  return s === "daily" || s === "weekly" || s === "monthly" ? s : null
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:markets:preview", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  // Read-only preview, but gate it behind the same admin key as settle so the
  // exact authoritative ranking isn't exposed to unauthenticated callers.
  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const window_key = normalizeWindowKey(body?.window_key)
    if (!window_key) return NextResponse.json({ error: "Invalid or missing window_key" }, { status: 400 })

    const closes_at =
      typeof body?.closes_at === "string" && body.closes_at.length > 0 ? body.closes_at : new Date().toISOString()
    const closesAtIso = new Date(closes_at).toISOString()

    const apply_anti_manipulation = body?.apply_anti_manipulation !== false
    const top_n =
      typeof body?.top_n === "number" && Number.isFinite(body.top_n) && body.top_n > 0
        ? Math.min(25, Math.floor(body.top_n))
        : 3

    const freshness = await checkIngestionFreshness({
      window_key,
      closes_at: closesAtIso,
      max_staleness_minutes: body?.max_staleness_minutes,
      min_event_count: body?.min_event_count,
    })

    const saved = await getLeaderboardSnapshot({ window_key, closes_at: closesAtIso })
    const snapshot = saved ?? (await createLeaderboardSnapshot({ window_key, closes_at: closesAtIso, apply_anti_manipulation }))

    const eligible = snapshot.rankings.filter((r) => r.is_eligible)
    const winners = eligible.slice(0, top_n).map((r) => r.wallet_address)

    return NextResponse.json({
      ok: true,
      window_key,
      closes_at: closesAtIso,
      // `saved` means this is the frozen, authoritative snapshot the settle path
      // will reuse; otherwise it's a live preview of what would be frozen.
      source: saved ? "saved_snapshot" : "computed_preview",
      snapshot_hash: snapshot.snapshot_hash,
      snapshot_at: snapshot.snapshot_at,
      sol_price_usd: snapshot.sol_price_usd,
      top_n,
      winners,
      freshness,
      rankings: snapshot.rankings,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
