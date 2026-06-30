import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { getNocryHolders } from "@/lib/solana/nocry-holders"

export const runtime = "nodejs"

// Holders >= this many $NOCRY (UI amount) are eligible for the daily split.
const HOLDER_MIN_TOKENS = 1_000_000

// Fraction (in bps) of platform house fees handed to eligible holders.
// 50% by default; overridable via NOCRY_HOLDER_FEE_BPS.
function holderFeeBps(): number {
  const raw = Number(process.env.NOCRY_HOLDER_FEE_BPS)
  if (Number.isFinite(raw) && raw >= 0 && raw <= 10_000) return raw
  return 5000
}

/** UTC calendar date (YYYY-MM-DD) for the run. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

type FeeRow = { fee_id: string; mint: string; amount: number }

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:nocry:distribute", limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 25_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const supabase = createServiceClient()
    const day = utcToday()
    const bps = holderFeeBps()

    // 1) Pull all undistributed house fees (distribution_id IS NULL).
    const { data: feeData, error: feeErr } = await supabase
      .from("pm_protocol_fees")
      .select("fee_id, mint, amount")
      .is("distribution_id", null)
      .limit(100_000)

    if (feeErr) return NextResponse.json({ error: feeErr.message }, { status: 500 })

    const fees = (Array.isArray(feeData) ? feeData : []) as FeeRow[]

    // Group undistributed fees + their fee_ids by mint.
    const byMint = new Map<string, { total: number; feeIds: string[] }>()
    for (const f of fees) {
      const mint = String(f.mint)
      const amt = Number(f.amount)
      if (!Number.isFinite(amt) || amt <= 0) continue
      const e = byMint.get(mint) ?? { total: 0, feeIds: [] }
      e.total += amt
      e.feeIds.push(f.fee_id)
      byMint.set(mint, e)
    }

    if (byMint.size === 0) {
      return NextResponse.json({ ok: true, day, holder_fee_bps: bps, distributions: [], note: "No undistributed fees" })
    }

    // 2) Fetch eligible holders once (same mint set regardless of fee mint).
    //    getNocryHolders returns per-token-account rows; aggregate per owner.
    const rawHolders = await getNocryHolders(HOLDER_MIN_TOKENS)
    const ownerTotals = new Map<string, number>()
    for (const h of rawHolders) {
      ownerTotals.set(h.owner, (ownerTotals.get(h.owner) ?? 0) + h.balance)
    }
    const holders = [...ownerTotals.entries()]
      .map(([owner, balance]) => ({ owner, balance }))
      .filter((h) => h.balance >= HOLDER_MIN_TOKENS)

    const totalHoldings = holders.reduce((s, h) => s + h.balance, 0)
    const distributions: any[] = []

    // 3) One distribution row per mint with undistributed fees.
    for (const [mint, { total, feeIds }] of byMint.entries()) {
      // Idempotency: skip if this (day, mint) already distributed.
      const { data: existing, error: exErr } = await supabase
        .from("nocry_fee_distributions")
        .select("distribution_id")
        .eq("day", day)
        .eq("mint", mint)
        .maybeSingle()

      if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })
      if (existing) {
        distributions.push({ mint, skipped: true, reason: "Already distributed today" })
        continue
      }

      const holderPool = (total * bps) / 10_000
      const hasHolders = holders.length > 0 && totalHoldings > 0

      // Insert the distribution ledger row. If holders/pool are empty we still
      // record a ZERO/EMPTY distribution so we don't retry the same fees all day
      // and so the fees get marked consumed (rolling into a later real payout
      // would require a holder set we don't have today).
      const { data: dist, error: distErr } = await supabase
        .from("nocry_fee_distributions")
        .insert({
          day,
          mint,
          total_fees: total,
          holder_pool: hasHolders ? holderPool : 0,
          holder_count: hasHolders ? holders.length : 0,
          total_holdings: hasHolders ? totalHoldings : 0,
          status: hasHolders ? "DISTRIBUTED" : "NO_HOLDERS",
        })
        .select("distribution_id")
        .single()

      if (distErr) {
        // Unique (day, mint) violation == another worker beat us; treat as skip.
        distributions.push({ mint, skipped: true, reason: distErr.message })
        continue
      }

      const distributionId = dist.distribution_id as string

      // Per-holder claim rows (only when there are holders to pay).
      if (hasHolders) {
        const claimRows = holders.map((h) => {
          const shareBps = (h.balance / totalHoldings) * 10_000
          const amount = (holderPool * h.balance) / totalHoldings
          return {
            distribution_id: distributionId,
            wallet_pubkey: h.owner,
            mint,
            holder_balance: h.balance,
            share_bps: shareBps,
            amount,
          }
        })

        const { error: claimErr } = await supabase.from("nocry_reward_claims").insert(claimRows)
        if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 })
      }

      // 4) Mark the consumed fees as distributed so they're never paid twice.
      const { error: markErr } = await supabase
        .from("pm_protocol_fees")
        .update({ distribution_id: distributionId })
        .in("fee_id", feeIds)

      if (markErr) return NextResponse.json({ error: markErr.message }, { status: 500 })

      distributions.push({
        mint,
        distribution_id: distributionId,
        total_fees: total,
        holder_pool: hasHolders ? holderPool : 0,
        holder_count: hasHolders ? holders.length : 0,
        total_holdings: hasHolders ? totalHoldings : 0,
        fees_consumed: feeIds.length,
        status: hasHolders ? "DISTRIBUTED" : "NO_HOLDERS",
      })
    }

    return NextResponse.json({ ok: true, day, holder_fee_bps: bps, distributions })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
