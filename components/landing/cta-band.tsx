"use client"

import Link from "next/link"
import { ArrowRight, BarChart3 } from "lucide-react"
import { useReveal } from "./use-reveal"

export function CtaBand() {
  const reveal = useReveal<HTMLDivElement>()

  return (
    <section className="ncc-section--tight pb-20">
      <div className="ncc-shell" ref={reveal}>
        <div className="ncc-reveal ncc-glass relative overflow-hidden rounded-3xl border-[var(--ncc-line-strong)] px-6 py-12 text-center sm:px-12 sm:py-16">
          <div
            className="pointer-events-none absolute inset-x-0 -top-1/2 h-[160%] bg-[radial-gradient(ellipse_at_center,var(--ncc-green-dim),transparent_60%)] opacity-60"
            aria-hidden
          />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-[clamp(26px,4.5vw,44px)] font-extrabold leading-[1.05] tracking-[-0.02em]">
              <span className="text-[var(--ncc-ink)]">Ready to call the </span>
              <span className="ncc-grad">winners?</span>
            </h2>
            <p className="ncc-lede mx-auto mt-4 max-w-lg">
              Fund a wallet, pick an outcome, and bet into the pool. Settlement is on-chain — payouts are instant.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/pm" className="ncc-btn ncc-btn-primary w-full sm:w-auto">
                Launch App
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/leaderboard" className="ncc-btn ncc-btn-ghost w-full sm:w-auto">
                <BarChart3 className="h-4 w-4" aria-hidden />
                See the leaderboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
