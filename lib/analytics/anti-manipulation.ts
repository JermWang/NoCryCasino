/**
 * Anti-Manipulation Detection
 * Addresses audit item 8.5: Volume thresholds, counterparty diversity checks
 *
 * Eligibility relies only on signals we actually derive from ingested tx_events.
 * The wallet-age gate was removed because `kols.wallet_created_at` is never
 * populated (no ingestion writes it), so the check silently no-op'd for every
 * wallet — an inert gate that implied a guarantee we never enforced. Likewise,
 * the `kol_stats_daily` / `tx_event_analysis` rollup tables are never written by
 * ingestion, so the previous DB-backed `isEligibleForSettlement` always read
 * zero rows and returned "eligible" regardless of behavior. Both have been
 * removed here so eligibility is honest and matches lib/analytics/snapshot.ts.
 */

export type AntiManipulationConfig = {
  min_volume_sol: number
  min_unique_counterparties: number
  max_self_transfer_ratio: number
  max_wash_trade_ratio: number
}

const DEFAULT_CONFIG: AntiManipulationConfig = {
  min_volume_sol: 0.1,
  min_unique_counterparties: 3,
  max_self_transfer_ratio: 0.1,
  max_wash_trade_ratio: 0.2,
}

export type WalletValidationResult = {
  is_valid: boolean
  reasons: string[]
  volume_sol: number
  unique_counterparties: number
  self_transfer_ratio: number
  wash_trade_ratio: number
}

/**
 * Validate a wallet against anti-manipulation rules using observed, ingested
 * signals only. Synchronous and pure: callers pass in already-aggregated stats.
 */
export function validateWallet(
  wallet_address: string,
  stats: {
    volume_sol: number
    unique_counterparties: number
    tx_count: number
    self_transfer_count: number
    wash_trade_suspect_count: number
  },
  config: AntiManipulationConfig = DEFAULT_CONFIG,
): WalletValidationResult {
  const reasons: string[] = []

  // Check volume threshold
  if (stats.volume_sol < config.min_volume_sol) {
    reasons.push(`Volume (${stats.volume_sol.toFixed(4)} SOL) below minimum (${config.min_volume_sol} SOL)`)
  }

  // Check counterparty diversity
  if (stats.unique_counterparties < config.min_unique_counterparties) {
    reasons.push(`Unique counterparties (${stats.unique_counterparties}) below minimum (${config.min_unique_counterparties})`)
  }

  // Check self-transfer ratio
  const self_transfer_ratio = stats.tx_count > 0 ? stats.self_transfer_count / stats.tx_count : 0
  if (self_transfer_ratio > config.max_self_transfer_ratio) {
    reasons.push(`Self-transfer ratio (${(self_transfer_ratio * 100).toFixed(1)}%) exceeds maximum (${(config.max_self_transfer_ratio * 100).toFixed(1)}%)`)
  }

  // Check wash trade ratio
  const wash_trade_ratio = stats.tx_count > 0 ? stats.wash_trade_suspect_count / stats.tx_count : 0
  if (wash_trade_ratio > config.max_wash_trade_ratio) {
    reasons.push(`Wash trade ratio (${(wash_trade_ratio * 100).toFixed(1)}%) exceeds maximum (${(config.max_wash_trade_ratio * 100).toFixed(1)}%)`)
  }

  return {
    is_valid: reasons.length === 0,
    reasons,
    volume_sol: stats.volume_sol,
    unique_counterparties: stats.unique_counterparties,
    self_transfer_ratio,
    wash_trade_ratio,
  }
}

/**
 * Detect potential wash trading between two wallets
 * Returns true if the transaction pattern suggests wash trading
 */
export function detectWashTrade(args: {
  wallet_a: string
  wallet_b: string
  recent_txs_a_to_b: number
  recent_txs_b_to_a: number
  time_window_hours: number
}): { is_suspect: boolean; reason?: string } {
  const { wallet_a, wallet_b, recent_txs_a_to_b, recent_txs_b_to_a, time_window_hours } = args

  // Same wallet
  if (wallet_a === wallet_b) {
    return { is_suspect: true, reason: "Self-transfer" }
  }

  // Bidirectional transfers in short time window
  if (recent_txs_a_to_b > 0 && recent_txs_b_to_a > 0) {
    const total = recent_txs_a_to_b + recent_txs_b_to_a
    if (total >= 4 && time_window_hours <= 24) {
      return { is_suspect: true, reason: `High bidirectional activity (${total} txs in ${time_window_hours}h)` }
    }
  }

  return { is_suspect: false }
}
