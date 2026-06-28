import type { SupabaseClient } from "@supabase/supabase-js"

export function isPmNonceRequired(): boolean {
  // Secure by default: replay protection is REQUIRED unless explicitly disabled.
  // In any deployed (non-development) environment a missing flag means "on".
  // Set PM_REQUIRE_NONCE=false only for local dev convenience.
  const v = process.env.PM_REQUIRE_NONCE
  if (typeof v === "string") {
    const s = v.trim().toLowerCase()
    if (s === "1" || s === "true" || s === "yes") return true
    if (s === "0" || s === "false" || s === "no") return false
  }
  // Unset: required everywhere except local development.
  return process.env.NODE_ENV !== "development"
}

export async function consumePmNonce(args: {
  supabase: SupabaseClient
  walletAddress: string
  nonce: string
  action: string
  issuedAt: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const issuedAtMs = Date.parse(args.issuedAt)
  if (!Number.isFinite(issuedAtMs)) return { ok: false, status: 400, error: "Invalid issued_at" }

  const { data, error } = await args.supabase.rpc("pm_use_nonce", {
    p_user_pubkey: args.walletAddress,
    p_nonce: args.nonce,
    p_action: args.action,
    p_issued_at: new Date(issuedAtMs).toISOString(),
  })

  if (error) return { ok: false, status: 500, error: error.message }

  if (!data?.ok) {
    const msg = typeof data?.error === "string" && data.error.length > 0 ? data.error : "NONCE_REUSED"
    return { ok: false, status: 409, error: msg }
  }

  return { ok: true }
}
