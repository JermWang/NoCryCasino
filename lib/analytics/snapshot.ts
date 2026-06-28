/**
 * Leaderboard Snapshot System
 * Addresses audit item 8.2: Snapshot locking at closes_at
 *
 * This module is the SINGLE SOURCE OF TRUTH for:
 *  - the settlement window (cutoff..closes_at) for a given window_key
 *  - KOL eligibility rules used at settlement
 *  - the SOL/USD price pinned at lock time and reused at settle
 *
 * The leaderboard preview UI and the settle path MUST agree on rankings.
 * To guarantee that, the lock-time snapshot (keyed by window_key + closes_at,
 * where closes_at === round.lock_ts) is authoritative: it freezes the window,
 * the eligibility decision, and the SOL price. Settlement prefers the saved
 * snapshot; the UI can preview the exact same object via getLeaderboardSnapshot.
 */

import { createServiceClient } from "@/lib/supabase/service"
import { createHash } from "crypto"
import { analyzeWalletPnL, aggregateWalletPnL, type WalletPnL } from "./token-pnl"
import { computeRealizedTradePnL, extractTradeLeg, isTradeLike, type TradeLeg } from "./kolscan-pnl"

export type WindowKey = "daily" | "weekly" | "monthly"

export type RankedKol = {
  wallet_address: string
  rank: number
  profit_sol: number
  profit_usd: number
  wins: number
  losses: number
  tx_count: number
  swap_volume_sol: number
  unique_counterparties: number
  is_eligible: boolean
  disqualification_reasons: string[]
}

export type LeaderboardSnapshot = {
  window_key: WindowKey
  closes_at: string
  snapshot_at: string
  snapshot_hash: string
  /** SOL/USD price pinned at snapshot creation (lock time) and reused at settle. */
  sol_price_usd: number
  rankings: RankedKol[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Resolve the settlement window for a given window_key and close time.
 * This is THE single source of truth for the window. Both the snapshot
 * builder and any leaderboard preview must derive the window from here so
 * the ranking users see matches the ranking that settles.
 */
export function resolveWindow(window_key: WindowKey, closesAtIso: string): {
  cutoff_iso: string
  closes_at_iso: string
  window_ms: number
} {
  const endMs = Date.parse(closesAtIso)
  const window_ms = window_key === "daily" ? DAY_MS : window_key === "weekly" ? 7 * DAY_MS : 30 * DAY_MS
  return {
    cutoff_iso: new Date(endMs - window_ms).toISOString(),
    closes_at_iso: new Date(endMs).toISOString(),
    window_ms,
  }
}

// ---------------------------------------------------------------------------
// SOL price (pinned into the snapshot at lock; reused at settle)
// ---------------------------------------------------------------------------

let solPriceCache: { value: number; ts: number } | null = null

/**
 * Fetch SOL/USD from public oracles. Used ONLY at snapshot creation (lock time)
 * to pin a price into the snapshot. Settlement must NOT call this live; it reads
 * the pinned snapshot.sol_price_usd instead. Returns 0 if no source is available
 * (callers decide how to treat a missing price; we never silently default to a
 * hardcoded guess that could mis-price a real-money settlement).
 */
export async function getSolPriceUsd(): Promise<number> {
  const now = Date.now()
  if (solPriceCache && now - solPriceCache.ts < 60_000) return solPriceCache.value

  const timeoutMs = 7_000
  const fetchJson = async (url: string) => {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "trade-wars/1.0" },
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
    // Last known good price if we have one; otherwise 0 (no hardcoded guess).
    return solPriceCache?.value ?? 0
  } catch {
    return solPriceCache?.value ?? 0
  }
}

// ---------------------------------------------------------------------------
// Eligibility (single source of truth, shared by snapshot + preview)
// ---------------------------------------------------------------------------

export type EligibilityInput = {
  tx_count: number
  self_transfer_count: number
  unique_counterparties: number
}

export type EligibilityResult = {
  is_eligible: boolean
  disqualification_reasons: string[]
}

/**
 * Evaluate KOL eligibility for settlement from observable, ingested signals.
 *
 * NOTE: the historical wallet-age gate was removed. `kols.wallet_created_at`
 * was never populated by ingestion, so the age check silently no-op'd for every
 * wallet and produced no disqualifications. Keeping an inert gate is worse than
 * removing it: it implies a guarantee we don't enforce. Eligibility now relies
 * only on signals we actually compute from tx_events (self-transfer ratio and
 * counterparty diversity), so the preview and the settlement agree exactly.
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const disqualification_reasons: string[] = []
  const { tx_count, self_transfer_count, unique_counterparties } = input

  // Self-transfer (wash) ratio
  if (tx_count > 0 && self_transfer_count / tx_count > 0.1) {
    disqualification_reasons.push(
      `High self-transfer ratio (${((self_transfer_count / tx_count) * 100).toFixed(1)}%)`,
    )
  }

  // Counterparty diversity (only enforced once there is enough activity to judge)
  if (unique_counterparties < 3 && tx_count >= 5) {
    disqualification_reasons.push(`Low counterparty diversity (${unique_counterparties} unique)`)
  }

  return { is_eligible: disqualification_reasons.length === 0, disqualification_reasons }
}

// ---------------------------------------------------------------------------
// Ingestion freshness guard (Task 3)
// ---------------------------------------------------------------------------

export type IngestionFreshnessReport = {
  ok: boolean
  reasons: string[]
  window_key: WindowKey
  cutoff_iso: string
  closes_at_iso: string
  /** Most recent tx_events.block_time strictly before closes_at, if any. */
  latest_block_time: string | null
  /** Staleness of the latest event relative to closes_at, in minutes. */
  staleness_minutes: number | null
  /** Number of tx_events rows observed in the window (capped for cost). */
  event_count: number
}

