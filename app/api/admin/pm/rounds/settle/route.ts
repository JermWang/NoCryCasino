import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { checkIngestionFreshness, createLeaderboardSnapshot, getLeaderboardSnapshot, saveLeaderboardSnapshot, type WindowKey } from "@/lib/analytics/snapshot"

export const runtime = "nodejs"

type Body = {
  round_id?: string
  settle_before?: string
  limit?: number
  top_n?: number
  use_snapshot?: boolean
  apply_anti_manipulation?: boolean
  dry_run?: boolean
}

function windowKeyForMarketType(market_type: string): WindowKey {
  const mt = String(market_type).toUpperCase()
  if (mt === "WEEKLY") return "weekly"
  if (mt === "MONTHLY") return "monthly"
  return "daily"
}

type MarketKind = "TOP_1" | "TOP_N" | "PROFITABLE" | "HEAD_TO_HEAD"

function normalizeMarketKind(raw: unknown): MarketKind {
  const k = String(raw ?? "TOP_N").toUpperCase()
  if (k === "TOP_1" || k === "PROFITABLE" || k === "HEAD_TO_HEAD") return k
  return "TOP_N"
}

/**
 * Compute the winning wallet set for a round from its eligible leaderboard
 * ranking, branching on the round's market_kind. `eligible` is already sorted
 * by realized SOL PnL desc (eligible-first) by the snapshot builder, so kinds
 * that need a top slice can take from the front directly.
 *
 * The realized-SOL-PnL field on each RankedKol is `profit_sol` (see
 * lib/analytics/snapshot.ts → RankedKol). All kinds rank on that field.
 *
 * Returns null for kinds we deliberately do NOT settle here (HEAD_TO_HEAD),
 * so the caller can record a skip without touching the RPC.
 */
function computeWinnersByKind(args: {
  kind: MarketKind
  kind_params: Record<string, any>
  eligible: { wallet_address: string; profit_sol: number }[]
  default_top_n: number
}): { winners: string[] } | { skip: string } {
  const { kind, kind_params, eligible, default_top_n } = args

  if (kind === "TOP_1") {
    return { winners: eligible.slice(0, 1).map((x) => x.wallet_address) }
  }

  if (kind === "PROFITABLE") {
    return { winners: eligible.filter((x) => x.profit_sol > 0).map((x) => x.wallet_address) }
  }

  if (kind === "HEAD_TO_HEAD") {
    // TODO(HEAD_TO_HEAD): settle from kind_params {a,b} — winner is whichever of
    // the two wallets has the higher realized SOL PnL in `eligible`. Left as a
    // noted skip for now so the other kinds settle without being blocked.
    return { skip: "HEAD_TO_HEAD settlement not implemented yet" }
  }

  // TOP_N (default): N from kind_params.n, else the request-level top_n default.
  const nRaw = Number(kind_params?.n)
  const n = Number.isFinite(nRaw) && nRaw > 0 ? Math.floor(nRaw) : default_top_n
  return { winners: eligible.slice(0, n).map((x) => x.wallet_address) }
}

let solPriceCache: { value: number; ts: number } | null = null

