"use client"

import type { LucideIcon } from "lucide-react"
import { Wallet, Target, Coins, Trophy } from "lucide-react"
import { useReveal } from "./use-reveal"

type Step = {
  icon: LucideIcon
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    icon: Wallet,
    title: "Deposit SOL or USDC",
    body: "Connect a Solana wallet and fund your balance. Non-custodial — you stay in control of your keys.",
  },
  {
    icon: Target,
    title: "Pick a KOL outcome",
    body: "Choose a trader and a market — like “finishes Top 10 by daily PnL.” Browse live odds across timeframes.",
  },
  {
    icon: Coins,
    title: "Bet YES or NO",
    body: "Stake into the parimutuel pool. Your share scales with the size of your position and the crowd.",
  },
  {
    icon: Trophy,
    title: "Winners split the pool",
    body: "When the round settles on-chain, the winning side splits the entire pool. Payouts land instantly.",
  },
]

export function HowItWorks() {
  const reveal = useReveal<HTMLDivElement>()

  return (
    <section id="how-it-works" className="ncc-section scroll-mt-20">
      <div className="ncc-shell" ref={reveal}>
        <div className="ncc-reveal mx-auto max-w-2xl text-center">
          <span className="ncc-eyebrow justify-center">How it works</span>
          <h2 className="ncc-h2 mt-4">Four steps to your first payout</h2>
          <p className="ncc-lede mx-auto mt-4 max-w-xl">
            No order books to learn. Bet into a shared pool — if you&apos;re right, you split the winnings.
          </p>
        </div>

        <ol className="ncc-reveal mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon
            return (
              <li key={step.title} className="ncc-glass ncc-card relative flex flex-col p-6">
                <span
                  className="absolute right-5 top-5 font-mono text-[44px] font-extrabold leading-none text-[var(--ncc-green)] opacity-10"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ncc-line-strong)] bg-[var(--ncc-green-dim)] text-[var(--ncc-green)]">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-base font-bold text-[var(--ncc-ink)]">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ncc-muted)]">{step.body}</p>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
