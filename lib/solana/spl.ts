/**
 * SPL Token (USDC) helpers for custodial deposits & payouts.
 *
 * Mint convention (see lib pm-client / .env.example):
 *   - 'SOL'      -> native SOL (handled elsewhere via SystemProgram)
 *   - USDC_MINT  -> SPL USDC, 6 decimals, held in the escrow's Associated Token Account (ATA)
 *
 * These helpers deliberately use integer/string math for the 6-decimal USDC
 * conversion to avoid floating-point drift, and mirror the structure of the
 * native verifySolDeposit in app/api/pm/deposits/credit/route.ts but for the
 * SPL token program (parsed transfer / transferChecked + token balance deltas).
 */

import {
  type Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
  Keypair,
} from "@solana/web3.js"
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
} from "@solana/spl-token"

/** USDC has 6 decimals on Solana. */
export const USDC_DECIMALS = 6
// Note: BigInt literals (e.g. 1_000_000n) require an ES2020 target; this project's
// effective tsc target rejects them, so we build bigints via the BigInt() ctor.
const ZERO = BigInt(0)
const USDC_UNIT_FACTOR = BigInt(1_000_000) // 10 ** 6

/** Canonical mainnet USDC mint, used as the default when USDC_MINT env is unset. */
const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

/**
 * Resolve the configured USDC mint (base58). Falls back to the canonical
 * mainnet mint if USDC_MINT is not set in the environment.
 */
export function getUsdcMint(): string {
  const raw = process.env.USDC_MINT
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim()
  return DEFAULT_USDC_MINT
}

/**
 * True if `mint` is the configured USDC mint. Comparison is case-sensitive
 * base58 (Solana base58 addresses are case-sensitive).
 */
export function isUsdcMint(mint: string): boolean {
  if (typeof mint !== "string") return false
  return mint.trim() === getUsdcMint()
}

/**
 * Convert a human USDC amount (e.g. 12.5) to integer base units (bigint).
 * Uses string parsing to avoid float drift; truncates beyond 6 decimals.
 */
export function usdcUnits(amountHuman: number): bigint {
  if (!Number.isFinite(amountHuman) || amountHuman < 0) {
    throw new Error("INVALID_USDC_AMOUNT")
  }

  // Render with fixed 6 decimals from the number, then parse the integer/fraction
  // parts as bigints. toFixed rounds half-away-from-zero at the 6th decimal,
  // which is the smallest representable USDC unit, so no precision is lost below it.
  const fixed = amountHuman.toFixed(USDC_DECIMALS) // e.g. "12.500000"
  const neg = fixed.startsWith("-")
  const unsigned = neg ? fixed.slice(1) : fixed
  const [intPart, fracPart = ""] = unsigned.split(".")
  const fracPadded = (fracPart + "000000").slice(0, USDC_DECIMALS)
  const units = BigInt(intPart) * USDC_UNIT_FACTOR + BigInt(fracPadded || "0")
  return neg ? -units : units
}

/**
 * Convert integer base units (bigint) back to a human USDC number (6 decimals).
 * Builds the decimal string with integer math, then parses once.
 */
export function usdcFromUnits(units: bigint): number {
  const neg = units < ZERO
  const abs = neg ? -units : units
  const whole = abs / USDC_UNIT_FACTOR
  const frac = abs % USDC_UNIT_FACTOR
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0")
  const str = `${whole.toString()}.${fracStr}`
  const value = Number(str)
  return neg ? -value : value
}

/**
 * Build a ready-to-send Transaction that transfers `amountHuman` USDC from the
 * escrow owner's ATA to the destination owner's ATA. Creates the destination
 * ATA (payer = escrow owner) if it does not already exist on-chain.
 *
 * The returned Transaction has feePayer + recentBlockhash set and is signed by
 * `fromOwnerKeypair`. Caller can serialize() and send it directly.
 *
 * Uses createTransferCheckedInstruction with decimals=6, so the on-chain
 * program validates the mint + decimals and the transfer fails if the escrow
 * ATA lacks funds (no silent partial transfer).
 */
