"use client"

// Shared client helpers for the parimutuel prediction-market UI.
// Mirrors the signing pattern used across app/pm/* and lib/pm/signing.ts:
// build a newline-joined "title\nkey=value" message, sign it Ed25519 with the
// connected Solana wallet's signMessage, and base64-encode the raw signature.

export type PmSide = "YES" | "NO"

export const SOL_MINT = "SOL"
// Canonical USDC mint on Solana mainnet (used only to label the collateral).
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

/** Base64-encode raw signature bytes (browser-safe, mirrors existing pages). */
export function base64FromBytes(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

/** Random nonce, also usable as an idempotency key (>= 8 chars guaranteed). */
export function makeNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
}

/** Build the canonical PM message: "title" then ordered "key=value" lines. */
export function buildPmMessage(title: string, fields: Record<string, string>): string {
  const lines = [title]
  for (const [k, v] of Object.entries(fields)) lines.push(`${k}=${v}`)
  return lines.join("\n")
}

/** Human label for a collateral mint. Treats any non-SOL value as USDC. */
export function mintLabel(mint: string | null | undefined): string {
  if (!mint) return "SOL"
  const m = mint.trim()
  if (m === SOL_MINT || m.toUpperCase() === "SOL") return "SOL"
  if (m === USDC_MINT || m.toUpperCase() === "USDC") return "USDC"
  // Unknown SPL mint: show a short, recognizable label.
  return "USDC"
}

/** Format a token amount with a sensible number of decimals. */
export function formatAmount(value: number | string | null | undefined, decimals = 4): string {
  const n = typeof value === "number" ? value : Number(value ?? 0)
  if (!Number.isFinite(n)) return (0).toFixed(decimals)
  return n.toFixed(decimals)
}

/**
 * Compact token amount for headline stats (e.g. pool size / volume):
 * 1234567 -> "1.23M", 12345 -> "12.3K", 12.3456 -> "12.35", 0 -> "0".
 * Keeps small values readable while shrinking large pools.
 */
export function formatCompact(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0)
  if (!Number.isFinite(n) || n === 0) return "0"
  const abs = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`
  if (abs >= 1) return `${sign}${abs.toFixed(2)}`
  // Sub-1 amounts: show more precision but trim trailing zeros.
  return `${sign}${parseFloat(abs.toFixed(4))}`
}

/** Compact amount with the mint label appended, e.g. "12.3K SOL". */
export function formatCompactWithMint(
  value: number | string | null | undefined,
  mint: string | null | undefined,
): string {
  return `${formatCompact(value)} ${mintLabel(mint)}`
}

/** Implied YES probability (0-100) from pools, preferring an explicit prob. */
export function impliedYesPct(
  yesPool: number | null | undefined,
  noPool: number | null | undefined,
  yesProb?: number | null,
): number {
  if (typeof yesProb === "number" && Number.isFinite(yesProb)) {
    return clampPct(Math.round(yesProb * 100))
  }
  const y = Number(yesPool) || 0
  const n = Number(noPool) || 0
  const total = y + n
  if (total <= 0) return 50
  return clampPct(Math.round((y / total) * 100))
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 50
  return Math.min(100, Math.max(0, n))
}

/**
 * Indicative parimutuel payout for staking `amount` on `side`, assuming pools
 * settle as they stand now. Returns the gross return (stake + profit) before
 * any rake. Mirrors the math the settlement RPC applies pro-rata.
 */
export function previewPayout(args: {
  amount: number
  side: PmSide
  yesPool: number
  noPool: number
}): number | null {
  const { amount, side, yesPool, noPool } = args
  if (!Number.isFinite(amount) || amount <= 0) return null
  const winPool = (side === "YES" ? yesPool : noPool) + amount
  const losePool = side === "YES" ? noPool : yesPool
  if (winPool <= 0) return null
  const profit = (losePool * amount) / winPool
  return amount + profit
}

/** Apply a rake (in basis points) to a gross profit amount. */
export function applyRake(grossProfit: number, rakeBps: number, feeExempt: boolean): number {
  if (feeExempt || !Number.isFinite(rakeBps) || rakeBps <= 0) return 0
  return (grossProfit * rakeBps) / 10_000
}

/** Multiplier (× on stake) implied by a payout, e.g. 1.85×. */
export function payoutMultiple(stake: number, payout: number | null): string {
  if (!payout || !Number.isFinite(stake) || stake <= 0) return "—"
  const m = payout / stake
  if (!Number.isFinite(m) || m <= 0) return "—"
  return `${m.toFixed(2)}×`
}

/** Truncate a wallet address as 1234…ABCD. */
export function shortAddress(addr: string | null | undefined): string {
  if (!addr) return "—"
  if (addr.length <= 10) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

/** A countdown string until `iso`, or "Locked" once past. */
export function timeUntil(iso: string | null | undefined): string {
  if (!iso) return "—"
  const target = new Date(iso).getTime()
  if (!Number.isFinite(target)) return "—"
  const diff = target - Date.now()
  if (diff <= 0) return "Locked"

  const totalSec = Math.floor(diff / 1000)
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** True once `lockIso` is in the past. */
export function isPastLock(lockIso: string | null | undefined): boolean {
  if (!lockIso) return false
  const t = new Date(lockIso).getTime()
  if (!Number.isFinite(t)) return false
  return Date.now() >= t
}
