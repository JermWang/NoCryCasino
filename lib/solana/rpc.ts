/**
 * RPC Resilience Layer
 * Addresses audit item 8.7: Fallback RPC list with retry logic
 */

import { Connection, type Finality } from "@solana/web3.js"

const DEFAULT_RPC_ENDPOINTS = [
  "https://mainnet.helius-rpc.com/v0/public",
  "https://api.mainnet-beta.solana.com",
  "https://solana-api.projectserum.com",
]

function getRpcEndpoints(): string[] {
  const primary = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  const fallbacks = process.env.SOLANA_RPC_FALLBACKS

  const endpoints: string[] = []

  if (primary && primary.trim().length > 0) {
    endpoints.push(primary.trim())
  }

  if (fallbacks && fallbacks.trim().length > 0) {
    const parsed = fallbacks.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    endpoints.push(...parsed)
  }

  if (endpoints.length === 0) {
    return DEFAULT_RPC_ENDPOINTS
  }

  return endpoints
}

export type RpcCallOptions = {
  maxRetries?: number
  retryDelayMs?: number
  commitment?: "processed" | "confirmed" | "finalized"
}

function toFinality(commitment: RpcCallOptions["commitment"] | undefined): Finality {
  if (commitment === "finalized") return "finalized"
  return "confirmed"
}

const DEFAULT_OPTIONS: Required<RpcCallOptions> = {
  maxRetries: 3,
  retryDelayMs: 1000,
  commitment: "confirmed",
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute an RPC call with fallback endpoints and retry logic
 */
export async function withRpcFallback<T>(
  fn: (connection: Connection) => Promise<T>,
  options?: RpcCallOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const endpoints = getRpcEndpoints()

  let lastError: Error | null = null

  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    for (const endpoint of endpoints) {
      try {
        const connection = new Connection(endpoint, opts.commitment)
        return await fn(connection)
      } catch (e: any) {
        lastError = e instanceof Error ? e : new Error(String(e))
        // Continue to next endpoint
      }
    }

    // All endpoints failed, wait before retry
    if (attempt < opts.maxRetries - 1) {
      await sleep(opts.retryDelayMs * (attempt + 1)) // Exponential backoff
    }
  }

  throw lastError ?? new Error("All RPC endpoints failed")
}

/**
 * Get a connection to the primary RPC endpoint
 */
export function getConnection(commitment: "processed" | "confirmed" | "finalized" = "confirmed"): Connection {
  const endpoints = getRpcEndpoints()
  return new Connection(endpoints[0] ?? DEFAULT_RPC_ENDPOINTS[0], commitment)
}

/**
 * Verify a transaction exists and succeeded with fallback
 */
export async function verifyTransactionWithFallback(
  signature: string,
  options?: RpcCallOptions
): Promise<{
  exists: boolean
  success: boolean
  blockTime: number | null
  slot: number | null
  error?: string
}> {
  try {
    const result = await withRpcFallback(async (connection) => {
      const tx = await connection.getParsedTransaction(signature, {
        commitment: toFinality(options?.commitment),
        maxSupportedTransactionVersion: 0,
      })

      if (!tx) {
        return { exists: false, success: false, blockTime: null, slot: null }
      }

      return {
        exists: true,
        success: !tx.meta?.err,
        blockTime: tx.blockTime ?? null,
        slot: typeof tx.slot === "number" ? tx.slot : null,
      }
    }, options)

    return result
  } catch (e: any) {
    return {
      exists: false,
      success: false,
      blockTime: null,
      slot: null,
      error: e?.message ?? String(e),
    }
  }
}

/**
 * Get parsed transaction with fallback
 */
export async function getParsedTransactionWithFallback(
  signature: string,
  options?: RpcCallOptions
) {
  return withRpcFallback(async (connection) => {
    return connection.getParsedTransaction(signature, {
      commitment: toFinality(options?.commitment),
      maxSupportedTransactionVersion: 0,
    })
  }, options)
}

/**
 * Best-effort signature status across fallback endpoints.
 * Returns "confirmed" if the tx landed successfully, "failed" if it landed with
 * an error, or "unknown" if it cannot be found (not yet propagated / expired).
 */
