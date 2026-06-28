"use client"

import { BadgePercent, Gift, Sparkles } from "lucide-react"
import { NocryCaBlock } from "@/components/nocry-ca-badge"
import { useReveal } from "./use-reveal"

const BENEFITS: { icon: typeof BadgePercent; title: string; body: string; live: boolean }[] = [
  {
    icon: BadgePercent,
    title: "Hold 10,000+ $NOCRY",
    body: "Zero platform fees on every bet. Keep 100% of your edge.",
    live: true,
  },
  {
    icon: Gift,
    title: "More holder rewards",
    body: "Fee rebates, boosted markets and holder-only rounds — coming soon.",
    live: false,
  },
]

export function NocrySection() {
  const reveal = useReveal<HTMLDivElement>()

  return (
    <section id="nocry" className="ncc-section scroll-mt-20">
      <div className="ncc-shell" ref={reveal}>
        <div className="ncc-reveal ncc-glass ncc-ca-grid relative overflow-hidden rounded-3xl border-[var(--ncc-line-strong)] p-6 sm:p-10 lg:p-12">
          {/* glow accents */}
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[var(--ncc-green)] opacity-[0.08] blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-[var(--ncc-green)] opacity-[0.06] blur-3xl"
            aria-hidden
          />

          <div className="relative grid gap-10 lg:grid-cols-2 lg:items-center">
            {/* Left: identity + CA */}
            <div>
              <span className="ncc-pill ncc-pill-live">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                The token
              </span>
              <h2 className="mt-4 text-[clamp(30px,5vw,52px)] font-extrabold leading-none tracking-[-0.02em]">
                <span className="ncc-grad">$NOCRY</span>
              </h2>
              <p className="ncc-lede mt-4 max-w-md">
                The native token of No Cry Casino. Hold it to unlock fee-free trading and the rewards rolling out next.
              </p>

              <div className="mt-7 max-w-xl">
                <NocryCaBlock />
              </div>
            </div>

            {/* Right: benefits */}
            <div className="grid gap-4">
              {BENEFITS.map((b) => {
                const Icon = b.icon
                return (
                  <div key={b.title} className="ncc-glass-2 flex items-start gap-4 p-5">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ncc-line-strong)] bg-[var(--ncc-green-dim)] text-[var(--ncc-green)]">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[15px] font-bold text-[var(--ncc-ink)]">{b.title}</h3>
                        {b.live ? (
                          <span className="ncc-pill ncc-pill-live h-5 px-2 text-[10px]">
                            <span className="ncc-dot ncc-dot-live" aria-hidden />
                            Active
                          </span>
                        ) : (
                          <span className="ncc-pill h-5 px-2 text-[10px] text-[var(--ncc-faint)]">Soon</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--ncc-muted)]">{b.body}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