/**
 * Report whether tx_events coverage for a settlement window looks complete and
 * fresh. Settlement can call this to refuse/flag stale data BEFORE pricing a
 * round. We do NOT mutate anything here and we do NOT edit the settle route;
 * this is a pure, exported helper the settle path can invoke.
 *
 * Heuristics (overridable):
 *  - the most-recent event before closes_at must be within `max_staleness_minutes`
 *    of closes_at (i.e. the indexer kept up to the window boundary), and
 *  - the window must contain at least `min_event_count` events.
 */
export async function checkIngestionFreshness(args: {
  window_key: WindowKey
  closes_at: string
  max_staleness_minutes?: number
  min_event_count?: number
}): Promise<IngestionFreshnessReport> {
  const { window_key, closes_at } = args
  const max_staleness_minutes = Number.isFinite(args.max_staleness_minutes as number)
    ? (args.max_staleness_minutes as number)
    : 30
  const min_event_count = Number.isFinite(args.min_event_count as number) ? (args.min_event_count as number) : 1

  const { cutoff_iso, closes_at_iso } = resolveWindow(window_key, closes_at)
  const supabase = createServiceClient()

  const reasons: string[] = []

  // Most-recent event strictly before the close boundary.
  const { data: latestRows, error: latestErr } = await supabase
    .from("tx_events")
    .select("block_time")
    .gte("block_time", cutoff_iso)
    .lt("block_time", closes_at_iso)
    .order("block_time", { ascending: false })
    .limit(1)

  if (latestErr) {
    return {
      ok: false,
      reasons: [`freshness query failed: ${latestErr.message}`],
      window_key,
      cutoff_iso,
      closes_at_iso,
      latest_block_time: null,
      staleness_minutes: null,
      event_count: 0,
    }
  }

  const latest_block_time = (latestRows?.[0]?.block_time as string | undefined) ?? null

  // Count events in the window (head-capped so this stays cheap on large tables).
  const { count, error: countErr } = await supabase
    .from("tx_events")
    .select("signature", { count: "exact", head: true })
    .gte("block_time", cutoff_iso)
    .lt("block_time", closes_at_iso)

  if (countErr) {
    reasons.push(`event count query failed: ${countErr.message}`)
  }

  const event_count = typeof count === "number" ? count : 0

  let staleness_minutes: number | null = null
  if (!latest_block_time) {
    reasons.push("no tx_events found in window")
  } else {
    staleness_minutes = (Date.parse(closes_at_iso) - Date.parse(latest_block_time)) / 60_000
    if (Number.isFinite(staleness_minutes) && staleness_minutes > max_staleness_minutes) {
      reasons.push(
        `latest event is ${staleness_minutes.toFixed(1)}m before close (max ${max_staleness_minutes}m) — ingestion may be lagging`,
      )
    }
  }

  if (event_count < min_event_count) {
    reasons.push(`only ${event_count} events in window (min ${min_event_count})`)
  }

  return {
    ok: reasons.length === 0,
    reasons,
    window_key,
    cutoff_iso,
    closes_at_iso,
    latest_block_time,
    staleness_minutes,
    event_count,
  }
}

