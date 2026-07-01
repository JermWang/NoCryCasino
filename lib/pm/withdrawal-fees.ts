/**
 * Withdrawal network-fee accounting.
 *
 * Payouts are custodial: the escrow wallet signs and broadcasts the transfer, so
 * it is the on-chain fee payer. To keep the HOUSE from eating gas, we deduct the
 * network fee from the amount the user receives — the user is debited their full
 * requested amount at request time, receives (amount − fee) on-chain, and the
 * escrow's net outflow equals the amount debited. The house pays zero gas.
 *
 * Deposits are already user-paid (the user signs that tx), and bets / settlement /
 * reward claims are custodial DB operations with no per-action on-chain tx, so
 * withdrawals are the only place the house would otherwise pay gas.
 */

import type { Connection } from "@solana/web3.js"
import { PublicKey } from "@solana/web3.js"
import { getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token"

/** Base fee for a single-signature Solana tx (we set no priority fee), in lamports. */
export const WITHDRAWAL_BASE_FEE_LAMPORTS = 5000

/** Rent to create a destination Associated Token Account (~0.00204 SOL), in lamports. */
export const ATA_RENT_LAMPORTS = 2_039_280

/** Conservative SOL/USD used only if a live price is unavailable, so USDC gas is never undercharged. */
const FALLBACK_SOL_PRICE_USD = 300

/**
 * Net SOL payout after deducting the network fee. The escrow sends `sendLamports`
 * and pays `feeLamports` gas, so its total outflow equals the user's debited amount.
 */
export function netSolPayoutLamports(amountSol: number): { sendLamports: number; feeLamports: number } {
  const gross = Math.round(amountSol * 1e9)
  const feeLamports = WITHDRAWAL_BASE_FEE_LAMPORTS
  return { sendLamports: gross - feeLamports, feeLamports }
}

/**
 * Net USDC payout after deducting the SOL gas (tx fee + destination-ATA rent when
 * the ATA must be created), converted to USDC at the given SOL price. The escrow
 * pays the SOL gas on-chain but retains the equivalent USDC, so it stays whole.
 * `feeUsdc` is rounded UP to 6 decimals so the house is never short a unit.
 */
export async function netUsdcPayout(args: {
  connection: Connection
  destinationOwner: string
  mint: string
  amountHuman: number
  solPriceUsd: number
}): Promise<{ sendHuman: number; feeUsdc: number; feeLamports: number; ataExists: boolean }> {
  const mintPk = new PublicKey(args.mint)
  const ownerPk = new PublicKey(args.destinationOwner)
  const destAta = getAssociatedTokenAddressSync(mintPk, ownerPk, true, TOKEN_PROGRAM_ID)

  let ataExists = false
  try {
    await getAccount(args.connection, destAta, "confirmed", TOKEN_PROGRAM_ID)
    ataExists = true
  } catch {
    // Missing ATA (or RPC hiccup) -> assume creation is needed; deducting rent errs
    // toward covering the house, never undercharging it.
    ataExists = false
  }

  const feeLamports = WITHDRAWAL_BASE_FEE_LAMPORTS + (ataExists ? 0 : ATA_RENT_LAMPORTS)
  const price = Number.isFinite(args.solPriceUsd) && args.solPriceUsd > 0 ? args.solPriceUsd : FALLBACK_SOL_PRICE_USD
  const feeUsdcRaw = (feeLamports / 1e9) * price
  const feeUsdc = Math.ceil(feeUsdcRaw * 1e6) / 1e6 // round up to the smallest USDC unit
  return { sendHuman: args.amountHuman - feeUsdc, feeUsdc, feeLamports, ataExists }
}