async function getSignatureLanded(signature: string): Promise<"confirmed" | "failed" | "unknown"> {
  const endpoints = getRpcEndpoints()
  for (const endpoint of endpoints) {
    try {
      const connection = new Connection(endpoint, "confirmed")
      const res = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })
      const s = res?.value?.[0]
      if (!s) continue
      if (s.err) return "failed"
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return "confirmed"
      if (typeof s.confirmations === "number") return "confirmed"
    } catch {
      // try the next endpoint
    }
  }
  return "unknown"
}

/**
 * Broadcast an ALREADY-SIGNED, serialized transaction and confirm it, retrying
 * ONLY the submit/confirm of the identical bytes across fallback endpoints.
 *
 * This is the money-safe way to send a payout. Because the transaction is signed
 * once (a single recentBlockhash => a single signature), re-broadcasting is
 * idempotent: Solana dedups by signature so the tx can land AT MOST ONCE, and once
 * the blockhash expires it can never land. NEVER rebuild/re-sign a payout inside a
 * retry loop — a fresh blockhash yields a NEW signature that could ALSO land,
 * double-paying from escrow.
 *
 * On a confirmation timeout we check the signature status before retrying, so a tx
 * that landed-but-timed-out is reported as SUCCESS (not re-sent, and — critically —
 * not reported as failed, which would wrongly re-credit funds that already left).
 */
export async function broadcastSignedTransaction(args: {
  rawTx: Buffer | Uint8Array
  blockhash: string
  lastValidBlockHeight: number
  commitment?: "confirmed" | "finalized"
  maxRetries?: number
}): Promise<string> {
  const commitment = args.commitment ?? "confirmed"
  const maxRetries = Math.max(1, args.maxRetries ?? 4)
  const endpoints = getRpcEndpoints()
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const endpoint of endpoints) {
      const connection = new Connection(endpoint, commitment)
      let sig: string | null = null
      try {
        // Re-sending identical signed bytes is safe (same signature => on-chain dedup).
        sig = await connection.sendRawTransaction(args.rawTx, { skipPreflight: false, maxRetries: 3 })
      } catch (e: any) {
        lastError = e instanceof Error ? e : new Error(String(e))
      }

      if (sig) {
        try {
          await connection.confirmTransaction(
            { signature: sig, blockhash: args.blockhash, lastValidBlockHeight: args.lastValidBlockHeight },
            commitment,
          )
          return sig
        } catch (e: any) {
          lastError = e instanceof Error ? e : new Error(String(e))
          // Confirm errored/timed out — the tx may STILL have landed. Check before retrying
          // so we neither double-send nor wrongly treat a landed payout as failed.
          const status = await getSignatureLanded(sig)
          if (status === "confirmed") return sig
          if (status === "failed") throw new Error(`transaction failed on-chain (${sig}): ${lastError?.message ?? ""}`)
          // status === "unknown": not landed yet -> fall through and retry the SAME bytes.
        }
      }
    }
    if (attempt < maxRetries - 1) await sleep(500 * (attempt + 1))
  }

  throw lastError ?? new Error("broadcast failed: transaction not confirmed")
}

/**
 * Send and confirm transaction with fallback.
 *
 * NOTE: `serializedTx` must already be signed with a recentBlockhash. This
 * delegates to broadcastSignedTransaction so retries re-send the identical bytes
 * (idempotent) rather than re-signing. Callers should pass the same blockhash the
 * tx was signed with; if omitted we fetch one only to bound the confirm window.
 */
export async function sendAndConfirmWithFallback(
  serializedTx: Buffer | Uint8Array,
  options?: RpcCallOptions & { skipPreflight?: boolean; blockhash?: string; lastValidBlockHeight?: number }
): Promise<string> {
  let blockhash = options?.blockhash
  let lastValidBlockHeight = options?.lastValidBlockHeight
  if (!blockhash || typeof lastValidBlockHeight !== "number") {
    const latest = await withRpcFallback(
      (connection) => connection.getLatestBlockhash(options?.commitment ?? "confirmed"),
      options,
    )
    blockhash = blockhash ?? latest.blockhash
    lastValidBlockHeight = typeof lastValidBlockHeight === "number" ? lastValidBlockHeight : latest.lastValidBlockHeight
  }

  return broadcastSignedTransaction({
    rawTx: serializedTx,
    blockhash,
    lastValidBlockHeight,
    commitment: options?.commitment === "finalized" ? "finalized" : "confirmed",
    maxRetries: options?.maxRetries,
  })
}
