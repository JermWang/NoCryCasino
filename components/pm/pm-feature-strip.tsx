"use client"

import Image from "next/image"
import { BarChart3, Radio, Trophy, ShieldCheck } from "lucide-react"
import solLogo from "@/kolscan-clone/public/images/solana-sol-logo.png"

const FEATURES: { icon: React.ReactNode; label: string }[] = [
  { icon: <BarChart3 className="h-4 w-4" />, label: "Real Markets" },
  { icon: <Radio className="h-4 w-4" />, label: "Live Odds" },
  { icon: <Trophy className="h-4 w-4" />, label: "Big Rewards" },
  { icon: <ShieldCheck className="h-4 w-4" />, label: "Trustless" },
]

/**
 * The banner's footer feature strip:
 * REAL MARKETS · LIVE ODDS · BIG REWARDS · TRUSTLESS · SOLANA NATIVE.
 * Green lucide icons, condensed uppercase labels, with a "Built on Solana"
 * mark closing it out.
 */
export function PmFeatureStrip() {
  return (
    <footer className="pm-feature-strip mt-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-6 sm:flex-row sm:justify-between">
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:justify-start">
          {FEATURES.map((f) => (
            <li key={f.label} className="inline-flex items-center gap-2">
              <span className="pm-glow">{f.icon}</span>
              <span className="pm-display text-xs text-foreground sm:text-[13px]">{f.label}</span>
            </li>
          ))}
          <li className="inline-flex items-center gap-2">
            <Image src={solLogo} alt="" aria-hidden className="h-4 w-4" />
            <span className="pm-display text-xs text-foreground sm:text-[13px]">Solana Native</span>
          </li>
        </ul>

        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Image src={solLogo} alt="Solana" className="h-4 w-4" />
          <span>
            Built on <span className="pm-glow font-semibold">Solana</span>
          </span>
        </div>
      </div>
    </footer>
  )
}
