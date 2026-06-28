// $NOCRY fee-waiver logic for the prediction market.
//
// Rule: holding >= NOCRY_FEE_WAIVER_THRESHOLD $NOCRY (default 10,000) at the
// moment a bet is placed makes that bet fee-exempt (no rake on its winnings).
// The exemption is snapshotted onto the bet (pm_bets.fee_exempt) so settlement
// is deterministic and not affected by later balance changes.
//
// Required env to activate the waiver:
//   NOCRY_MINT                  - the $NOCRY SPL mint address (REQUIRED; if unset the waiver is OFF)
//   NOCRY_FEE_WAIVER_THRESHOLD  - UI-amount threshold, default 10000
//   SOLANA_RPC_URL / NEXT_PUBLIC_SOLANA_RPC_URL - RPC used to read balances

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com"

export function getNocryConfig(): { mint: string | null; threshold: number } {
  const mint = (process.env.NOCRY_MINT ?? "").trim()
  const rawThreshold = Number(process.env.NOCRY_FEE_WAIVER_THRESHOLD)
  const threshold = Number.isFinite(rawThreshold) && rawThreshold > 0 ? rawThreshold : 10_000
  return { mint: mint.length > 0 ? mint : null, threshold }
}

function rpcUrl(): string {
  return (
    (process.env.SOLANA_RPC_URL ?? "").trim() ||
    (process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "").trim() ||
    DEFAULT_RPC
  )
}

/**
 * Returns the total UI-amount of $NOCRY held by `walletAddress` across all of
 * its token accounts for the NOCRY mint. Returns 0 if the waiver is not
 * configured or on any RPC error (fail-safe: no waiver rather than a free pass).
 */
export async function getNocryBalance(walletAddress: string): Promise<number> {
  const { mint } = getNocryConfig()
  if (!mint) return 0
  try {
    const { Connection, PublicKey } = await import("@solana/web3.js")
    const conn = new Connection(rpcUrl(), "confirmed")
    const owner = new PublicKey(walletAddress)
    const mintPk = new PublicKey(mint)
    const res = await conn.getParsedTokenAccountsByOwner(owner, { mint: mintPk })
    let total = 0
    for (const { account } of res.value) {
      const ui = Number(account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0)
      if (Number.isFinite(ui)) total += ui
    }
    return total
  } catch {
    return 0
  }
}

/**
 * Whether `walletAddress` qualifies for the $NOCRY fee waiver right now.
 * Fail-safe: returns false (fees apply) if the waiver is unconfigured or the
 * balance lookup fails — we never grant a free bet on uncertainty.
 */
export async function isFeeExempt(walletAddress: string): Promise<boolean> {
  const { mint, threshold } = getNocryConfig()
  if (!mint) return false
  const balance = await getNocryBalance(walletAddress)
  return balance >= threshold
}
