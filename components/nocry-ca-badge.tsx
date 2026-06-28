"use client"

import { useState } from "react"
import { Copy, Check, Sparkles } from "lucide-react"

export const NOCRY_CA = process.env.NEXT_PUBLIC_NOCRY_MINT || "EgP5Ls7G91nYRhAnEC4vNk2C7FMuB6pjYq38Bh1zpump"

/**
 * Minimal click-to-copy $NOCRY contract-address chip.
 * Holding >= 10,000 $NOCRY waives all platform fees.
 */
export function NocryCaBadge({ className, full = false }: { className?: string; full?: boolean }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(NOCRY_CA)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const label = full ? NOCRY_CA : `${NOCRY_CA.slice(0, 4)}…${NOCRY_CA.slice(-4)}`

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy $NOCRY contract address. Hold 10,000 or more $NOCRY for zero platform fees."
      title="Copy $NOCRY contract — hold 10,000+ $NOCRY for zero platform fees"
      className={
        "group inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
        (className ?? "")
      }
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-semibold">$NOCRY</span>
      <span className="tabular-nums text-primary/80 group-hover:text-primary">{label}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-400" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100" aria-hidden />
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  )
}
