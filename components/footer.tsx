"use client"

import Link from "next/link"
import { Send, Twitter, Globe } from "lucide-react"
import { NocryCaBadge } from "@/components/nocry-ca-badge"

const NAV: { href: string; label: string }[] = [
  { href: "/pm", label: "Markets" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#nocry", label: "$NOCRY" },
]

const SOCIALS: { href: string; label: string; icon: typeof Send }[] = [
  { href: "#", label: "Twitter / X", icon: Twitter },
  { href: "#", label: "Telegram", icon: Send },
  { href: "#", label: "Website", icon: Globe },
]

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative border-t border-[var(--ncc-line)] bg-black/40 backdrop-blur-sm">
      <div className="ncc-shell py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <Link href="/" className="inline-flex items-center gap-2" aria-label="No Cry Casino home">
              <span className="ncc-nav-diamond" aria-hidden>
                ◆
              </span>
              <span className="ncc-brandmark">
                NO CRY <b>CASINO</b>
              </span>
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--ncc-muted)]">
              Bet on the best Solana traders. Real markets, real payouts — settled on-chain.
            </p>
            <div className="mt-5">
              <NocryCaBadge full className="max-w-full" />
            </div>
          </div>

          {/* Nav */}
          <nav aria-label="Footer">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ncc-faint)]">
              Explore
            </h2>
            <ul className="mt-4 space-y-3">
              {NAV.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-[var(--ncc-muted)] transition-colors hover:text-[var(--ncc-green)] focus-visible:outline-none focus-visible:text-[var(--ncc-green)]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Community */}
          <div>
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ncc-faint)]">
              Community
            </h2>
            <div className="mt-4 flex items-center gap-2.5">
              {SOCIALS.map((s) => {
                const Icon = s.icon
                return (
                  <a
                    key={s.label}
                    href={s.href}
                    aria-label={s.label}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--ncc-line)] bg-[var(--ncc-green-dim)] text-[var(--ncc-muted)] transition-colors hover:border-[var(--ncc-line-strong)] hover:text-[var(--ncc-green)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ncc-green)]"
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </a>
                )
              })}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[var(--ncc-faint)]">Social links coming soon.</p>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-[var(--ncc-line)] pt-6 text-xs text-[var(--ncc-faint)] sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} No Cry Casino. All rights reserved.</p>
          <p className="text-[var(--ncc-muted)]">Crypto only. Not available where prohibited.</p>
        </div>
      </div>
    </footer>
  )
}
