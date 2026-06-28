"use client"

import Link from "next/link"
import { ArrowRight, BarChart3, ShieldCheck, Zap } from "lucide-react"

const STATS: { label: string; value: string }[] = [
  { label: "Settlement", value: "On-chain" },
  { label: "Collateral", value: "SOL · USDC" },
  { label: "Holder fee", value: "0%" },
]

/**
 * Primary landing hero — clear value prop, CTAs to the app + leaderboard,
 * and a compact trust strip. Sits above the preserved ASCII-shader background.
 */
export function SiteHero() {
  return (
    <section className="ncc-section ncc-section--tight pt-10 md:pt-16">
      <div className="ncc-shell">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 flex justify-center">
            <span className="ncc-pill ncc-pill-live">
              <span className="ncc-dot ncc-dot-live" aria-hidden />
              Live markets on Solana
            </span>
          </div>

          <h1 className="text-balance text-[clamp(34px,7vw,72px)] font-extrabold leading-[1.02] tracking-[-0.02em]">
            <span className="ncc-grad">Bet on the best</span>
            <br />
            <span className="text-[var(--ncc-ink)]">Solana traders.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-[clamp(15px,1.7vw,19px)] leading-relaxed text-[var(--ncc-muted)]">
            Real markets, real payouts. Stake SOL or USDC on whether a KOL finishes Top-N — winners split the pool.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/pm" className="ncc-btn ncc-btn-primary w-full sm:w-auto" aria-label="Launch the prediction markets app">
              Launch App
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/leaderboard"
              className="ncc-btn ncc-btn-ghost w-full sm:w-auto"
              aria-label="View the KOL leaderboard"
            >
              <BarChart3 className="h-4 w-4" aria-hidden />
              Leaderboard
            </Link>
          </div>

          {/* Trust strip */}
          <dl className="mx-auto mt-12 grid max-w-lg grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--ncc-line)] bg-[var(--ncc-line)]">
            {STATS.map((s) => (
              <div key={s.label} className="bg-[var(--ncc-glass)] px-3 py-4 backdrop-blur-sm">
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ncc-faint)]">{s.label}</dt>
                <dd className="ncc-num mt-1 text-sm font-bold text-[var(--ncc-ink)] sm:text-base">{s.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-[var(--ncc-faint)]">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--ncc-green-soft)]" aria-hidden />
              Non-custodial wallet
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-[var(--ncc-green-soft)]" aria-hidden />
              Instant on-chain payouts
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
