"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import {
  ArrowLeft,
  RefreshCw,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  TrendingUp,
  TrendingDown,
  Trophy,
  Clock,
  Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PmShell } from "@/components/pm/pm-shell"
import { DepositDialog } from "@/components/pm/deposit-dialog"
import { WithdrawDialog } from "@/components/pm/withdraw-dialog"
import { KolAvatar } from "@/components/pm/pm-ui"
import { usePmState } from "@/components/pm/use-pm-state"
import { usePmPortfolio, type EnrichedBet } from "@/components/pm/use-pm-portfolio"
import { formatAmount, formatCompact, mintLabel, shortAddress, payoutMultiple } from "@/components/pm/pm-client"

type BetTab = "open" | "settled"

export default function PmMePage() {
  const { publicKey, connected } = useWallet()
  const { setVisible } = useWalletModal()
  const { state, loading, refresh } = usePmState()

  const [depositOpen, setDepositOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawMint, setWithdrawMint] = useState<string | undefined>(undefined)
  const [betTab, setBetTab] = useState<BetTab>("open")

  const balances = state?.balances ?? []
  const bets = state?.bets ?? []
  const { enriched } = usePmPortfolio(bets)

  const openBets = useMemo(
    () => enriched.filter((b) => b.status === "ACTIVE" || b.status === "OPEN"),
    [enriched],
  )
  const settledBets = useMemo(
    () => enriched.filter((b) => b.status === "SETTLED" || b.status === "REFUNDED"),
    [enriched],
  )

  // P&L summary across settled bets, plus reserved (in-play) value.
  const pnl = useMemo(() => {
    let staked = 0
    let returned = 0
    let fees = 0
    let wins = 0
    let losses = 0
    for (const b of settledBets) {
      const amt = Number(b.amount)
      const payout = Number(b.payout ?? 0)
      staked += amt
      returned += payout
      fees += Number(b.fee ?? 0)
      if (b.status === "REFUNDED") continue
      if (payout > amt) wins += 1
      else losses += 1
    }
    const realized = returned - staked
    const totalAvailable = balances.reduce((s, b) => s + Number(b.available_collateral), 0)
    const totalReserved = balances.reduce((s, b) => s + Number(b.reserved_collateral), 0)
    const openStaked = openBets.reduce((s, b) => s + Number(b.amount), 0)
    const openValue = openBets.reduce((s, b) => s + (b.currentValue ?? Number(b.amount)), 0)
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0
    return { realized, fees, wins, losses, winRate, totalAvailable, totalReserved, openStaked, openValue, staked }
  }, [settledBets, openBets, balances])

  const primaryMint = balances[0]?.mint
  const currency = mintLabel(primaryMint)

  return (
    <PmShell maxWidth="6xl">
      <Link href="/pm" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to markets
      </Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="pm-kicker">No Cry Casino</span>
          <h1 className="pm-display mt-1 text-3xl text-foreground">Portfolio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {connected && publicKey
              ? `Trading account · ${shortAddress(publicKey.toBase58())}`
              : "Your balances, positions, and P&L."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!connected ? (
            <button
              type="button"
              onClick={() => setVisible(true)}
              className="pm-btn-green inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm"
            >
              <Wallet className="h-4 w-4" /> Connect wallet
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setDepositOpen(true)}
                className="pm-btn-green inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm"
              >
                <ArrowDownToLine className="h-4 w-4" /> Deposit
              </button>
              <button
                type="button"
                onClick={() => {
                  setWithdrawMint(undefined)
                  setWithdrawOpen(true)
                }}
                className="pm-btn-green-outline inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm"
              >
                <ArrowUpFromLine className="h-4 w-4" /> Withdraw
              </button>
              <Button onClick={() => refresh()} disabled={loading} variant="ghost" size="icon" title="Refresh">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </>
          )}
        </div>
      </div>

      {!connected ? (
        <Card className="pm-panel py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(57,255,20,0.1)] ring-2 ring-[rgba(57,255,20,0.35)]">
            <Wallet className="h-7 w-7 text-emerald-400" />
          </div>
          <h3 className="pm-display text-lg text-foreground">Connect your wallet</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Connect a Solana wallet to view your trading balance, open positions, and settled P&L.
          </p>
          <button
            type="button"
            onClick={() => setVisible(true)}
            className="pm-btn-green mx-auto mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm"
          >
            <Wallet className="h-4 w-4" /> Connect wallet
          </button>
        </Card>
      ) : (
        <>
          {/* P&L summary */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard
              label="Available"
              value={`${formatCompact(pnl.totalAvailable)} ${currency}`}
              sub="Ready to bet"
              icon={<Wallet className="h-4 w-4 text-emerald-400" />}
            />
            <SummaryCard
              label="In play"
              value={`${formatCompact(pnl.openValue)} ${currency}`}
              sub={`${openBets.length} open position${openBets.length === 1 ? "" : "s"}`}
              icon={<Clock className="h-4 w-4 text-amber-400" />}
            />
            <SummaryCard
              label="Realized P&L"
              value={`${pnl.realized >= 0 ? "+" : ""}${formatAmount(pnl.realized, 3)} ${currency}`}
              sub={`${pnl.fees > 0 ? `${formatAmount(pnl.fees, 3)} fees · ` : ""}settled`}
              icon={
                pnl.realized >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-400" />
                )
              }
              accent={pnl.realized > 0 ? "emerald" : pnl.realized < 0 ? "red" : "default"}
            />
            <SummaryCard
              label="Win rate"
              value={`${pnl.winRate.toFixed(0)}%`}
              sub={`${pnl.wins}W · ${pnl.losses}L`}
              icon={<Trophy className="h-4 w-4 text-emerald-400" />}
            />
          </div>

          {/* Balances */}
          <section className="mb-8">
            <h2 className="pm-display mb-3 text-lg text-foreground">Balances</h2>
            {balances.length === 0 ? (
              <Card className="pm-panel py-10 text-center">
                <p className="text-sm text-muted-foreground">No balances yet.</p>
                <button
                  type="button"
                  onClick={() => setDepositOpen(true)}
                  className="pm-btn-green mx-auto mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm"
                >
                  <ArrowDownToLine className="h-4 w-4" /> Make your first deposit
                </button>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {balances.map((b) => {
                  const total = Number(b.available_collateral) + Number(b.reserved_collateral)
                  return (
                    <Card key={b.mint} className="pm-panel gap-3 p-5">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(57,255,20,0.12)] text-xs text-emerald-400 ring-1 ring-[rgba(57,255,20,0.35)]">
                            {mintLabel(b.mint).slice(0, 1)}
                          </span>
                          {mintLabel(b.mint)}
                        </span>
                        <span className="pm-chip pm-chip-muted">{formatAmount(total, 3)} total</span>
                      </div>
                      <div>
                        <div className="pm-figure text-2xl text-foreground">{formatAmount(b.available_collateral, 4)}</div>
                        <div className="text-xs text-muted-foreground">
                          Available · Reserved{" "}
                          <span className="tabular-nums">{formatAmount(b.reserved_collateral, 4)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="pm-btn-green-outline inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs"
                          onClick={() => setDepositOpen(true)}
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" /> Deposit
                        </button>
                        <button
                          type="button"
                          className="pm-btn-green-outline inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs"
                          onClick={() => {
                            setWithdrawMint(b.mint)
                            setWithdrawOpen(true)
                          }}
                        >
                          <ArrowUpFromLine className="h-3.5 w-3.5" /> Withdraw
                        </button>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </section>

          {/* Positions */}
          <section className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="pm-display text-lg text-foreground">Positions</h2>
              <div className="inline-flex rounded-lg border border-border/40 bg-card/30 p-0.5">
                {(["open", "settled"] as BetTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setBetTab(t)}
                    className={`rounded-md px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition-all ${
                      betTab === t
                        ? "bg-[rgba(57,255,20,0.14)] text-emerald-300 [text-shadow:0_0_8px_rgba(57,255,20,0.4)]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "open" ? `Open (${openBets.length})` : `Settled (${settledBets.length})`}
                  </button>
                ))}
              </div>
            </div>

            {loading && bets.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="pm-skeleton h-20 rounded-xl" />
                ))}
              </div>
            ) : betTab === "open" ? (
              openBets.length === 0 ? (
                <EmptyPositions
                  title="No open positions"
                  body="Browse open markets and place a bet to build your book."
                />
              ) : (
                <div className="space-y-2.5">
                  {openBets.map((b) => (
                    <OpenBetRow key={b.bet_id} bet={b} />
                  ))}
                </div>
              )
            ) : settledBets.length === 0 ? (
              <EmptyPositions title="No settled positions yet" body="Your resolved bets and payouts will appear here." />
            ) : (
              <div className="space-y-2.5">
                {settledBets.map((b) => (
                  <SettledBetRow key={b.bet_id} bet={b} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <DepositDialog open={depositOpen} onOpenChange={setDepositOpen} onDeposited={() => refresh({ silent: true })} />
      <WithdrawDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        balances={balances}
        initialMint={withdrawMint}
        onWithdrawn={() => refresh({ silent: true })}
      />
    </PmShell>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
  accent = "default",
}: {
  label: string
  value: string
  sub: string
  icon: React.ReactNode
  accent?: "default" | "emerald" | "red"
}) {
  const valueColor =
    accent === "emerald" ? "text-emerald-400 pm-figure-glow" : accent === "red" ? "text-red-400" : "text-foreground"
  return (
    <Card className="pm-panel gap-2 p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`pm-figure text-xl ${valueColor}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </Card>
  )
}

function BetHeader({ bet }: { bet: EnrichedBet }) {
  const name = bet.kolName ?? (bet.outcome_id ? `Outcome ${shortAddress(bet.outcome_id)}` : "Outcome")
  const href = `/pm/outcomes/${encodeURIComponent(bet.outcome_id)}${
    bet.round_id ? `?round=${encodeURIComponent(bet.round_id)}` : ""
  }`
  return (
    <div className="flex min-w-0 items-center gap-3">
      <KolAvatar src={null} name={name} size={36} className="h-9 w-9" ring />
      <div className="min-w-0">
        <Link href={href} className="block truncate font-semibold leading-tight hover:text-emerald-400">
          {name}
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              bet.sideLabel === "YES" ? "bg-[rgba(57,255,20,0.15)] text-emerald-400" : "bg-red-500/15 text-red-400"
            }`}
          >
            {bet.sideLabel}
          </span>
          {bet.marketType && <span>{bet.marketType}</span>}
          <span className="tabular-nums">
            {formatAmount(bet.amount, 3)} {mintLabel(bet.mint)}
          </span>
        </div>
      </div>
    </div>
  )
}

function OpenBetRow({ bet }: { bet: EnrichedBet }) {
  const value = bet.currentValue ?? Number(bet.amount)
  const pnl = value - Number(bet.amount)
  const up = pnl >= 0
  return (
    <Card className="pm-panel pm-card-hover flex-row items-center justify-between gap-3 p-3.5">
      <BetHeader bet={bet} />
      <div className="flex shrink-0 items-center gap-4 text-right">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Est. value</div>
          <div className="font-semibold tabular-nums">
            {formatAmount(value, 3)} {mintLabel(bet.mint)}
          </div>
        </div>
        <div className="hidden sm:block">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Return</div>
          <div className={`font-semibold tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
            {up ? "+" : ""}
            {formatAmount(pnl, 3)} ({payoutMultiple(Number(bet.amount), value)})
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-400">
          {bet.lockTs ? <Clock className="h-3 w-3" /> : <Lock className="h-3 w-3" />} In play
        </span>
      </div>
    </Card>
  )
}

function SettledBetRow({ bet }: { bet: EnrichedBet }) {
  const refunded = bet.status === "REFUNDED"
  const payout = Number(bet.payout ?? 0)
  const won = !refunded && payout > Number(bet.amount)
  const net = payout - Number(bet.amount)

  const verdict = refunded ? "REFUNDED" : won ? "WON" : "LOST"
  const verdictStyle = refunded
    ? "bg-muted text-muted-foreground"
    : won
      ? "bg-[rgba(57,255,20,0.16)] text-emerald-300 [text-shadow:0_0_10px_rgba(57,255,20,0.45)]"
      : "bg-red-500/15 text-red-400"

  return (
    <Card className="pm-panel pm-card-hover flex-row items-center justify-between gap-3 p-3.5">
      <BetHeader bet={bet} />
      <div className="flex shrink-0 items-center gap-4 text-right">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Payout</div>
          <div className="font-semibold tabular-nums">
            {formatAmount(payout, 3)} {mintLabel(bet.mint)}
          </div>
          {Number(bet.fee ?? 0) > 0 && (
            <div className="text-[10px] text-muted-foreground tabular-nums">fee {formatAmount(bet.fee, 3)}</div>
          )}
        </div>
        {!refunded && (
          <div className="hidden sm:block">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Net</div>
            <div className={`font-semibold tabular-nums ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {net >= 0 ? "+" : ""}
              {formatAmount(net, 3)}
            </div>
          </div>
        )}
        <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-bold ${verdictStyle}`}>
          {verdict}
        </span>
      </div>
    </Card>
  )
}

function EmptyPositions({ title, body }: { title: string; body: string }) {
  return (
    <Card className="pm-panel py-10 text-center">
      <h3 className="pm-display text-base text-foreground">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">{body}</p>
      <Link
        href="/pm"
        className="pm-btn-green mx-auto mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm"
      >
        <TrendingUp className="h-4 w-4" /> Browse markets
      </Link>
    </Card>
  )
}