function computeSnapshotHash(rankings: RankedKol[]): string {
  const data = JSON.stringify(
    rankings.map((r) => ({
      w: r.wallet_address,
      r: r.rank,
      p: r.profit_sol,
    }))
  )
  return createHash("sha256").update(data).digest("hex").slice(0, 32)
}

/**
 * Create a frozen leaderboard snapshot for a window.
 *
 * The SOL price is PINNED into the snapshot here (lock time): if a valid
 * sol_price_usd is supplied we use it, otherwise we fetch once and store the
 * result. Settlement must read this pinned value back from the snapshot rather
 * than re-fetching a live price.
 */
export async function createLeaderboardSnapshot(args: {
  window_key: WindowKey
  closes_at: string
  /** Optional. If omitted/invalid, the price is fetched once and pinned. */
  sol_price_usd?: number
  apply_anti_manipulation?: boolean
}): Promise<LeaderboardSnapshot> {
  const { window_key, closes_at, apply_anti_manipulation = true } = args

  // Pin the price into the snapshot. Prefer the caller-supplied price (captured
  // at lock), otherwise fetch once. This value is what settle will reuse.
  const suppliedPrice = Number(args.sol_price_usd)
  const sol_price_usd =
    Number.isFinite(suppliedPrice) && suppliedPrice > 0 ? suppliedPrice : await getSolPriceUsd()

  const supabase = createServiceClient()

  // Get tracked KOLs with versioning check
  const { data: kols, error: kolsError } = await supabase
    .from("kols")
    .select("wallet_address, tracked_from, tracked_until")
    .eq("is_active", true)
    .eq("is_tracked", true)
    .or(`tracked_until.is.null,tracked_until.gt.${closes_at}`)
    .lte("tracked_from", closes_at)
    .order("tracked_rank", { ascending: true, nullsFirst: false })
    .limit(500)

  if (kolsError) throw new Error(kolsError.message)

  const trackedWallets = (kols ?? []).map((k: any) => k.wallet_address)
  const trackedSet = new Set(trackedWallets)

  const { cutoff_iso: cutoffIso, closes_at_iso: closesAtIso } = resolveWindow(window_key, closes_at)

  // Fetch events for the window
  const { data: events, error: eventsError } = await supabase
    .from("tx_events")
    .select("signature, block_time, raw, tx_event_wallets(wallet_address)")
    .gte("block_time", cutoffIso)
    .lt("block_time", closesAtIso)
    .order("block_time", { ascending: false })
    .limit(50000)

  if (eventsError) throw new Error(eventsError.message)

  // Aggregate PnL per wallet
  const walletPnLs = new Map<string, WalletPnL[]>()
  const walletLegs = new Map<string, TradeLeg[]>()
  const seenSigs = new Map<string, Set<string>>()

  for (const evt of (events ?? []) as any[]) {
    const raw = evt?.raw
    const links = Array.isArray(evt?.tx_event_wallets) ? evt.tx_event_wallets : []
    const sig = String(evt?.signature ?? "")
    const blockTimeMs = evt?.block_time ? new Date(String(evt.block_time)).getTime() : Date.now()

    for (const l of links) {
      const wallet = l?.wallet_address
      if (typeof wallet !== "string" || !trackedSet.has(wallet)) continue

      // Dedupe by signature per wallet
      let seen = seenSigs.get(wallet)
      if (!seen) {
        seen = new Set()
        seenSigs.set(wallet, seen)
      }
      if (seen.has(sig)) continue
      seen.add(sig)

      const pnl = analyzeWalletPnL(raw, wallet)
      const arr = walletPnLs.get(wallet) ?? []
      arr.push(pnl)
      walletPnLs.set(wallet, arr)

      if (isTradeLike(raw, wallet)) {
        const leg = extractTradeLeg(raw, wallet, blockTimeMs, sol_price_usd)
        if (leg) {
          const legs = walletLegs.get(wallet) ?? []
          legs.push(leg)
          walletLegs.set(wallet, legs)
        }
      }
    }
  }

  // Build rankings
  const rankings: RankedKol[] = []

  for (const wallet of trackedWallets) {
    const pnls = walletPnLs.get(wallet) ?? []
    const agg = aggregateWalletPnL(pnls)

    const legs = walletLegs.get(wallet) ?? []
    const realized = computeRealizedTradePnL(legs)

    const profit_sol = realized.realized_lamports / 1e9

    // Eligibility via the shared single-source-of-truth evaluator.
    const selfTransferCount = pnls.filter((p) => p.is_self_transfer).length
    const { is_eligible, disqualification_reasons } = apply_anti_manipulation
      ? evaluateEligibility({
          tx_count: agg.tx_count,
          self_transfer_count: selfTransferCount,
          unique_counterparties: agg.counterparties.size,
        })
      : { is_eligible: true, disqualification_reasons: [] as string[] }

    rankings.push({
      wallet_address: wallet,
      rank: 0, // Will be assigned after sorting
      profit_sol,
      profit_usd: profit_sol * sol_price_usd,
      wins: realized.wins,
      losses: realized.losses,
      tx_count: realized.tx_count,
      swap_volume_sol: realized.volume_lamports / 1e9,
      unique_counterparties: agg.counterparties.size,
      is_eligible,
      disqualification_reasons,
    })
  }

  // Sort by profit (eligible first, then by profit)
  rankings.sort((a, b) => {
    // Eligible wallets rank higher
    if (a.is_eligible !== b.is_eligible) return a.is_eligible ? -1 : 1
    // Then by profit
    if (b.profit_sol !== a.profit_sol) return b.profit_sol - a.profit_sol
    // Then by wins
    if (b.wins !== a.wins) return b.wins - a.wins
    // Deterministic tiebreaker
    return a.wallet_address.localeCompare(b.wallet_address)
  })

  // Assign ranks
  rankings.forEach((r, idx) => {
    r.rank = idx + 1
  })

  const snapshot_at = new Date().toISOString()
  const snapshot_hash = computeSnapshotHash(rankings)

  return {
    window_key,
    closes_at,
    snapshot_at,
    snapshot_hash,
    sol_price_usd,
    rankings,
  }
}