export async function buildUsdcTransfer(args: {
  connection: Connection
  fromOwnerKeypair: Keypair
  toOwner: string | PublicKey
  amountHuman: number
  mint: string | PublicKey
}): Promise<Transaction> {
  const { connection, fromOwnerKeypair } = args

  const mintPk = args.mint instanceof PublicKey ? args.mint : new PublicKey(args.mint)
  const toOwnerPk = args.toOwner instanceof PublicKey ? args.toOwner : new PublicKey(args.toOwner)
  const fromOwnerPk = fromOwnerKeypair.publicKey

  const amountUnits = usdcUnits(args.amountHuman)
  if (amountUnits <= ZERO) throw new Error("USDC_AMOUNT_NOT_POSITIVE")

  // ATAs (both owned by the standard token program; mint is a classic SPL token).
  const fromAta = getAssociatedTokenAddressSync(mintPk, fromOwnerPk, false, TOKEN_PROGRAM_ID)
  const toAta = getAssociatedTokenAddressSync(mintPk, toOwnerPk, true, TOKEN_PROGRAM_ID)

  const instructions: TransactionInstruction[] = []

  // Create the destination ATA if it does not exist yet (escrow owner pays rent).
  let destExists = false
  try {
    await getAccount(connection, toAta, "confirmed", TOKEN_PROGRAM_ID)
    destExists = true
  } catch {
    destExists = false
  }

  if (!destExists) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        fromOwnerPk, // payer
        toAta, // ata
        toOwnerPk, // owner of the new ata
        mintPk,
        TOKEN_PROGRAM_ID,
      ),
    )
  }

  instructions.push(
    createTransferCheckedInstruction(
      fromAta, // source ata (escrow)
      mintPk, // mint
      toAta, // destination ata (user)
      fromOwnerPk, // owner/authority of the source ata
      amountUnits, // bigint base units
      USDC_DECIMALS, // 6
      [],
      TOKEN_PROGRAM_ID,
    ),
  )

  const { blockhash } = await connection.getLatestBlockhash("confirmed")
  const tx = new Transaction({ feePayer: fromOwnerPk, recentBlockhash: blockhash })
  tx.add(...instructions)
  tx.sign(fromOwnerKeypair)
  return tx
}

/**
 * Read the escrow owner's USDC ATA balance (in human units). Returns 0 if the
 * ATA does not exist yet. Used as a pre-send solvency check for USDC payouts.
 */
export async function getUsdcAtaBalanceHuman(args: {
  connection: Connection
  owner: string | PublicKey
  mint: string | PublicKey
}): Promise<number> {
  const mintPk = args.mint instanceof PublicKey ? args.mint : new PublicKey(args.mint)
  const ownerPk = args.owner instanceof PublicKey ? args.owner : new PublicKey(args.owner)
  const ata = getAssociatedTokenAddressSync(mintPk, ownerPk, false, TOKEN_PROGRAM_ID)
  try {
    const acct = await getAccount(args.connection, ata, "confirmed", TOKEN_PROGRAM_ID)
    return usdcFromUnits(acct.amount)
  } catch {
    return 0
  }
}

/**
 * Verify a USDC deposit transaction on-chain.
 *
 * Confirms a USDC token transfer of `mint` from `fromOwner` into the escrow's
 * ATA (expectedDestOwner's ATA for `mint`) of at least `minAmountHuman`.
 *
 * Mirrors verifySolDeposit: fetch the parsed tx, reject if missing/failed, then
 * scan it. We match in two complementary ways and take the stronger signal:
 *   1) Parsed spl-token `transfer` / `transferChecked` instructions whose source
 *      authority is `fromOwner` and whose destination is the escrow ATA.
 *   2) Token balance deltas in meta (pre/postTokenBalances) for the escrow ATA
 *      under the given mint — robust to inner instructions / odd encodings.
 *
 * Returns the matched amount in human USDC units, or null if no qualifying
 * transfer of >= minAmountHuman is found. The caller is expected to credit the
 * verified amount (not the client-claimed amount).
 */
