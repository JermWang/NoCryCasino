"use client"

import { useState } from "react"
import { Copy, Check, Sparkles } from "lucide-react"

export const NOCRY_CA = process.env.NEXT_PUBLIC_NOCRY_MINT || "EgP5Ls7G91nYRhAnEC4vNk2C7FMuB6pjYq38Bh1zpump"

/** Shared clipboard hook: copies the $NOCRY mint and flips a 1.5s "copied" flag. */
export function useCopyCa(value: string = NOCRY_CA) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return { copied, copy }
}

/**
 * Prominent click-to-copy $NOCRY contract-address chip.
 * Holding >= 10,000 $NOCRY waives all platform fees.
 */
export function NocryCaBadge({ className, full = false }: { className?: string; full?: boolean }) {
  const { copied, copy } = useCopyCa()

  const label = full ? NOCRY_CA : `${NOCRY_CA.slice(0, 4)}…${NOCRY_CA.slice(-4)}`

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy $NOCRY contract address. Hold 10,000 or more $NOCRY for zero platform fees."
      title="Copy $NOCRY contract address — hold 10,000+ $NOCRY for zero platform fees"
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

/**
 * Large, hero-grade click-to-copy contract-address block for the landing
 * $NOCRY section. The entire block is one big copy target.
 */
export function NocryCaBlock({ className }: { className?: string }) {
  const { copied, copy } = useCopyCa()

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy the $NOCRY contract address to your clipboard"
      className={
        "group ncc-ca-copy block w-full rounded-2xl border border-[var(--ncc-line-strong)] bg-black/40 p-4 text-left transition-colors hover:border-[var(--ncc-green-soft)] hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ncc-green)] sm:p-5 " +
        (className ?? "")
      }
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--ncc-faint)]">
          Contract address
        </span>
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] font-semibold transition-colors " +
            (copied ? "bg-[var(--ncc-green-dim)] text-[var(--ncc-green)]" : "text-[var(--ncc-muted)] group-hover:text-[var(--ncc-green)]")
          }
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Copied!" : "Click to copy"}
        </span>
      </div>
      <code className="block text-[13px] leading-relaxed text-[var(--ncc-ink)] sm:text-[15px] md:text-base">
        {NOCRY_CA}
      </code>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Contract address copied to clipboard" : ""}
      </span>
    </button>
  )
}
