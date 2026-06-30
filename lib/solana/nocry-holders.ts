// On-chain $NOCRY holder enumeration for the daily fee-rewards distribution.
//
// Fetches every SPL token account of the NOCRY_MINT via Helius RPC
// getProgramAccounts (filtered to the mint), parses the owner + raw amount out
// of the 165-byte token-account layout, converts to a UI amount (6 decimals),
// and returns the holders at or above `minTokens`.
//
// Fail-safe: returns [] on any misconfiguration or RPC error. The distribute
// endpoint treats an empty holder set as "no eligible holders today" rather
// than crediting anyone, so a transient RPC failure never mis-distributes.
//
// Required env:
//   NOCRY_MINT      - the $NOCRY SPL mint (REQUIRED; if unset returns [])
//   HELIUS_API_KEY  - Helius key for the RPC endpoint (preferred)
//   SOLANA_RPC_URL  - fallback RPC if HELIUS_API_KEY is unset

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
const NOCRY_DECIMALS = 6
// Standard SPL token-account size; owner at byte 32, amount (u64 LE) at byte 64.
const TOKEN_ACCOUNT_DATA_SIZE = 165

export type NocryHolder = { owner: string; balance: number }

function rpcEndpoint(): string | null {
  const key = (process.env.HELIUS_API_KEY ?? "").trim()
  if (key.length > 0) return `https://mainnet.helius-rpc.com/?api-key=${key}`
  const url = (process.env.SOLANA_RPC_URL ?? "").trim()
  return url.length > 0 ? url : null
}

function nocryMint(): string | null {
  const mint = (process.env.NOCRY_MINT ?? "").trim()
  return mint.length > 0 ? mint : null
}

/** Decode a little-endian u64 from a byte slice into a JS number. */
function readU64LE(bytes: Uint8Array, offset: number): number {
  let value = 0
  let mul = 1
  for (let i = 0; i < 8; i++) {
    value += bytes[offset + i]! * mul
    mul *= 256
  }
  return value
}

/**
 * Returns all $NOCRY token-account owners holding >= `minTokens` (UI amount),
 * with their per-account balance. Multiple token accounts for the same owner
 * appear as separate entries; callers that need per-owner totals should
 * aggregate. Returns [] on any failure.
 */
export async function getNocryHolders(minTokens = 1_000_000): Promise<NocryHolder[]> {
  const endpoint = rpcEndpoint()
  const mint = nocryMint()
  if (!endpoint || !mint) return []

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "nocry-holders",
        method: "getProgramAccounts",
        params: [
          TOKEN_PROGRAM_ID,
          {
            encoding: "base64",
            filters: [
              { dataSize: TOKEN_ACCOUNT_DATA_SIZE },
              { memcmp: { offset: 0, bytes: mint } },
            ],
          },
        ],
      }),
    })

    const json = (await res.json().catch(() => null)) as any
    if (!res.ok || json?.error || !Array.isArray(json?.result)) return []

    const { PublicKey } = await import("@solana/web3.js")
    const divisor = Math.pow(10, NOCRY_DECIMALS)
    const holders: NocryHolder[] = []

    for (const entry of json.result as any[]) {
      const dataField = entry?.account?.data
      const b64 = Array.isArray(dataField) ? dataField[0] : dataField
      if (typeof b64 !== "string") continue

      const raw = Uint8Array.from(Buffer.from(b64, "base64"))
      if (raw.length < TOKEN_ACCOUNT_DATA_SIZE) continue

      const ownerBytes = raw.slice(32, 64)
      const owner = new PublicKey(ownerBytes).toBase58()
      const balance = readU64LE(raw, 64) / divisor

      if (Number.isFinite(balance) && balance >= minTokens) {
        holders.push({ owner, balance })
      }
    }

    return holders
  } catch {
    return []
  }
}