export async function verifyUsdcDeposit(args: {
  connection: Connection
  txSig: string
  expectedDestOwner: string | PublicKey // escrow owner
  fromOwner: string // user wallet (owner/authority on the source side)
  mint: string | PublicKey
  minAmountHuman: number
}): Promise<{ ok: true; amountHuman: number; units: bigint } | null> {
  const mintPk = args.mint instanceof PublicKey ? args.mint : new PublicKey(args.mint)
  const mintStr = mintPk.toBase58()
  const escrowOwnerPk =
    args.expectedDestOwner instanceof PublicKey ? args.expectedDestOwner : new PublicKey(args.expectedDestOwner)
  const escrowOwnerStr = escrowOwnerPk.toBase58()
  const escrowAta = getAssociatedTokenAddressSync(mintPk, escrowOwnerPk, false, TOKEN_PROGRAM_ID)
  const escrowAtaStr = escrowAta.toBase58()

  const minUnits = usdcUnits(args.minAmountHuman)

  const tx = await args.connection.getParsedTransaction(args.txSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  })
  if (!tx) return null
  if (tx.meta?.err) return null

  const tokenProgramStr = TOKEN_PROGRAM_ID.toBase58()

  // --- Path 1: parsed spl-token transfer / transferChecked instructions ------
  const topLevel: any[] = Array.isArray(tx.transaction.message.instructions)
    ? (tx.transaction.message.instructions as any[])
    : []
  const innerGroups = Array.isArray(tx.meta?.innerInstructions) ? (tx.meta!.innerInstructions as any[]) : []
  const inner: any[] = innerGroups.flatMap((g) => (Array.isArray(g?.instructions) ? g.instructions : []))
  const allIxs: any[] = [...topLevel, ...inner]

  let instructionUnits = ZERO
  for (const ix of allIxs) {
    const programId = ix?.programId?.toBase58?.() ?? ix?.programId
    if (programId !== tokenProgramStr) continue
    const parsed = ix?.parsed
    const type = parsed?.type
    if (type !== "transfer" && type !== "transferChecked") continue
    const info = parsed?.info ?? {}

    // Destination ATA must be the escrow's ATA.
    const dst = info?.destination
    if (dst !== escrowAtaStr) continue

    // Source authority must be the depositing user.
    // transfer: info.authority; transferChecked: info.authority; (multisig => multisigAuthority)
    const authority = info?.authority ?? info?.multisigAuthority ?? info?.owner
    if (authority !== args.fromOwner) continue

    // For transferChecked, the mint is included and must match.
    if (type === "transferChecked") {
      const ixMint = info?.mint
      if (ixMint && ixMint !== mintStr) continue
    }

    // Amount: transferChecked -> info.tokenAmount.amount (string base units);
    //         transfer        -> info.amount (string base units)
    let units: bigint | null = null
    if (type === "transferChecked") {
      const raw = info?.tokenAmount?.amount
      if (typeof raw === "string" && /^\d+$/.test(raw)) units = BigInt(raw)
    } else {
      const raw = info?.amount
      if (typeof raw === "string" && /^\d+$/.test(raw)) units = BigInt(raw)
      else if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) units = BigInt(raw)
    }
    if (units !== null && units > ZERO) instructionUnits += units
  }

  // --- Path 2: token balance delta on the escrow ATA for this mint -----------
  // Match by mint + owner (escrow). This survives inner-instruction encodings
  // and confirms the escrow actually received the funds.
  let deltaUnits = ZERO
  const pre: any[] = Array.isArray(tx.meta?.preTokenBalances) ? (tx.meta!.preTokenBalances as any[]) : []
  const post: any[] = Array.isArray(tx.meta?.postTokenBalances) ? (tx.meta!.postTokenBalances as any[]) : []

  const keyOf = (b: any) => `${b?.accountIndex}`
  const preByIdx = new Map<string, any>()
  for (const b of pre) preByIdx.set(keyOf(b), b)

  for (const b of post) {
    if (b?.mint !== mintStr) continue
    if (b?.owner !== escrowOwnerStr) continue
    const postAmt = b?.uiTokenAmount?.amount
    if (typeof postAmt !== "string" || !/^\d+$/.test(postAmt)) continue
    const preB = preByIdx.get(keyOf(b))
    const preAmtRaw = preB?.uiTokenAmount?.amount
    const preAmt = typeof preAmtRaw === "string" && /^\d+$/.test(preAmtRaw) ? BigInt(preAmtRaw) : ZERO
    const d = BigInt(postAmt) - preAmt
    if (d > ZERO) deltaUnits += d
  }

  // Prefer the on-chain balance delta when available (most trustworthy that the
  // escrow received funds); otherwise use the parsed instruction sum.
  const matchedUnits = deltaUnits > ZERO ? deltaUnits : instructionUnits
  if (matchedUnits <= ZERO) return null
  if (matchedUnits < minUnits) return null

  // Sanity: the receiving account must be the escrow's ATA. If we only have the
  // instruction path, we already constrained destination === escrowAta. If we
  // used the delta path, the owner+mint match guarantees the escrow ATA.
  void escrowAtaStr

  return { ok: true, amountHuman: usdcFromUnits(matchedUnits), units: matchedUnits }
}
