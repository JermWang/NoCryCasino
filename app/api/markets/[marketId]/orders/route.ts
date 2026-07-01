import { NextResponse, type NextRequest } from "next/server"

export const runtime = "nodejs"

// RETIRED. This endpoint belonged to the legacy CLOB/escrow "markets" engine,
// which is superseded by the solvent parimutuel engine under /api/pm/* (bets,
// rounds, settlement). It took real SOL into per-market escrow that the automated
// cron never settles or refunds, so it is disabled to prevent stranded funds and
// user confusion. Front-end "Markets" now routes to the parimutuel product at /pm.
//
// Mirrors the retired pm/orders CLOB routes (HTTP 410 Gone) rather than deleting the
// file so old clients/links get a clear, stable signal instead of a 404.
const GONE = {
  ok: false,
  error: "This market/order endpoint has been retired. Use the parimutuel markets at /pm.",
} as const

export async function GET(_request: NextRequest) {
  return NextResponse.json(GONE, { status: 410 })
}

export async function POST(_request: NextRequest) {
  return NextResponse.json(GONE, { status: 410 })
}
