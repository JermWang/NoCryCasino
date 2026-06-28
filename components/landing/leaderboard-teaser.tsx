"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowUpRight, Crown, Medal, Trophy } from "lucide-react"
import { useReveal } from "./use-reveal"

type Row = {
  rank: number
  name: string
  handle: string | null
  profitSol: number
}

function rankIcon(rank: number) {
  if (rank === 1) return <Crown className="h-4 w-4 text-[#ffd66b]" aria-hidden />
  if (rank === 2) return <Medal className="h-4 w-4 text-[#cdd5da]" aria-hidden />
  if (rank === 3) return <Medal className="h-4 w-4 text-[#d8a06b]" aria-hidden />
  return <span className="ncc-num text-xs font-bold text-[var(--ncc-faint)]">{rank}</span>
}

function fmtSol(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : ""
  return `${sign}${Math.abs(v).toFixed(2)} SOL`
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="ncc-skel h-5 w-5 rounded-full" />
      <div className="ncc-skel h-4 w-32 flex-1" />
      <div className="ncc-skel h-4 w-20" />
    </div>
  )
}

export function LeaderboardTeaser() {
  const reveal = useReveal<HTMLDivElement>()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        const res = await fetch("/api/analytics/leaderboard?timeframe=daily&eligibility=0", { cache: "no-store" })
        const json = (await res.json().catch(() => null)) as { rows?: unknown[] } | null
        const raw = Array.isArray(json?.rows) ? json!.rows! : []

        const mapped: Row[] = raw.slice(0, 5).map((r, i) => {
          const o = r as Record<string, unknown>
          const name =
            (typeof o.display_name === "string" && o.display_name.trim()) ||
            (typeof o.wallet_address === "string" ? `${o.wallet_address.slice(0, 4)}…${o.wallet_address.slice(-4)}` : "KOL")
          const handle = typeof o.twitter_handle === "string" && o.twitter_handle.trim() ? o.twitter_handle.trim() : null
          const profit = Number(o.profit_sol)
          return {
            rank: i + 1,
            name,
            handle,
            profitSol: Number.isFinite(profit) ? profit : 0,
          }
        })

        if (alive) {
          setRows(mapped)
          setErrored(false)
        }
      } catch {
        if (alive) {
          setRows([])
          setErrored(true)
        }
      }
    }

    void load()
    const t = window.setInterval(load, 120_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

  return (
    <section className="ncc-section">
      <div className="ncc-shell" ref={reveal}>
        <div className="ncc-reveal grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          {/* Copy */}
          <div>
            <span className="ncc-eyebrow">Leaderboard</span>
            <h2 className="ncc-h2 mt-4">The traders worth betting on</h2>
            <p className="ncc-lede mt-4 max-w-md">
              Track every KOL&apos;s real PnL — daily, weekly and monthly. The leaderboard is the signal behind every
              market.
            </p>
            <Link href="/leaderboard" className="ncc-btn ncc-btn-ghost ncc-btn-sm mt-7 inline-flex">
              <Trophy className="h-4 w-4" aria-hidden />
              Full leaderboard
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          {/* Top 5 list */}
          <div className="ncc-glass overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--ncc-line)] px-4 py-3">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ncc-faint)]">
                Top traders · 24h
              </span>
              <span className="ncc-pill ncc-pill-live h-5 px-2 text-[10px]">
                <span className="ncc-dot ncc-dot-live" aria-hidden />
                Live
              </span>
            </div>

            <div className="divide-y divide-[var(--ncc-line)]">
              {rows === null ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
              ) : rows.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--ncc-muted)]">
                  {errored ? "Leaderboard is taking a breather — check back shortly." : "No ranked traders yet today."}
                </div>
              ) : (
                rows.map((r) => {
                  const up = r.profitSol > 0
                  const down = r.profitSol < 0
                  return (
                    <Link
                      key={`${r.rank}-${r.name}`}
                      href="/leaderboard"
                      className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-[var(--ncc-green-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ncc-green)] focus-visible:ring-inset"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center">{rankIcon(r.rank)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--ncc-ink)]">{r.name}</div>
                        {r.handle ? (
                          <div className="truncate text-[11px] text-[var(--ncc-faint)]">@{r.handle.replace(/^@/, "")}</div>
                        ) : null}
                      </div>
                      <span
                        className={
                          "ncc-num text-sm font-bold " +
                          (up ? "text-[var(--ncc-green)]" : down ? "text-[#e08e8e]" : "text-[var(--ncc-muted)]")
                        }
                      >
                        {fmtSol(r.profitSol)}
                      </span>
                    </Link>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
