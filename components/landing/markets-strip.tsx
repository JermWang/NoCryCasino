"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowUpRight, Clock, TrendingUp, Users } from "lucide-react"
import { useReveal } from "./use-reveal"

type RoundLite = {
  round_id: string
  market_type?: string
  lock_ts?: string
  collateral_mint?: string | null
  status?: string
}

type OutcomeLite = {
  outcome_id: string
  round_id?: string
  question_text?: string
  kol_wallet_address?: string
  yes_prob?: number | null
  total_pool?: number | null
  yes_bettor_count?: number | null
  no_bettor_count?: number | null
  kols?: { display_name?: string | null } | null
}

type MarketCard = {
  key: string
  roundId: string
  marketType: string
  currency: string
  title: string
  yesPct: number
  pool: number
  bettors: number
  lockTs?: string
}

function mintLabel(mint?: string | null): string {
  if (!mint) return "SOL"
  const m = mint.trim().toUpperCase()
  if (m === "SOL") return "SOL"
  return "USDC"
}

function shortAddr(addr?: string): string {
  if (!addr) return "KOL"
  if (addr.length <= 8) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

function fmtPool(n: number, currency: string): string {
  if (!Number.isFinite(n) || n <= 0) return `0 ${currency}`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K ${currency}`
  return `${n.toFixed(n < 10 ? 2 : 0)} ${currency}`
}

function lockLabel(iso?: string): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const diff = t - Date.now()
  if (diff <= 0) return "Locked"
  const totalMin = Math.floor(diff / 60000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** Seeded teaser markets shown when there are no open rounds (or fetch fails). */
const TEASERS: MarketCard[] = [
  { key: "t1", roundId: "", marketType: "DAILY", currency: "SOL", title: "Finishes Top 10 by daily PnL", yesPct: 64, pool: 128.4, bettors: 212, lockTs: undefined },
  { key: "t2", roundId: "", marketType: "WEEKLY", currency: "SOL", title: "Finishes Top 3 this week", yesPct: 41, pool: 86.2, bettors: 147, lockTs: undefined },
  { key: "t3", roundId: "", marketType: "DAILY", currency: "USDC", title: "Top 5 trader by realized gains", yesPct: 73, pool: 4200, bettors: 318, lockTs: undefined },
  { key: "t4", roundId: "", marketType: "MONTHLY", currency: "SOL", title: "Finishes Top 1 — trader of the month", yesPct: 29, pool: 540.7, bettors: 402, lockTs: undefined },
]

function SkeletonCard() {
  return (
    <div className="ncc-glass ncc-card flex h-[176px] flex-col justify-between p-5">
      <div className="space-y-3">
        <div className="ncc-skel h-5 w-16" />
        <div className="ncc-skel h-4 w-4/5" />
        <div className="ncc-skel h-4 w-3/5" />
      </div>
      <div className="space-y-2">
        <div className="ncc-skel h-1.5 w-full" />
        <div className="ncc-skel h-3 w-2/5" />
      </div>
    </div>
  )
}

function Card({ m, teaser }: { m: MarketCard; teaser: boolean }) {
  const noPct = 100 - m.yesPct
  const href = m.roundId ? `/pm/rounds/${encodeURIComponent(m.roundId)}` : "/pm"
  const lock = lockLabel(m.lockTs)

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="ncc-pill">{m.marketType}</span>
          <span className="ncc-pill">{m.currency}</span>
          {teaser ? <span className="ncc-pill text-[var(--ncc-faint)]">PREVIEW</span> : null}
        </div>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--ncc-faint)] transition-colors group-hover:text-[var(--ncc-green)]" aria-hidden />
      </div>

      <h3 className="mt-3 line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--ncc-ink)]">{m.title}</h3>

      <div className="mt-auto pt-4">
        <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold">
          <span className="text-[var(--ncc-green)]">YES {m.yesPct}%</span>
          <span className="text-[#e08e8e]">NO {noPct}%</span>
        </div>
        <div className="ncc-prob" role="img" aria-label={`Implied odds: yes ${m.yesPct} percent, no ${noPct} percent`}>
          <span style={{ width: `${m.yesPct}%` }} />
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--ncc-faint)]">
          <span className="ncc-num inline-flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            {fmtPool(m.pool, m.currency)} pool
          </span>
          {lock ? (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {lock}
            </span>
          ) : (
            <span className="ncc-num inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {m.bettors}
            </span>
          )}
        </div>
      </div>
    </>
  )

  return (
    <Link
      href={href}
      className="ncc-glass ncc-card group flex h-[176px] flex-col p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ncc-green)]"
      aria-label={`${m.title} — open market, yes ${m.yesPct} percent`}
    >
      {body}
    </Link>
  )
}

export function MarketsStrip() {
  const reveal = useReveal<HTMLDivElement>()
  const [cards, setCards] = useState<MarketCard[] | null>(null)
  const [isTeaser, setIsTeaser] = useState(false)

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        const res = await fetch("/api/pm/rounds?status=OPEN", { cache: "no-store" })
        const json = (await res.json().catch(() => null)) as { rounds?: RoundLite[] } | null
        const rounds = Array.isArray(json?.rounds) ? json!.rounds! : []

        if (rounds.length === 0) {
          if (alive) {
            setCards(TEASERS)
            setIsTeaser(true)
          }
          return
        }

        // Enrich the first few rounds with real outcomes (KOL questions + odds).
        const top = rounds.slice(0, 4)
        const detailed = await Promise.all(
          top.map(async (r) => {
            try {
              const dr = await fetch(`/api/pm/rounds/${encodeURIComponent(r.round_id)}`, { cache: "no-store" })
              const dj = (await dr.json().catch(() => null)) as { outcomes?: OutcomeLite[] } | null
              const outcomes = Array.isArray(dj?.outcomes) ? dj!.outcomes! : []
              return { round: r, outcomes }
            } catch {
              return { round: r, outcomes: [] as OutcomeLite[] }
            }
          }),
        )

        const out: MarketCard[] = []
        for (const { round, outcomes } of detailed) {
          const currency = mintLabel(round.collateral_mint)
          // Best outcome = highest total pool, fall back to first.
          const sorted = [...outcomes].sort((a, b) => (Number(b.total_pool) || 0) - (Number(a.total_pool) || 0))
          const pick = sorted[0]
          if (pick) {
            const name =
              (pick.kols?.display_name && pick.kols.display_name.trim()) || shortAddr(pick.kol_wallet_address)
            const yesProb = Number(pick.yes_prob)
            const yesPct = Number.isFinite(yesProb) ? Math.round(Math.min(99, Math.max(1, yesProb * 100))) : 50
            const pool = Number(pick.total_pool) || 0
            const bettors = (Number(pick.yes_bettor_count) || 0) + (Number(pick.no_bettor_count) || 0)
            const title = pick.question_text?.trim()
              ? pick.question_text.trim()
              : `${name} — KOL performance`
            out.push({
              key: pick.outcome_id,
              roundId: round.round_id,
              marketType: round.market_type ?? "DAILY",
              currency,
              title,
              yesPct,
              pool,
              bettors,
              lockTs: round.lock_ts,
            })
          } else {
            out.push({
              key: round.round_id,
              roundId: round.round_id,
              marketType: round.market_type ?? "DAILY",
              currency,
              title: "KOL performance round",
              yesPct: 50,
              pool: 0,
              bettors: 0,
              lockTs: round.lock_ts,
            })
          }
        }

        if (alive) {
          if (out.length > 0) {
            setCards(out)
            setIsTeaser(false)
          } else {
            setCards(TEASERS)
            setIsTeaser(true)
          }
        }
      } catch {
        if (alive) {
          setCards(TEASERS)
          setIsTeaser(true)
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
    <section className="ncc-section--tight pb-4">
      <div className="ncc-shell" ref={reveal}>
        <div className="ncc-reveal mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="ncc-eyebrow">{isTeaser ? "Markets preview" : "Live now"}</span>
            <h2 className="ncc-h2 mt-3">Open markets</h2>
          </div>
          <Link
            href="/pm"
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--ncc-green-soft)] transition-colors hover:text-[var(--ncc-green)]"
          >
            View all markets
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
          </Link>
        </div>

        <div className="ncc-reveal grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards === null
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            : cards.map((m) => <Card key={m.key} m={m} teaser={isTeaser} />)}
        </div>

        {isTeaser && cards !== null ? (
          <p className="ncc-reveal mt-5 text-center text-xs text-[var(--ncc-faint)]">
            Preview odds shown — open the app for live rounds and real-time pools.
          </p>
        ) : null}
      </div>
    </section>
  )
}
