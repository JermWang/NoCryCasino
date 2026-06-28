import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"

/** Constant-time string comparison that does not early-return on length. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  // timingSafeEqual throws on unequal lengths; burn an equal-length compare and
  // return false so length differences don't create a timing side-channel.
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab)
    return false
  }
  return timingSafeEqual(ab, bb)
}

type RateLimitEntry = { count: number; resetAt: number }

const buckets = new Map<string, RateLimitEntry>()

export function getClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim()
  return request.headers.get("x-real-ip") ?? "unknown"
}

export function rateLimit(args: {
  request: NextRequest
  key: string
  limit: number
  windowMs: number
}): NextResponse | null {
  const now = Date.now()
  const ip = getClientIp(args.request)
  const k = `${args.key}:${ip}`

  const existing = buckets.get(k)
  if (!existing || now >= existing.resetAt) {
    buckets.set(k, { count: 1, resetAt: now + args.windowMs })
    return null
  }

  existing.count += 1
  if (existing.count > args.limit) {
    const retryAfter = Math.max(0, Math.ceil((existing.resetAt - now) / 1000))
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    )
  }

  return null
}

export function enforceMaxBodyBytes(request: NextRequest, maxBytes: number): NextResponse | null {
  const raw = request.headers.get("content-length")
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (n > maxBytes) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }
  return null
}

export function requireBearerIfConfigured(args: {
  request: NextRequest
  envVarName: string
  productionRequired?: boolean
}): NextResponse | null {
  const expectedRaw = process.env[args.envVarName]
  const expected =
    typeof expectedRaw === "string" ? expectedRaw.replace(/[\u0000-\u001F\u007F]/g, "").trim() : expectedRaw

  const prodRequired = args.productionRequired !== false
  // FAIL CLOSED: a protected endpoint with no configured key is only allowed in
  // local development (NODE_ENV === "development"). Every deployed environment
  // (production, preview, staging, test, or unset) returns 500 rather than
  // silently running with no auth. Closes the hole where a deploy not exactly
  // tagged "production" exposed money-moving endpoints openly.
  if (prodRequired && (!expected || expected.length === 0)) {
    if (process.env.NODE_ENV === "development") return null
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  if (!expected) return null

  const auth = args.request.headers.get("authorization")
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const m = auth.match(/^Bearer\s+(.+)$/i)
  const gotRaw = m?.[1] ?? null
  const got = typeof gotRaw === "string" ? gotRaw.replace(/[\u0000-\u001F\u007F]/g, "").trim() : gotRaw
  if (!got || !safeEqual(got, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return null
}