async function getSolPriceUsd(): Promise<number> {
  const now = Date.now()
  if (solPriceCache && now - solPriceCache.ts < 60_000) return solPriceCache.value

  const timeoutMs = 7_000

  const fetchJson = async (url: string) => {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "nocrycasino/1.0",
        },
        signal: controller.signal,
      })
      return { res, json: (await res.json().catch(() => null)) as any }
    } finally {
      clearTimeout(t)
    }
  }

  try {
    {
      const { res, json } = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
      const v = Number(json?.solana?.usd)
      const price = Number.isFinite(v) && v > 0 ? v : 0
      if (res.ok && price > 0) {
        solPriceCache = { value: price, ts: now }
        return price
      }
    }

    {
      const { res, json } = await fetchJson("https://price.jup.ag/v4/price?ids=SOL")
      const v = Number(json?.data?.SOL?.price)
      const price = Number.isFinite(v) && v > 0 ? v : 0
      if (res.ok && price > 0) {
        solPriceCache = { value: price, ts: now }
        return price
      }
    }

    return solPriceCache?.value ?? 124
  } catch {
    return solPriceCache?.value ?? 124
  }
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:pm:rounds:settle", limit: 30, windowMs: 60_000 })
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
    const settle_before =
      typeof body?.settle_before === "string" && body.settle_before.length > 0
        ? body.settle_before
        : new Date().toISOString()

    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.min(100, Math.floor(body.limit)) : 25
    const top_n = typeof body?.top_n === "number" && Number.isFinite(body.top_n) && body.top_n > 0 ? Math.min(25, Math.floor(body.top_n)) : 3

    const use_snapshot = body?.use_snapshot !== false
    const apply_anti_manipulation = body?.apply_anti_manipulation !== false

    const solPriceUsd = await getSolPriceUsd()

    const supabase = createServiceClient()

    let q = supabase
      .from("market_rounds")
      .select("round_id, market_type, lock_ts, settle_ts, status, market_kind, kind_params")
      .in("status", ["LOCKED", "SETTLING"])
      .lte("settle_ts", settle_before)
      .order("settle_ts", { ascending: true })
      .limit(limit)

    if (typeof body?.round_id === "string" && body.round_id.length > 0) {
      q = q.eq("round_id", body.round_id)
    }

    const { data: rounds, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = Array.isArray(rounds) ? rounds : []
    const results: any[] = []

    for (const r of rows) {
      const roundStatus = String((r as any)?.status ?? "")

      if (!dry_run && roundStatus === "LOCKED") {
        // Claim the round for settlement to reduce races (only one worker should do heavy work).
        const { data: claimed, error: claimErr } = await supabase
          .from("market_rounds")
          .update({ status: "SETTLING" })
          .eq("round_id", r.round_id)
          .eq("status", "LOCKED")
          .select("round_id")
          .maybeSingle()

        if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 })

        if (!claimed) {
          // Someone else already claimed/settled it.
          results.push({ round_id: r.round_id, skipped: true, reason: "Already settling/settled" })
          continue
        }
      }

      if (!dry_run && roundStatus !== "LOCKED" && roundStatus !== "SETTLING") {
        results.push({ round_id: r.round_id, skipped: true, reason: `Unexpected status: ${roundStatus}` })
        continue
      }

      const window_key = windowKeyForMarketType(r.market_type)
      const closes_at = new Date(String(r.lock_ts)).toISOString()

      // Freshness gate (real-money safety): never settle on a stale/incomplete Helius feed.
      // If ingestion is lagging or the window is under-covered, defer settlement to a later
      // tick (revert our SETTLING claim back to LOCKED) instead of paying the wrong side.
      // A round left LOCKED is a safe, recoverable state; pm_settle is idempotent/irreversible
      // so a wrong settlement cannot be undone. Skipped for dry_run previews.
      if (!dry_run) {
        const freshness = await checkIngestionFreshness({
          window_key,
          closes_at,
          max_staleness_minutes: 120,
          min_event_count: 10,
        })
        if (!freshness.ok) {
          if (roundStatus === "LOCKED") {
            await supabase
              .from("market_rounds")
              .update({ status: "LOCKED" })
              .eq("round_id", r.round_id)
              .eq("status", "SETTLING")
          }
          results.push({
            round_id: r.round_id,
            window_key,
            closes_at,
            skipped: true,
            reason: "ingestion not fresh — settlement deferred",
            freshness: {
              reasons: freshness.reasons,
              latest_block_time: freshness.latest_block_time,
              staleness_minutes: freshness.staleness_minutes,
              event_count: freshness.event_count,
            },
          })
          continue
        }
      }

      let snapshot = use_snapshot ? await getLeaderboardSnapshot({ window_key, closes_at }) : null
      if (!snapshot) {
        snapshot = await createLeaderboardSnapshot({ window_key, closes_at, sol_price_usd: solPriceUsd, apply_anti_manipulation })
        if (!dry_run && use_snapshot) {
          await saveLeaderboardSnapshot(snapshot)
        }
      }

      const eligible = snapshot.rankings.filter((x) => x.is_eligible)

      const market_kind = normalizeMarketKind((r as any)?.market_kind)
      const kind_params =
        (r as any)?.kind_params && typeof (r as any).kind_params === "object" ? ((r as any).kind_params as Record<string, any>) : {}

      const winnerResult = computeWinnersByKind({ kind: market_kind, kind_params, eligible, default_top_n: top_n })

      if ("skip" in winnerResult) {
        // Kind we don't settle here (HEAD_TO_HEAD). Record and move on without
        // calling the RPC. The round keeps its current status (e.g. SETTLING if
        // it was claimed) so a future handler can pick it up.
        results.push({ round_id: r.round_id, window_key, closes_at, market_kind, skipped: true, reason: winnerResult.skip })
        continue
      }

      const winners = winnerResult.winners

      if (!dry_run) {
        // Atomic parimutuel settlement: resolves every outcome YES iff its KOL is
        // in `winners`, pays each outcome's winning side from BOTH pools (honoring
        // per-bet $NOCRY fee waivers), records rake, and flips the round SETTLED.
        // Solvency is guaranteed by the RPC (never pays more than was collected).
        const { data: settleData, error: settleErr } = await supabase.rpc("pm_settle_round_parimutuel", {
          p_round_id: r.round_id,
          p_winner_wallets: winners,
          p_snapshot_hash: snapshot.snapshot_hash,
        })

        if (settleErr) {
          results.push({ round_id: r.round_id, window_key, closes_at, market_kind, snapshot_hash: snapshot.snapshot_hash, winners, error: settleErr.message })
          continue
        }

        results.push({ round_id: r.round_id, window_key, closes_at, market_kind, snapshot_hash: snapshot.snapshot_hash, winners, settlement: settleData })
      } else {
        results.push({ round_id: r.round_id, window_key, closes_at, market_kind, snapshot_hash: snapshot.snapshot_hash, winners, dry_run: true })
      }
    }

    return NextResponse.json({ ok: true, dry_run, settled: results.length, results, top_n })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
