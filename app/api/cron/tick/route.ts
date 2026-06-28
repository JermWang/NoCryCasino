import { NextResponse, type NextRequest } from "next/server"
import { requireBearerIfConfigured } from "@/lib/api/guards"

// This orchestrator must run on the Node.js runtime (it fans out to other
// serverless functions over HTTP) and must never be statically cached: every
// invocation should do live work.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type StepResult = {
  ok: boolean
  status: number | null
  body: unknown
  error?: string
}

/**
 * Resolve the app's own base URL for server-to-server fan-out.
 *
 * Preference order:
 *   1. NEXT_PUBLIC_APP_URL  (explicit, includes scheme, e.g. https://app.example.com)
 *   2. VERCEL_URL           (host only on Vercel, e.g. my-app.vercel.app -> https://...)
 *   3. The incoming request's own origin (works on any host, incl. localhost)
 */
function resolveBaseUrl(request: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, "")

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) {
    const withScheme = /^https?:\/\//i.test(vercel) ? vercel : `https://${vercel}`
    return withScheme.replace(/\/+$/, "")
  }

  return new URL(request.url).origin
}

/**
 * Authorize the tick. We ALWAYS require CRON_SECRET to be configured (fail
 * closed via requireBearerIfConfigured, which returns 500 when it is unset
 * outside local development). The request is allowed when EITHER:
 *   - it presents a valid `Authorization: Bearer ${CRON_SECRET}` header, OR
 *   - it carries Vercel Cron's `x-vercel-cron` header AND is same-origin.
 *
 * Vercel Cron calls the path with GET and no Authorization header by default,
 * so the `x-vercel-cron` same-origin path lets Vercel's own scheduler through
 * while everyone else must supply the bearer. The CRON_SECRET bearer is always
 * preferred and is the only option for non-Vercel schedulers.
 */
function authorize(request: NextRequest): NextResponse | null {
  const bearerCheck = requireBearerIfConfigured({ request, envVarName: "CRON_SECRET" })
  if (!bearerCheck) return null // valid bearer (or local dev with no secret set)

  // Bearer was missing/invalid (401) or CRON_SECRET unset on a deploy (500).
  // Allow Vercel Cron through only when its header is present AND the request
  // originates from our own host (defense against a spoofed header from afar).
  const isVercelCron = request.headers.get("x-vercel-cron") !== null
  if (isVercelCron && isSameOrigin(request)) return null

  return bearerCheck
}

/** True when the request's Host header matches the URL it was routed to. */
function isSameOrigin(request: NextRequest): boolean {
  try {
    const urlHost = new URL(request.url).host
    const headerHost = request.headers.get("host")
    return !!headerHost && headerHost === urlHost
  } catch {
    return false
  }
}

async function runStep(name: string, baseUrl: string, path: string, adminKey: string | undefined): Promise<StepResult> {
  const url = `${baseUrl}${path}`
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Each downstream admin route authenticates with ADMIN_API_KEY.
        ...(adminKey ? { authorization: `Bearer ${adminKey}` } : {}),
      },
      // All four admin routes accept POST with an optional JSON body and no
      // required fields, so an empty object is the correct sensible default.
      body: JSON.stringify({}),
      cache: "no-store",
    })

    const body = await res.json().catch(async () => {
      // Non-JSON response (unexpected) — fall back to text for diagnostics.
      try {
        return await res.text()
      } catch {
        return null
      }
    })

    if (!res.ok) {
      console.error(`[cron/tick] step "${name}" returned ${res.status}`, body)
      return { ok: false, status: res.status, body }
    }

    return { ok: true, status: res.status, body }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[cron/tick] step "${name}" threw:`, error)
    return { ok: false, status: null, body: null, error }
  }
}

async function tick(request: NextRequest): Promise<NextResponse> {
  const denied = authorize(request)
  if (denied) return denied

  const baseUrl = resolveBaseUrl(request)
  const adminKey = process.env.ADMIN_API_KEY
  if (!adminKey || adminKey.trim().length === 0) {
    // Without ADMIN_API_KEY the downstream calls cannot authenticate, so the
    // tick would silently no-op. Surface it loudly instead.
    console.error("[cron/tick] ADMIN_API_KEY is not set; downstream admin calls will fail")
  }

  // Ordered fan-out. Each sub-call is wrapped so one failure never aborts the
  // rest; downstream routes run as their own serverless functions, so this
  // orchestrator just dispatches and aggregates.
  const steps: Record<string, StepResult> = {}

  steps.lock = await runStep("lock", baseUrl, "/api/admin/pm/rounds/lock", adminKey)
  steps.settle = await runStep("settle", baseUrl, "/api/admin/pm/rounds/settle", adminKey)
  steps.withdrawals = await runStep("withdrawals", baseUrl, "/api/admin/pm/withdrawals/process", adminKey)
  steps.heliusSync = await runStep("heliusSync", baseUrl, "/api/admin/helius/webhook/sync", adminKey)

  // Always return 200 with a per-step summary; individual failures are reported
  // inside `steps` rather than failing the whole tick (so the scheduler does not
  // hammer retries and so a single flaky step does not block the others).
  return NextResponse.json({ ok: true, baseUrl, steps })
}

// Vercel Cron triggers with GET; we also accept POST for manual/external triggers.
export async function GET(request: NextRequest) {
  return tick(request)
}

export async function POST(request: NextRequest) {
  return tick(request)
}