/**
 * Save a leaderboard snapshot to the database
 */
export async function saveLeaderboardSnapshot(snapshot: LeaderboardSnapshot): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase.from("leaderboard_snapshots").upsert(
    {
      window_key: snapshot.window_key,
      closes_at: snapshot.closes_at,
      snapshot_at: snapshot.snapshot_at,
      snapshot_hash: snapshot.snapshot_hash,
      sol_price_usd: snapshot.sol_price_usd,
      rankings: snapshot.rankings,
    },
    { onConflict: "window_key,closes_at" }
  )

  if (error) throw new Error(error.message)
}

/**
 * Get an existing leaderboard snapshot
 */
export async function getLeaderboardSnapshot(args: {
  window_key: WindowKey
  closes_at: string
}): Promise<LeaderboardSnapshot | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from("leaderboard_snapshots")
    .select("window_key, closes_at, snapshot_at, snapshot_hash, sol_price_usd, rankings")
    .eq("window_key", args.window_key)
    .eq("closes_at", args.closes_at)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  const pinned = Number((data as any).sol_price_usd)

  return {
    window_key: data.window_key as WindowKey,
    closes_at: data.closes_at,
    snapshot_at: data.snapshot_at,
    snapshot_hash: data.snapshot_hash,
    sol_price_usd: Number.isFinite(pinned) ? pinned : 0,
    rankings: data.rankings as RankedKol[],
  }
}

/**
 * Verify a snapshot hash matches the stored rankings
 */
export function verifySnapshotHash(snapshot: LeaderboardSnapshot): boolean {
  const computed = computeSnapshotHash(snapshot.rankings)
  return computed === snapshot.snapshot_hash
}
