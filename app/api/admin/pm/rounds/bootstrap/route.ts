import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { createHash } from "crypto"

export const runtime = "nodejs"

type MarketType = "DAILY" | "WEEKLY" | "MONTHLY"

type MarketKind = "TOP_1" | "TOP_N" | "PROFITABLE" | "HEAD_TO_HEAD"

type Body = {
  market_type?: MarketType | "ALL"
  lock_ts?: string
  settle_delay_minutes?: number
  rake_bps?: number
  collateral_mint?: string
  limit_kols?: number
  top_n?: number
  kol_selection?: "tracked_rank" | "active"
  min_recent_txs?: number
  market_kind?: MarketKind
  kind_params?: Record<string, any>
}

function normalizeMarketKind(raw: unknown): MarketKind {
  const k = String(raw ?? "TOP_N").toUpperCase()
  if (k === "TOP_1" || k === "PROFITABLE" || k === "HEAD_TO_HEAD") return k
  return "TOP_N"
}

/** Human timeframe word for the round window, used in outcome question text. */
function timeframeWord(market_type: MarketType): "daily" | "weekly" | "monthly" {
  if (market_type === "WEEKLY") return "weekly"
  if (market_type === "MONTHLY") return "monthly"
  return "daily"
}

/**
 * Build the per-outcome question text for a KOL, matching the round's kind.
 *  - TOP_1:        "Will <KOL> be the #1 most profitable KOL this <timeframe>?"
 *  - TOP_N:        "Will <KOL> finish Top <N> by SOL profit this <timeframe>?"
 *  - PROFITABLE:   "Will <KOL> end this <timeframe> in profit?"
 *  - HEAD_TO_HEAD: framed as <KOL> outperforming the configured opponent.
 */
function questionTextForKind(args: {
  kind: MarketKind
  name: string
  top_n: number
  timeframe: "daily" | "weekly" | "monthly"
}): string {
  const { kind, name, top_n, timeframe } = args
  if (kind === "TOP_1") return `Will ${name} be the #1 most profitable KOL this ${timeframe}?`
  if (kind === "PROFITABLE") return `Will ${name} end this ${timeframe} in profit?`
  if (kind === "HEAD_TO_HEAD") return `Will ${name} be the more profitable KOL in this ${timeframe} head-to-head?`
  return `Will ${name} finish Top ${top_n} by SOL profit this ${timeframe}?`
}

function nextDailyLockUtc(): string {
  const d = new Date()
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0))
  return next.toISOString()
}

function nextWeeklyLockUtc(): string {
  const d = new Date()
  const day = d.getUTCDay()
  const daysUntilMon = (8 - day) % 7 || 7
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilMon, 0, 0, 0, 0))
  return next.toISOString()
}

function nextMonthlyLockUtc(): string {
  const d = new Date()
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0))
  return next.toISOString()
}

function pickLockTs(market_type: MarketType): string {
  if (market_type === "WEEKLY") return nextWeeklyLockUtc()
  if (market_type === "MONTHLY") return nextMonthlyLockUtc()
  return nextDailyLockUtc()
}

function getDeltaMs(market_type: MarketType): number {
  const day = 24 * 60 * 60 * 1000
  if (market_type === "WEEKLY") return 7 * day
  if (market_type === "MONTHLY") return 30 * day
  return day
}

function getEscrowAddressesFromEnv(): string[] {
  const raw = process.env.ESCROW_WALLET_ADDRESSES
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  const a1 = process.env.ESCROW_WALLET_1_ADDRESS
  const a2 = process.env.ESCROW_WALLET_2_ADDRESS
  const a3 = process.env.ESCROW_WALLET_3_ADDRESS
  return [a1, a2, a3].filter((v): v is string => typeof v === "string" && v.length > 0)
}

