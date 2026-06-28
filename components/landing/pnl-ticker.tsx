"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

/**
 * Scrolling daily-PnL ticker. Pulls the live leaderboard and renders a seamless
 * marquee. Width-aware: repeats the row enough times to fill ultrawide viewports.
 * Falls back to a quiet placeholder when data is unavailable.
 */
export function PnlTicker() {
  const [items, setItems] = useState<string[]>(["LOADING DAILY KOL PNL"])
  const [repeat, setRepeat] = useState(1)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true

    const formatSol = (v: number) => {
      const sign = v > 0 ? "+" : v < 0 ? "−" : ""
      return `${sign}${Math.abs(v).toFixed(2)} SOL`
    }

    const load = async () => {
      try {
        const res = await fetch("/api/analytics/leaderboard?timeframe=daily&eligibility=0", { cache: "no-store" })
        const json = (await res.json().catch(() => null)) as { rows?: unknown[] } | null
        const rows = Array.isArray(json?.rows) ? json!.rows! : []

        const mapped = rows
          .slice(0, 30)
          .map((r) => {
            const o = r as Record<string, unknown>
            const name =
              (typeof o.display_name === "string" && o.display_name.trim()) ||
              (typeof o.wallet_address === "string" ? o.wallet_address.slice(0, 6) : "KOL")
            const profit = Number(o.profit_sol)
            return `${name} ${Number.isFinite(profit) ? formatSol(profit) : "0.00 SOL"}`
          })
          .filter((s) => s.length > 0)

        if (alive) setItems(mapped.length > 0 ? mapped : ["NO DAILY DATA YET"])
      } catch {
        if (alive) setItems(["NO DAILY DATA YET"])
      }
    }

    void load()
    const t = window.setInterval(load, 300_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

  const baseItems = useMemo(() => (items.length > 0 ? items : ["NO DAILY DATA YET"]), [items])

  const rowItems = useMemo(() => {
    const out: string[] = []
    const reps = Math.max(1, Math.min(50, Math.floor(repeat)))
    for (let i = 0; i < reps; i += 1) out.push(...baseItems)
    return out.length > 0 ? out : ["NO DAILY DATA YET"]
  }, [baseItems, repeat])

  useLayoutEffect(() => {
    const container = containerRef.current
    const row = rowRef.current
    if (!container || !row) return

    let raf = 0

    const compute = () => {
      const c = container.getBoundingClientRect().width
      const r = row.getBoundingClientRect().width
      if (!Number.isFinite(c) || !Number.isFinite(r) || c <= 0 || r <= 0) return

      const unitWidth = r / Math.max(1, repeat)
      if (!Number.isFinite(unitWidth) || unitWidth <= 0) return

      const next = Math.max(1, Math.min(50, Math.ceil((c * 2) / unitWidth)))
      if (next !== repeat) setRepeat(next)
    }

    const schedule = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(compute)
    }

    schedule()

    const ro = new ResizeObserver(schedule)
    ro.observe(container)
    ro.observe(row)

    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts
    if (fonts?.ready && typeof fonts.ready.then === "function") {
      fonts.ready.then(schedule).catch(() => null)
    }

    window.addEventListener("load", schedule)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener("load", schedule)
    }
  }, [baseItems, repeat])

  return (
    <div className="ncc-ticker" ref={containerRef} aria-label="Live daily KOL profit and loss">
      <div className="ncc-ticker-track">
        <div className="ncc-ticker-row" ref={rowRef}>
          {rowItems.map((t, i) => (
            <span key={`a-${i}`} className="ncc-ticker-item">
              ◆ {t} ◆
            </span>
          ))}
        </div>
        <div className="ncc-ticker-row" aria-hidden="true">
          {rowItems.map((t, i) => (
            <span key={`b-${i}`} className="ncc-ticker-item">
              ◆ {t} ◆
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
