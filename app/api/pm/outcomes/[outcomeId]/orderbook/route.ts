import { NextResponse } from "next/server"

export const runtime = "nodejs"

// CLOB retired in favour of the parimutuel pool engine. There is no order book.
// Read live pools via GET /api/pm/rounds/[roundId] (pm_round_outcomes).
function retired() {
  return NextResponse.json(
    { error: "Endpoint retired: the market is now parimutuel. Use /api/pm/bets/place." },
    { status: 410 },
  )
}

export async function GET() {
  return retired()
}

export async function POST() {
  return retired()
}

export async function PUT() {
  return retired()
}

export async function PATCH() {
  return retired()
}

export async function DELETE() {
  return retired()
}