function pickEscrowAddress(seed: string, addresses: string[]): string | null {
  if (!addresses || addresses.length === 0) return null
  let sum = 0
  for (let i = 0; i < seed.length; i++) sum = (sum + seed.charCodeAt(i)) >>> 0
  return addresses[sum % addresses.length] ?? addresses[0]!
}

async function selectActiveKols(args: {
  supabase: ReturnType<typeof createServiceClient>
  lockTs: string
  startTs: string
  limit: number
  minRecentTxs: number
}): Promise<{ kols: Array<{ wallet_address: string; display_name: string | null }>; selection_fallback: "active_only" | "active_then_tracked" }> {
  const { data: tracked, error: trackedErr } = await args.supabase
    .from("kols")
    .select("wallet_address, display_name")
    .eq("is_active", true)
    .eq("is_tracked", true)
    .order("tracked_rank", { ascending: true, nullsFirst: false })
    .limit(2000)

  if (trackedErr) throw trackedErr

  const trackedRows = Array.isArray(tracked) ? tracked : []
  const trackedSet = new Set(trackedRows.map((k: any) => String(k.wallet_address)))
  const displayByWallet = new Map(trackedRows.map((k: any) => [String(k.wallet_address), (k.display_name ?? null) as string | null]))

  // Scan recent wallet-event links in the round window, newest first.
  // We pick wallets that appear frequently (minRecentTxs) to bias toward active traders.
  const counts = new Map<string, number>()
  const picked: string[] = []
  let qualifiedCount = 0

  const scanLimit = 5000
  const { data: links, error: linkErr } = await args.supabase
    .from("tx_event_wallets")
    .select("wallet_address, tx_events!inner(block_time)")
    .gte("tx_events.block_time", args.startTs)
    .lt("tx_events.block_time", args.lockTs)
    .order("block_time", { foreignTable: "tx_events", ascending: false })
    .limit(scanLimit)

  if (linkErr) throw linkErr

  for (const r of (links ?? []) as any[]) {
    const wallet = String(r?.wallet_address ?? "")
    if (!wallet) continue
    if (!trackedSet.has(wallet)) continue

    const c = (counts.get(wallet) ?? 0) + 1
    counts.set(wallet, c)

    if (c >= args.minRecentTxs && !picked.includes(wallet)) {
      picked.push(wallet)
      qualifiedCount += 1
      if (picked.length >= args.limit) break
    }
  }

  // Fallback: if not enough wallets hit the minRecentTxs threshold, relax to any activity.
  if (picked.length < args.limit) {
    for (const [wallet] of Array.from(counts.entries()).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) {
      if (picked.includes(wallet)) continue
      picked.push(wallet)
      if (picked.length >= args.limit) break
    }
  }

  // Last resort: fall back to tracked order
  if (picked.length < args.limit) {
    for (const k of trackedRows) {
      const wallet = String((k as any)?.wallet_address ?? "")
      if (!wallet) continue
      if (picked.includes(wallet)) continue
      picked.push(wallet)
      if (picked.length >= args.limit) break
    }
  }

  const selection_fallback: "active_only" | "active_then_tracked" =
    qualifiedCount >= args.limit ? "active_only" : "active_then_tracked"

  if (selection_fallback !== "active_only") {
    console.warn(
      `[pm bootstrap] KOL selection fallback: only ${qualifiedCount}/${args.limit} wallets met min_recent_txs=${args.minRecentTxs}.`,
    )
  }

  return {
    kols: picked.slice(0, args.limit).map((wallet_address) => ({
      wallet_address,
      display_name: displayByWallet.get(wallet_address) ?? null,
    })),
    selection_fallback,
  }
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:pm:rounds:bootstrap", limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const mtRaw = String(body?.market_type ?? "ALL").toUpperCase()
    const marketTypes: MarketType[] = mtRaw === "DAILY" || mtRaw === "WEEKLY" || mtRaw === "MONTHLY" ? [mtRaw] : ["DAILY", "WEEKLY", "MONTHLY"]

    const settleDelayMin = typeof body?.settle_delay_minutes === "number" && Number.isFinite(body.settle_delay_minutes) && body.settle_delay_minutes >= 1
      ? Math.floor(body.settle_delay_minutes)
      : 15

    const rakeDefault = Number(process.env.HOUSE_FEE_BPS ?? 250)
    const rakeRaw =
      typeof body?.rake_bps === "number" && Number.isFinite(body.rake_bps)
        ? body.rake_bps
        : Number.isFinite(rakeDefault)
          ? rakeDefault
          : 250
    const rake_bps = Math.max(0, Math.min(1000, Math.floor(rakeRaw)))

    // Per-mint collateral: 'SOL' (default) or a USDC mint string. Persisted on the round.
    const collateral_mint = typeof body?.collateral_mint === "string" && body.collateral_mint.trim().length > 0 ? body.collateral_mint.trim() : "SOL"

    const limit_kols = typeof body?.limit_kols === "number" && Number.isFinite(body.limit_kols) && body.limit_kols > 0 ? Math.min(2000, Math.floor(body.limit_kols)) : 200

    const top_n = typeof body?.top_n === "number" && Number.isFinite(body.top_n) && body.top_n > 0 ? Math.min(25, Math.floor(body.top_n)) : 3

    const market_kind = normalizeMarketKind(body?.market_kind)

    // HEAD_TO_HEAD settlement is not implemented (the settle route deliberately skips it),
    // so a bootstrapped H2H round would accept bets that can never be paid out or refunded.
    // Refuse to create one until settlement lands. See app/api/admin/pm/rounds/settle/route.ts.
    if (market_kind === "HEAD_TO_HEAD") {
      return NextResponse.json(
        { error: "HEAD_TO_HEAD markets are not yet supported (settlement unimplemented)" },
        { status: 400 },
      )
    }

    // kind_params persists kind-specific config (e.g. {"n":3} for TOP_N,
    // {"a","b"} for HEAD_TO_HEAD). For TOP_N we also pin n so settlement can
    // read it straight off the round without re-deriving the default.
    const kind_params: Record<string, any> =
      body?.kind_params && typeof body.kind_params === "object" && !Array.isArray(body.kind_params) ? { ...body.kind_params } : {}
    if (market_kind === "TOP_N" && !Number.isFinite(Number(kind_params.n))) {
      kind_params.n = top_n
    }

    const kolSelection = body?.kol_selection === "tracked_rank" || body?.kol_selection === "active"
      ? body.kol_selection
      : limit_kols <= 50
        ? "active"
        : "tracked_rank"

    const minRecentTxs = typeof body?.min_recent_txs === "number" && Number.isFinite(body.min_recent_txs) && body.min_recent_txs > 0
      ? Math.min(25, Math.floor(body.min_recent_txs))
      : 3

    const supabase = createServiceClient()

    const escrowAddresses = getEscrowAddressesFromEnv()

    const created: any[] = []

    for (const market_type of marketTypes) {
      const lockTs =
        typeof body?.lock_ts === "string" && body.lock_ts.length > 0 && Number.isFinite(Date.parse(body.lock_ts))
          ? new Date(body.lock_ts).toISOString()
          : pickLockTs(market_type)

      const round_id = `${market_type}:${lockTs}`

      // Insert-if-absent: bootstrap must NEVER mutate an existing round. Re-opening a
      // locked/settled round (or re-activating its outcomes) would re-accept bets on an
      // already-decided market and could reverse a settlement. Skipping early also avoids
      // the expensive KOL scan on every cron tick once the round already exists.
      const { data: existingRound, error: existErr } = await supabase
        .from("market_rounds")
        .select("round_id, status")
        .eq("round_id", round_id)
        .maybeSingle()
      if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 })
      if (existingRound) {
        created.push({
          round_id,
          market_type,
          skipped: true,
          reason: `already exists (status=${String((existingRound as any).status ?? "?")})`,
        })
        continue
      }

      const lockMs = Date.parse(lockTs)
      const startTs = new Date(lockMs - getDeltaMs(market_type)).toISOString()
      const settleTs = new Date(lockMs + settleDelayMin * 60_000).toISOString()

      const selectedKols =
        kolSelection === "active"
          ? await selectActiveKols({ supabase, lockTs, startTs, limit: limit_kols, minRecentTxs })
          : await (async () => {
              const { data, error } = await supabase
                .from("kols")
                .select("wallet_address, display_name")
                .eq("is_active", true)
                .eq("is_tracked", true)
                .order("tracked_rank", { ascending: true, nullsFirst: false })
                .limit(limit_kols)

              if (error) throw error

              const rows = Array.isArray(data) ? data : []
              return {
                kols: rows.map((k: any) => ({
                  wallet_address: String(k.wallet_address),
                  display_name: (k.display_name ?? null) as string | null,
                })),
                selection_fallback: null,
              }
            })()

      const escrow_wallet_pubkey = pickEscrowAddress(round_id, escrowAddresses)
      if (!escrow_wallet_pubkey) return NextResponse.json({ error: "Missing escrow wallet addresses" }, { status: 500 })

      const inputs_hash = createHash("sha256")
        .update(JSON.stringify({ market_type, startTs, lockTs, settleTs, escrow_wallet_pubkey, rake_bps, collateral_mint, market_kind, kind_params }))
        .digest("hex")
        .slice(0, 32)

      // Insert-only (ON CONFLICT DO NOTHING). Combined with the existence check above this
      // guards against a race with a concurrent tick and never overwrites an existing round.
      const { data: insertedRound, error: roundErr } = await supabase
        .from("market_rounds")
        .upsert(
          {
            round_id,
            market_type,
            start_ts: startTs,
            lock_ts: lockTs,
            settle_ts: settleTs,
            status: "OPEN",
            collateral_mint,
            escrow_wallet_pubkey,
            rake_bps,
            inputs_hash,
            market_kind,
            kind_params,
          },
          { onConflict: "round_id", ignoreDuplicates: true },
        )
        .select("round_id")

      if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 })
      if (!insertedRound || insertedRound.length === 0) {
        created.push({ round_id, market_type, skipped: true, reason: "created concurrently" })
        continue
      }

      const selectedKolsRows = Array.isArray((selectedKols as any)?.kols) ? ((selectedKols as any).kols as any[]) : ((selectedKols as any) ?? [])
      const selectionFallback = typeof (selectedKols as any)?.selection_fallback === "string" ? String((selectedKols as any).selection_fallback) : null

      const timeframe = timeframeWord(market_type)

      const outcomeRows = (selectedKolsRows ?? []).map((k: any) => {
        const wallet = String(k.wallet_address ?? "")
        const name = typeof k.display_name === "string" && k.display_name.length > 0 ? k.display_name : `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
        return {
          round_id,
          kol_wallet_address: wallet,
          question_text: questionTextForKind({ kind: market_kind, name, top_n, timeframe }),
          status: "ACTIVE",
        }
      })

      const { error: outErr } = await supabase.from("outcome_markets").upsert(outcomeRows, {
        onConflict: "round_id,kol_wallet_address",
      })

      if (outErr) return NextResponse.json({ error: outErr.message }, { status: 500 })

      created.push({
        round_id,
        market_type,
        market_kind,
        kind_params,
        lock_ts: lockTs,
        collateral_mint,
        rake_bps,
        outcomes: outcomeRows.length,
        kol_selection: kolSelection,
        min_recent_txs: kolSelection === "active" ? minRecentTxs : null,
        selection_fallback: kolSelection === "active" ? selectionFallback : null,
        selected_wallets: outcomeRows.map((o: any) => o.kol_wallet_address),
      })
    }

    return NextResponse.json({ ok: true, created })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
