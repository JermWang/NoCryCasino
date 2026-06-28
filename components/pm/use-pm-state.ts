"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useToast } from "@/hooks/use-toast"
import { base64FromBytes, buildPmMessage, makeNonce, SOL_MINT } from "./pm-client"
import type { BalanceRow, BetRow } from "./types"

export type PmState = {
  raw: any
  balances: BalanceRow[]
  bets: BetRow[]
  emergencyHalt: boolean
}

/** Normalize the me/state payload, tolerating both the canonical balances[]
 * array and the legacy single `balance` object, and both `bets` and the
 * older `claims` shape for resolved positions. */
function normalize(json: any): PmState {
  let balances: BalanceRow[] = []
  if (Array.isArray(json?.balances)) {
    balances = json.balances.map((b: any) => ({
      mint: String(b?.mint ?? SOL_MINT),
      available_collateral: Number(b?.available_collateral ?? 0),
      reserved_collateral: Number(b?.reserved_collateral ?? 0),
      updated_at: b?.updated_at,
    }))
  } else if (json?.balance) {
    balances = [
      {
        mint: String(json.balance?.mint ?? SOL_MINT),
        available_collateral: Number(json.balance?.available_collateral ?? 0),
        reserved_collateral: Number(json.balance?.reserved_collateral ?? 0),
        updated_at: json.balance?.updated_at,
      },
    ]
  }

  const bets: BetRow[] = Array.isArray(json?.bets)
    ? json.bets.map((b: any) => ({
        bet_id: String(b?.bet_id ?? b?.id ?? cryptoId()),
        round_id: b?.round_id,
        outcome_id: String(b?.outcome_id ?? ""),
        side: b?.side,
        amount: Number(b?.amount ?? 0),
        mint: String(b?.mint ?? SOL_MINT),
        payout: b?.payout != null ? Number(b.payout) : null,
        fee: b?.fee != null ? Number(b.fee) : null,
        fee_exempt: b?.fee_exempt === true,
        status: String(b?.status ?? "ACTIVE"),
        created_at: String(b?.created_at ?? ""),
        settled_at: b?.settled_at ?? null,
      }))
    : []

  return {
    raw: json,
    balances,
    bets,
    emergencyHalt: Boolean(json?.emergency_halt_active),
  }
}

function cryptoId(): string {
  return makeNonce()
}

/**
 * Loads and refreshes the signed PM account state (balances + bets) for the
 * connected wallet. Signs the canonical "NoCryCasino PM Me v1" message.
 */
export function usePmState() {
  const { toast } = useToast()
  const { publicKey, connected, signMessage } = useWallet()

  const [state, setState] = useState<PmState | null>(null)
  const [loading, setLoading] = useState(false)
  const refreshing = useRef(false)

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!publicKey || !signMessage) return
      if (refreshing.current) return
      refreshing.current = true
      setLoading(true)
      try {
        const wallet_address = publicKey.toBase58()
        const issued_at = new Date().toISOString()
        const nonce = makeNonce()

        const message = buildPmMessage("NoCryCasino PM Me v1", {
          wallet_address,
          nonce,
          issued_at,
        })

        const sigBytes = await signMessage(new TextEncoder().encode(message))
        const signature_base64 = base64FromBytes(sigBytes)

        const res = await fetch("/api/pm/me/state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet_address, nonce, issued_at, signature_base64, message }),
        })

        const json = (await res.json().catch(() => null)) as any
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load account state")

        setState(normalize(json))
      } catch (e: any) {
        setState(null)
        if (!opts?.silent) {
          toast({ title: "Account state", description: e?.message ?? String(e), variant: "destructive" })
        }
      } finally {
        setLoading(false)
        refreshing.current = false
      }
    },
    [publicKey, signMessage, toast],
  )

  useEffect(() => {
    if (connected) void refresh({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toBase58()])

  /** Available balance for a given mint (defaults to 0). */
  const availableFor = useCallback(
    (mint: string | null | undefined): number => {
      if (!state) return 0
      const target = String(mint ?? SOL_MINT)
      const row =
        state.balances.find((b) => b.mint === target) ??
        // Fall back to a SOL row if mint label differs but only one balance exists.
        (state.balances.length === 1 ? state.balances[0] : undefined)
      return row ? Number(row.available_collateral) : 0
    },
    [state],
  )

  return { state, loading, refresh, availableFor, connected }
}
