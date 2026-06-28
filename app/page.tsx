import type { Metadata } from "next"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { AsciiSpaceBackground } from "@/components/ascii-space-background"
import { PnlTicker } from "@/components/landing/pnl-ticker"
import { SiteHero } from "@/components/landing/site-hero"
import { MarketsStrip } from "@/components/landing/markets-strip"
import { HowItWorks } from "@/components/landing/how-it-works"
import { LeaderboardTeaser } from "@/components/landing/leaderboard-teaser"
import { NocrySection } from "@/components/landing/nocry-section"
import { CtaBand } from "@/components/landing/cta-band"

export const metadata: Metadata = {
  title: "No Cry Casino — KOL Prediction Markets",
  description:
    "Bet on the best Solana traders. Real markets, real payouts. Stake SOL or USDC on whether a KOL finishes Top-N — winners split the pool.",
  alternates: { canonical: "/" },
}

export default function HomePage() {
  return (
    <div className="ncc-site relative min-h-screen overflow-x-hidden bg-black">
      {/* Preserved ASCII-shader animated background */}
      <AsciiSpaceBackground />

      {/* Readability scrim over the shader so dense content stays legible */}
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-black/55 via-black/35 to-black/80"
        aria-hidden
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <Header />
        <PnlTicker />

        <main className="flex-1">
          <SiteHero />
          <MarketsStrip />

          <div className="ncc-shell">
            <div className="ncc-divider" />
          </div>

          <HowItWorks />

          <div className="ncc-shell">
            <div className="ncc-divider" />
          </div>

          <LeaderboardTeaser />
          <NocrySection />
          <CtaBand />
        </main>

        <Footer />
      </div>
    </div>
  )
}
