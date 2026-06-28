"use client"

import { useEffect, useMemo, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { toast } from "sonner"
import {
  TrendingUp,
  Clock,
  Users,
  Plus,
  ChevronRight,
  Flame,
  Trophy,
  Calendar,
  Search,
  X,
  ArrowUpDown,
  BarChart3,
  Wallet,
  Trophy as TrophyIcon,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react"
import Link from "next/link"
import { PmShell } from "@/components/pm/pm-shell"
import { MarketCard, MarketCardSkeleton } from "@/components/pm/market-card"
import { usePmRounds } from "@/components/pm/use-pm-rounds"
import { PoolBar } from "@/components/pm/pool-bar"
import { KolAvatar } from "@/components/pm/pm-ui"
import {
  base64FromBytes,
  buildPmMessage,
  formatCompact,
  impliedYesPct,
  makeNonce,
  mintLabel,
  isPastLock,
  shortAddress,
} from "@/components/pm/pm-client"
import type { MarketType, RoundSummary } from "@/components/pm/types"

type ViewTab = "markets" | "community"
type Category = "all" | "crypto" | "sports" | "politics" | "entertainment" | "other"
type SortKey = "volume" | "ending" | "bettors" | "newest"
type TypeFilter = "ALL" | MarketType

type UserPrediction = {
  prediction_id: string
  creator_wallet: string
  question: string
  category: string
  end_date: string
  status: string
  total_volume: number
  yes_pool: number
  no_pool: number
  created_at: string
}

function formatTimeLeft(endDate: string): string {
  const end = new Date(endDate).getTime()
  const now = Date.now()
  const diff = end - now
  if (diff <= 0) return "Ended"
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h left`
  return "< 1h left"
}

function getYesPercent(yes: number, no: number): number {
  const total = yes + no
  if (total === 0) return 50
  return Math.round((yes / total) * 100)
}

const CATEGORIES: { value: Category; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "All", icon: <Flame className="h-4 w-4" /> },
  { value: "crypto", label: "Crypto", icon: <TrendingUp className="h-4 w-4" /> },
  { value: "sports", label: "Sports", icon: <Trophy className="h-4 w-4" /> },
  { value: "politics", label: "Politics", icon: <Users className="h-4 w-4" /> },
  { value: "entertainment", label: "Entertainment", icon: <Calendar className="h-4 w-4" /> },
  { value: "other", label: "Other", icon: <Clock className="h-4 w-4" /> },
]

const SORTS: { value: SortKey; label: string }[] = [
  { value: "volume", label: "Top volume" },
  { value: "ending", label: "Ending soon" },
  { value: "bettors", label: "Most bettors" },
  { value: "newest", label: "Newest" },
]

export default function PredictionMarketsPage() {
  const { publicKey, connected, signMessage } = useWallet()
  const { setVisible } = useWalletModal()

  const [viewTab, setViewTab] = useState<ViewTab>("markets")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL")
  const [sortKey, setSortKey] = useState<SortKey>("volume")
  const [category, setCategory] = useState<Category>("all")
  const [searchQuery, setSearchQuery] = useState("")

  // Seed the search from a ?q= param (e.g. "Find markets for this KOL" links).
  useEffect(() => {
    if (typeof window === "undefined") return
    const q = new URLSearchParams(window.location.search).get("q")
    if (q) setSearchQuery(q)
  }, [])

  // KOL parimutuel rounds (hydrated with pool aggregates).
  const { rounds, loading, hydrating, error, reload } = usePmRounds("OPEN")

  // Community predictions.
  const [predLoading, setPredLoading] = useState(false)
  const [predError, setPredError] = useState<string | null>(null)
  const [predictions, setPredictions] = useState<UserPrediction[]>([])

  // Create prediction modal.
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newQuestion, setNewQuestion] = useState("")
  const [newCategory, setNewCategory] = useState<Category>("crypto")
  const [newEndDate, setNewEndDate] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (viewTab !== "community") return
    let mounted = true
    async function run() {
      setPredLoading(true)
      setPredError(null)
      try {
        const params = new URLSearchParams()
        if (category !== "all") params.set("category", category)
        params.set("status", "approved")
        params.set("limit", "100")
        const res = await fetch(`/api/pm/predictions?${params.toString()}`)
        const json = (await res.json().catch(() => null)) as any
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load predictions")
        if (!mounted) return
        setPredictions(Array.isArray(json?.predictions) ? (json.predictions as UserPrediction[]) : [])
      } catch (e: any) {
        if (!mounted) return
        setPredError(e?.message ?? String(e))
        setPredictions([])
      } finally {
        if (mounted) setPredLoading(false)
      }
    }
    run()
    return () => {
      mounted = false
    }
  }, [category, viewTab])

  async function handleCreatePrediction() {
    if (!publicKey || !connected) {
      setVisible(true)
      toast.info("Connect your wallet", { description: "Connect a wallet to create a prediction." })
      return
    }
    if (!signMessage) {
      toast.error("Wallet unsupported", { description: "Your wallet doesn't support message signing." })
      return
    }
    if (!newQuestion.trim() || newQuestion.trim().length < 10) {
      toast.error("Invalid question", { description: "Question must be at least 10 characters." })
      return
    }
    if (!newEndDate) {
      toast.error("Missing end date", { description: "Please select when this prediction ends." })
      return
    }

    setSubmitting(true)
    try {
      const wallet_address = publicKey.toBase58()
      const issued_at = new Date().toISOString()
      const nonce = makeNonce()
      const end_date = new Date(newEndDate).toISOString()

      const message = buildPmMessage("NoCryCasino PM Prediction v1", {
        wallet_address,
        question: newQuestion.trim(),
        category: newCategory,
        end_date,
        nonce,
        issued_at,
      })

      const sigBytes = await signMessage(new TextEncoder().encode(message))
      const signature_base64 = base64FromBytes(sigBytes)

      const res = await fetch("/api/pm/predictions/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet_address,
          question: newQuestion.trim(),
          category: newCategory,
          end_date,
          nonce,
          issued_at,
          signature_base64,
          message,
        }),
      })

      const json = (await res.json().catch(() => null)) as any
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to create prediction")

      toast.success("Prediction submitted!", { description: "Your prediction is pending review." })
      setShowCreateModal(false)
      setNewQuestion("")
      setNewCategory("crypto")
      setNewEndDate("")
    } catch (e: any) {
      toast.error("Failed to create", { description: e?.message ?? String(e) })
    } finally {
      setSubmitting(false)
    }
  }

  // Filter + sort the hydrated rounds.
  const visibleRounds = useMemo(() => {
    let list = rounds.slice()
    if (typeFilter !== "ALL") list = list.filter((r) => r.market_type === typeFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((r) => {
        if (r.round_id.toLowerCase().includes(q)) return true
        return r.outcomes.some(
          (o) =>
            (o.kols?.display_name ?? "").toLowerCase().includes(q) ||
            (o.kols?.twitter_handle ?? "").toLowerCase().includes(q) ||
            o.kol_wallet_address.toLowerCase().includes(q) ||
            (o.question_text ?? "").toLowerCase().includes(q),
        )
      })
    }
    list.sort((a, b) => {
      switch (sortKey) {
        case "volume":
          return b.totalPool - a.totalPool
        case "bettors":
          return b.bettorCount - a.bettorCount
        case "ending":
          return new Date(a.lock_ts).getTime() - new Date(b.lock_ts).getTime()
        case "newest":
          return new Date(b.start_ts).getTime() - new Date(a.start_ts).getTime()
        default:
          return 0
      }
    })
    return list
  }, [rounds, typeFilter, sortKey, searchQuery])

  // Aggregate market stats for the hero strip.
  const stats = useMemo(() => {
    const open = rounds.filter((r) => r.status === "OPEN" && !isPastLock(r.lock_ts))
    const totalVolume = rounds.reduce((s, r) => s + r.totalPool, 0)
    const totalBettors = rounds.reduce((s, r) => s + r.bettorCount, 0)
    const currency = rounds[0] ? mintLabel(rounds[0].collateral_mint) : "SOL"
    return { openCount: open.length, totalVolume, totalBettors, currency }
  }, [rounds])

  // Top KOL outcomes across all rounds — the banner's "TOP MARKETS" leaderboard.
  const topMarkets = useMemo(() => {
    type Row = {
      round: RoundSummary
      outcomeId: string
      name: string
      avatar: string | null
      pct: number
      total: number
    }
    const rows: Row[] = []
    for (const r of rounds) {
      for (const o of r.outcomes) {
        const total = Number(o.total_pool ?? 0)
        if (total <= 0) continue
        const name =
          o.kols?.display_name && o.kols.display_name.length > 0
            ? o.kols.display_name
            : shortAddress(o.kol_wallet_address)
        rows.push({
          round: r,
          outcomeId: o.outcome_id,
          name,
          avatar: o.kols?.avatar_url ?? null,
          pct: impliedYesPct(o.yes_pool, o.no_pool, o.yes_prob),
          total,
        })
      }
    }
    rows.sort((a, b) => b.total - a.total)
    return rows.slice(0, 5)
  }, [rounds])

  const filteredPredictions = predictions.filter((p) => {
    if (!searchQuery.trim()) return true
    return p.question.toLowerCase().includes(searchQuery.toLowerCase())
  })

  return (
    <PmShell>
      {/* Hero */}
      <section className="pm-panel mb-8 overflow-hidden">
        <div className="relative flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2">
              <span className="pm-live-dot" aria-hidden />
              <span className="pm-kicker">No Cry Casino · Prediction Markets</span>
            </div>
            <h1 className="pm-display text-4xl text-foreground sm:text-5xl">
              Predict the top KOLs. <span className="pm-glow-strong">Win big.</span>
            </h1>
            <p className="mt-3 max-w-xl text-base text-muted-foreground">
              Parimutuel pools on the best Solana KOLs. Stake YES or NO — winners split both pools.
              Real markets, live odds, trustless payouts.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="pm-btn-green group inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.6)]"
              >
                <Plus className="h-4 w-4" /> Create Market
              </button>
              <Link
                href="/leaderboard"
                className="pm-btn-green-outline inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.5)]"
              >
                <TrophyIcon className="h-4 w-4" /> Leaderboard
              </Link>
              <Link
                href="/pm/me"
                className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm transition-colors hover:border-[rgba(57,255,20,0.4)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.5)]"
              >
                <Wallet className="h-4 w-4" /> Portfolio
              </Link>
            </div>
          </div>

          {/* Top markets snapshot (banner "TOP MARKETS" leaderboard) */}
          <div className="w-full shrink-0 lg:w-80">
            <TopMarketsPanel rows={topMarkets} loading={loading} />
          </div>
        </div>

        {/* Stats strip */}
        {viewTab === "markets" && (
          <div className="grid grid-cols-3 gap-px border-t border-[var(--pm-line)] bg-[var(--pm-line)]">
            <StatStrip
              icon={<Flame className="h-4 w-4 text-emerald-400" />}
              label="Open markets"
              value={loading ? "—" : String(stats.openCount)}
            />
            <StatStrip
              icon={<BarChart3 className="h-4 w-4 text-emerald-400" />}
              label="Total volume"
              value={loading ? "—" : `${formatCompact(stats.totalVolume)} ${stats.currency}`}
            />
            <StatStrip
              icon={<Users className="h-4 w-4 text-emerald-400" />}
              label="Total bettors"
              value={loading ? "—" : String(stats.totalBettors)}
            />
          </div>
        )}
      </section>

      {/* Tabs + search */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-xl border border-border/40 bg-card/30 p-1 backdrop-blur-sm">
          {(["markets", "community"] as ViewTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setViewTab(t)}
              className={`rounded-lg px-5 py-2.5 text-sm font-bold uppercase tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.5)] ${
                viewTab === t
                  ? "pm-btn-green"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "markets" ? "KOL Markets" : "Community"}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            aria-label={viewTab === "markets" ? "Search KOLs and markets" : "Search predictions"}
            placeholder={viewTab === "markets" ? "Search KOLs, markets…" : "Search predictions…"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pm-input h-10 pl-10 pr-4 text-sm sm:w-72"
          />
        </div>
      </div>

      {/* Sub-filters */}
      {viewTab === "markets" ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {(["ALL", "DAILY", "WEEKLY", "MONTHLY"] as TypeFilter[]).map((mt) => (
            <button
              key={mt}
              type="button"
              onClick={() => setTypeFilter(mt)}
              className={`rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.5)] ${
                typeFilter === mt
                  ? "border border-[rgba(57,255,20,0.4)] bg-[rgba(57,255,20,0.1)] text-emerald-400 [text-shadow:0_0_10px_rgba(57,255,20,0.4)]"
                  : "border border-border/40 text-muted-foreground hover:border-[rgba(57,255,20,0.3)] hover:text-foreground"
              }`}
            >
              {mt === "ALL" ? "All types" : mt.charAt(0) + mt.slice(1).toLowerCase()}
            </button>
          ))}

          <div className="mx-1 h-6 w-px bg-border/40" />

          {/* Sort */}
          <div className="relative inline-flex items-center">
            <ArrowUpDown className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sort markets"
              className="pm-input h-9 cursor-pointer appearance-none pl-8 pr-8 text-sm font-semibold"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronRight className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 rotate-90 text-muted-foreground" />
          </div>

          {hydrating && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
              Updating odds…
            </span>
          )}
        </div>
      ) : (
        <div className="mb-6 flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setCategory(cat.value)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.5)] ${
                category === cat.value
                  ? "border border-[rgba(57,255,20,0.4)] bg-[rgba(57,255,20,0.1)] text-emerald-400"
                  : "border border-border/40 text-muted-foreground hover:border-[rgba(57,255,20,0.3)] hover:text-foreground"
              }`}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Section header */}
      <div className="mb-4 flex items-center gap-2">
        <Flame className="h-5 w-5 text-emerald-400" />
        <h2 className="pm-display text-lg text-foreground">
          {viewTab === "markets" ? "Top Markets" : "Community Predictions"}
        </h2>
      </div>

      {/* Content */}
      {viewTab === "markets" ? (
        loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <MarketCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : visibleRounds.length === 0 ? (
          <EmptyState
            title={searchQuery ? "No markets match your search" : "No open markets right now"}
            body={
              searchQuery
                ? "Try a different KOL name or clear the search."
                : "Rounds open automatically when KOL lineups are bootstrapped. Check back soon."
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleRounds.map((r) => (
              <MarketCard key={r.round_id} round={r} />
            ))}
          </div>
        )
      ) : predLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      ) : predError ? (
        <ErrorState message={predError} />
      ) : filteredPredictions.length === 0 ? (
        <EmptyState
          title="No community predictions yet"
          body="Be the first to create a prediction for the community."
          action={
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="pm-btn-green inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm"
            >
              <Plus className="h-4 w-4" /> Create Prediction
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredPredictions.map((p) => {
            const yesPercent = getYesPercent(p.yes_pool, p.no_pool)
            return (
              <div
                key={p.prediction_id}
                className="pm-panel pm-card-hover group p-5"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="pm-chip">{p.category}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> {formatTimeLeft(p.end_date)}
                  </span>
                </div>
                <h3 className="mb-3 line-clamp-3 text-sm font-semibold leading-tight">{p.question}</h3>
                <PoolBar yesPool={p.yes_pool} noPool={p.no_pool} />
                <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-emerald-400">{yesPercent}% YES</span>
                  <span className="tabular-nums">{formatCompact(p.total_volume)} vol</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Prediction Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <div className="pm-panel relative w-full max-w-lg p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              aria-label="Close"
              className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mb-6">
              <h2 className="pm-display text-xl text-foreground">Create a Market</h2>
              <p className="mt-1 text-sm text-muted-foreground">Submit a yes/no question for the community to bet on.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Question</label>
                <textarea
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="Will Bitcoin reach $100,000 by end of 2025?"
                  rows={3}
                  className="pm-input resize-none px-4 py-3 text-sm"
                />
                <div className="mt-1 text-right text-xs text-muted-foreground">{newQuestion.length}/500</div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Category</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.filter((c) => c.value !== "all").map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setNewCategory(cat.value as Category)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition-all ${
                        newCategory === cat.value
                          ? "border border-[rgba(57,255,20,0.4)] bg-[rgba(57,255,20,0.1)] text-emerald-400"
                          : "border border-border/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {cat.icon}
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-muted-foreground">Resolution Date</label>
                <input
                  type="datetime-local"
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                  min={new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)}
                  max={new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)}
                  className="pm-input px-4 py-3 text-sm"
                />
              </div>

              <div className="pt-2">
                {!connected ? (
                  <button
                    type="button"
                    onClick={() => setVisible(true)}
                    className="pm-btn-green w-full rounded-xl py-3 text-sm"
                  >
                    Connect Wallet to Submit
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCreatePrediction}
                    disabled={submitting || !newQuestion.trim() || !newEndDate}
                    className="pm-btn-green w-full rounded-xl py-3 text-sm"
                  >
                    {submitting ? "Submitting…" : "Submit Prediction"}
                  </button>
                )}
              </div>

              <p className="text-center text-xs text-muted-foreground">
                Predictions are reviewed before going live. Clear, verifiable questions are more likely to be approved.
              </p>
            </div>
          </div>
        </div>
      )}
    </PmShell>
  )
}

/** The banner's "TOP MARKETS" leaderboard: avatar · KOL name · big green % + trend arrow. */
function TopMarketsPanel({
  rows,
  loading,
}: {
  rows: { round: RoundSummary; outcomeId: string; name: string; avatar: string | null; pct: number; total: number }[]
  loading: boolean
}) {
  return (
    <div className="rounded-xl border border-[var(--pm-line)] bg-[rgba(4,8,6,0.55)] p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="pm-kicker">Top Markets</span>
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="pm-live-dot" aria-hidden /> Live
        </span>
      </div>
      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="pm-skeleton h-9 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">No live markets yet — be the first to set a line.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r, i) => {
            const up = r.pct >= 50
            return (
              <li key={r.outcomeId}>
                <Link
                  href={`/pm/rounds/${encodeURIComponent(r.round.round_id)}`}
                  className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-[rgba(57,255,20,0.06)]"
                >
                  <span className="w-4 shrink-0 text-center text-xs font-bold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <KolAvatar src={r.avatar} name={r.name} size={28} className="h-7 w-7" ring />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground group-hover:text-emerald-400">
                    {r.name}
                  </span>
                  <span
                    className={`inline-flex items-center gap-0.5 text-sm font-bold tabular-nums ${
                      up ? "pm-figure-glow text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {r.pct}%
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function StatStrip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 bg-[rgba(4,8,6,0.6)] px-4 py-4 backdrop-blur-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(57,255,20,0.1)]">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="pm-figure truncate text-lg text-foreground">{value}</div>
      </div>
    </div>
  )
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="pm-panel p-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(57,255,20,0.1)]">
        <TrendingUp className="h-6 w-6 text-emerald-400" />
      </div>
      <h3 className="pm-display text-lg text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center">
      <p className="text-red-400">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg border border-border/50 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/40"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}
