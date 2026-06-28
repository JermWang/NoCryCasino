"use client"

import type React from "react"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Search,
  Copy,
  Check,
  Trophy,
  Medal,
  TrendingUp,
  TrendingDown,
  Twitter,
  Send,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Crown,
  Users,
  BarChart3,
  Target,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type TimeFrame = "daily" | "weekly" | "monthly"

type KOL = {
  rank: number
  name: string
  avatar: string | null
  wallet: string
  fullWallet: string
  wins: number
  losses: number
  profit: number
  profitUsd: number
  volumeSol: number
  txCount: number
  hasTelegram: boolean
  telegramUrl: string | null
  hasTwitter: boolean
  twitterUrl: string | null
}

function shortWallet(w: string) {
  return w ? `${w.slice(0, 4)}…${w.slice(-4)}` : "—"
}

function formatSol(n: number) {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00"
}

function formatSignedSol(v: number) {
  if (!Number.isFinite(v)) return "0.00"
  const s = v > 0 ? "+" : v < 0 ? "-" : ""
  return `${s}${formatSol(Math.abs(v))}`
}

function formatSignedUsd(v: number, opts: Intl.NumberFormatOptions) {
  if (!Number.isFinite(v)) return "$0.00"
  const sign = v > 0 ? "+" : v < 0 ? "-" : ""
  return `${sign}$${Math.abs(v).toLocaleString("en-US", opts)}`
}

function pnlColor(v: number) {
  if (!Number.isFinite(v) || v === 0) return "text-muted-foreground"
  return v > 0 ? "text-emerald-400" : "text-red-400"
}

function winRate(wins: number, losses: number) {
  const total = wins + losses
  return total > 0 ? (wins / total) * 100 : 0
}

function Avatar({ src, name, size, className }: { src: string | null; name: string; size: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  const initial = name.trim()?.[0]?.toUpperCase() ?? "?"
  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-gradient-to-br from-emerald-500/20 to-teal-500/10 font-bold text-emerald-300 ring-1 ring-border/60",
          className,
        )}
        style={{ height: size, width: size }}
      >
        {initial}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className={cn("object-cover ring-1 ring-border/60", className)}
      style={{ height: size, width: size }}
    />
  )
}

export function KolLeaderboard() {
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("daily")
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null)
  const [selectedKOL, setSelectedKOL] = useState<KOL | null>(null)

  const requestSeq = useRef(0)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const [kols, setKols] = useState<KOL[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    const controller = new AbortController()
    const seq = ++requestSeq.current

    async function run() {
      setLoading(true)
      setError(null)

      const qs = new URLSearchParams()
      qs.set("timeframe", timeFrame)
      qs.set("eligibility", "0")
      qs.set("uiPage", String(page))
      qs.set("uiPageSize", String(pageSize))
      if (debouncedQuery.trim().length > 0) qs.set("q", debouncedQuery.trim())

      const res = await fetch(`/api/analytics/leaderboard?${qs.toString()}`, { signal: controller.signal })

      let json: any = null
      try {
        json = await res.json()
      } catch {
        json = null
      }

      if (!res.ok || !json?.ok) {
        if (controller.signal.aborted || requestSeq.current !== seq) return
        const msg = typeof json?.error === "string" && json.error.length > 0 ? json.error : "Failed to load leaderboard"
        setError(`${msg} (HTTP ${res.status})`)
        setKols([])
        setTotal(0)
        setTotalPages(1)
        setLoading(false)
        return
      }

      const rows = Array.isArray(json?.rows) ? json.rows : []
      const totalRaw = Number(json?.total)
      const totalPagesRaw = Number(json?.totalPages)
      const mapped: KOL[] = rows.map((r: any) => {
        const fullWallet = String(r?.wallet_address ?? "")
        const name =
          typeof r?.display_name === "string" && r.display_name.length > 0
            ? r.display_name
            : fullWallet
              ? shortWallet(fullWallet)
              : "Unknown"
        const profit = Number(r?.profit_sol ?? 0)
        const profitUsd = Number(r?.profit_usd ?? 0)
        const twitterUrl = typeof r?.twitter_url === "string" && r.twitter_url.length > 0 ? r.twitter_url : null
        const telegramUrl = typeof r?.telegram_url === "string" && r.telegram_url.length > 0 ? r.telegram_url : null
        return {
          rank: Number(r?.rank ?? 0) || 0,
          name,
          avatar: typeof r?.avatar_url === "string" ? r.avatar_url : null,
          wallet: fullWallet,
          fullWallet,
          wins: Number(r?.wins ?? 0) || 0,
          losses: Number(r?.losses ?? 0) || 0,
          profit: Number.isFinite(profit) ? profit : 0,
          profitUsd: Number.isFinite(profitUsd) ? profitUsd : 0,
          volumeSol: Number(r?.swap_volume_sol ?? 0) || 0,
          txCount: Number(r?.tx_count ?? 0) || 0,
          hasTelegram: !!telegramUrl,
          telegramUrl,
          hasTwitter:
            (typeof r?.twitter_handle === "string" && r.twitter_handle.length > 0) || !!twitterUrl,
          twitterUrl,
        }
      })

      if (controller.signal.aborted || requestSeq.current !== seq) return
      setKols(mapped)
      setTotal(Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : mapped.length)
      setTotalPages(Number.isFinite(totalPagesRaw) && totalPagesRaw > 0 ? totalPagesRaw : 1)
      setLoading(false)
    }

    run().catch((e: any) => {
      if (controller.signal.aborted || requestSeq.current !== seq) return
      setError(e?.message ? `${e.message}` : String(e))
      setKols([])
      setLoading(false)
    })

    return () => controller.abort()
  }, [timeFrame, page, pageSize, debouncedQuery])

  const copyToClipboard = async (wallet: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(wallet)
    setCopiedWallet(wallet)
    setTimeout(() => setCopiedWallet(null), 2000)
  }

  // Top-3 podium only on the first unfiltered page.
  const showPodium = page === 1 && !debouncedQuery && kols.length >= 3
  const podium = showPodium ? kols.slice(0, 3) : []
  const listKols = showPodium ? kols.slice(3) : kols

  const aggregate = useMemo(() => {
    const traders = kols.length
    const profitable = kols.filter((k) => k.profit > 0).length
    const topProfit = kols.reduce((m, k) => Math.max(m, k.profit), 0)
    return { traders, profitable, topProfit }
  }, [kols])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-emerald-400">
          <Trophy className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-widest">KOL Leaderboard</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">Top Solana Traders</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          The realized-PnL leaderboard that powers our markets. Spot the sharpest KOLs, then bet YES or NO on
          whether they keep winning.
        </p>
      </div>

      {/* Aggregate stats */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard icon={<Users className="h-4 w-4 text-emerald-400" />} label="Ranked traders" value={loading ? "—" : String(aggregate.traders)} />
        <StatCard icon={<Target className="h-4 w-4 text-emerald-400" />} label="In profit" value={loading ? "—" : String(aggregate.profitable)} />
        <StatCard
          icon={<BarChart3 className="h-4 w-4 text-emerald-400" />}
          label={`Top PnL (${timeFrame})`}
          value={loading ? "—" : `${formatSignedSol(aggregate.topProfit)} SOL`}
        />
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or wallet…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setPage(1)
            }}
            className="h-10 w-full rounded-xl border border-border/40 bg-card/40 pl-9 pr-3 text-sm backdrop-blur-sm placeholder:text-muted-foreground focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 md:w-[340px]"
          />
        </div>

        <div className="inline-flex rounded-xl border border-border/40 bg-card/40 p-1 backdrop-blur-sm">
          {(["daily", "weekly", "monthly"] as TimeFrame[]).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => {
                setTimeFrame(tf)
                setPage(1)
              }}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-all",
                timeFrame === tf ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Podium */}
      {!loading && !error && showPodium && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {/* Order visually as 2-1-3 on wide screens for a classic podium feel. */}
          {[podium[1], podium[0], podium[2]].map((k, i) =>
            k ? <PodiumCard key={k.fullWallet} kol={k} highlight={i === 1} onOpen={() => setSelectedKOL(k)} /> : <div key={i} />,
          )}
        </div>
      )}

      {/* Result count */}
      <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {debouncedQuery ? `${total} result${total !== 1 ? "s" : ""}` : `Showing ${kols.length} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs">Rows</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) || 50)
              setPage(1)
            }}
            className="h-8 rounded-lg border border-border/40 bg-card/40 px-2 text-sm focus:border-emerald-500/50 focus:outline-none"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm">
        {/* Column header (desktop) */}
        <div className="hidden items-center gap-4 border-b border-border/40 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:flex">
          <div className="w-10 text-center">#</div>
          <div className="flex-1">Trader</div>
          <div className="w-40">Win rate</div>
          <div className="w-24 text-right">Record</div>
          <div className="w-40 text-right">Realized PnL</div>
          <div className="w-32 text-right">Actions</div>
        </div>

        {loading ? (
          <div className="divide-y divide-border/30">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <div className="h-8 w-8 animate-pulse rounded-full bg-muted/40" />
                <div className="h-10 w-10 animate-pulse rounded-full bg-muted/40" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 animate-pulse rounded bg-muted/40" />
                  <div className="h-2 w-20 animate-pulse rounded bg-muted/30" />
                </div>
                <div className="h-3 w-24 animate-pulse rounded bg-muted/40" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">Failed to load leaderboard: {error}</div>
        ) : total === 0 && !debouncedQuery ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No KOLs are being tracked yet.
          </div>
        ) : listKols.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">No traders match “{searchQuery}”.</div>
        ) : (
          <div className="divide-y divide-border/30">
            {listKols.map((kol) => (
              <LeaderboardRow
                key={kol.fullWallet}
                kol={kol}
                copied={copiedWallet === kol.fullWallet}
                onCopy={(e) => copyToClipboard(kol.fullWallet, e)}
                onOpen={() => setSelectedKOL(kol)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage(1)}>
            First
          </Button>
          <Button variant="outline" size="icon-sm" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="rounded-lg border border-border/40 bg-card/40 px-4 py-1.5 text-sm">
            Page {page} / {totalPages}
          </div>
          <Button variant="outline" size="icon-sm" disabled={loading || page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={loading || page >= totalPages} onClick={() => setPage(totalPages)}>
            Last
          </Button>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selectedKOL} onOpenChange={() => setSelectedKOL(null)}>
        <DialogContent className="max-w-2xl border-border/60 bg-card/95 backdrop-blur-xl">
          {selectedKOL && <KolDetail kol={selectedKOL} timeFrame={timeFrame} copied={copiedWallet === selectedKOL.fullWallet} onCopy={(e) => copyToClipboard(selectedKOL.fullWallet, e)} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ----------------------------- sub-components ----------------------------- */

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/30 px-4 py-3 backdrop-blur-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-lg font-bold tabular-nums">{value}</div>
      </div>
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 text-black shadow-sm">
        <Crown className="h-4 w-4" />
      </span>
    )
  if (rank === 2)
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-300 to-slate-500 text-black">
        <Medal className="h-4 w-4" />
      </span>
    )
  if (rank === 3)
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-700 to-orange-800 text-white">
        <Medal className="h-4 w-4" />
      </span>
    )
  return <span className="flex h-8 w-8 items-center justify-center text-sm font-bold text-muted-foreground">{rank}</span>
}

function PodiumCard({ kol, highlight, onOpen }: { kol: KOL; highlight?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex flex-col items-center rounded-2xl border p-5 text-center backdrop-blur-sm transition-all hover:border-emerald-500/40",
        highlight
          ? "border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-card/40 sm:-translate-y-2"
          : "border-border/50 bg-card/40",
      )}
    >
      <div className="relative">
        <Avatar src={kol.avatar} name={kol.name} size={highlight ? 72 : 60} className="rounded-full" />
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2">
          <RankBadge rank={kol.rank} />
        </span>
      </div>
      <div className="mt-4 flex items-center gap-1.5">
        <span className="font-semibold">{kol.name}</span>
        {kol.hasTwitter && kol.twitterUrl && <Twitter className="h-3.5 w-3.5 text-sky-400" />}
      </div>
      <div className="text-xs text-muted-foreground">{shortWallet(kol.fullWallet)}</div>
      <div className={cn("mt-2 text-xl font-bold tabular-nums", pnlColor(kol.profit))}>
        {formatSignedSol(kol.profit)} SOL
      </div>
      <div className={cn("text-xs tabular-nums", pnlColor(kol.profitUsd))}>
        {formatSignedUsd(kol.profitUsd, { maximumFractionDigits: 0 })}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {kol.wins}W / {kol.losses}L · {winRate(kol.wins, kol.losses).toFixed(0)}% win
      </div>
    </button>
  )
}

function LeaderboardRow({
  kol,
  copied,
  onCopy,
  onOpen,
}: {
  kol: KOL
  copied: boolean
  onCopy: (e: React.MouseEvent) => void
  onOpen: () => void
}) {
  const wr = winRate(kol.wins, kol.losses)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen()
      }}
      className="flex cursor-pointer flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-muted/20 md:flex-row md:items-center md:gap-4"
    >
      {/* Rank + identity */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="w-10 shrink-0 md:flex md:justify-center">
          <RankBadge rank={kol.rank} />
        </div>
        <Avatar src={kol.avatar} name={kol.name} size={40} className="h-10 w-10 shrink-0 rounded-full" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{kol.name}</span>
            {kol.hasTwitter && kol.twitterUrl && (
              <a href={kol.twitterUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Twitter">
                <Twitter className="h-3.5 w-3.5 text-sky-400 transition-opacity hover:opacity-80" />
              </a>
            )}
            {kol.hasTelegram && kol.telegramUrl && (
              <a href={kol.telegramUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Telegram">
                <Send className="h-3.5 w-3.5 text-sky-300 transition-opacity hover:opacity-80" />
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={onCopy}
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            title="Copy wallet"
          >
            {shortWallet(kol.fullWallet)}
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Win rate bar */}
      <div className="w-full md:w-40">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="tabular-nums">{wr.toFixed(0)}% win</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
          <div
            className={cn("h-full rounded-full", wr >= 50 ? "bg-emerald-500" : "bg-amber-500")}
            style={{ width: `${Math.min(100, wr)}%` }}
          />
        </div>
      </div>

      {/* Record */}
      <div className="hidden w-24 text-right text-sm tabular-nums md:block">
        <span className="text-emerald-400">{kol.wins}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-red-400">{kol.losses}</span>
      </div>

      {/* PnL */}
      <div className="w-full text-left md:w-40 md:text-right">
        <div className={cn("flex items-center gap-1 font-bold tabular-nums md:justify-end", pnlColor(kol.profit))}>
          {kol.profit > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : kol.profit < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : null}
          {formatSignedSol(kol.profit)} SOL
        </div>
        <div className={cn("text-xs tabular-nums", pnlColor(kol.profitUsd))}>
          {formatSignedUsd(kol.profitUsd, { maximumFractionDigits: 0 })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex w-full items-center gap-2 md:w-32 md:justify-end" onClick={(e) => e.stopPropagation()}>
        <Link
          href={`/pm?q=${encodeURIComponent(kol.fullWallet)}`}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 md:flex-none"
          title="Find markets for this KOL"
        >
          <Target className="h-3.5 w-3.5" /> Markets
        </Link>
        <Link
          href={`/kol/${encodeURIComponent(kol.fullWallet)}`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-colors hover:text-foreground"
          title="View activity"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

function KolDetail({
  kol,
  timeFrame,
  copied,
  onCopy,
}: {
  kol: KOL
  timeFrame: TimeFrame
  copied: boolean
  onCopy: (e: React.MouseEvent) => void
}) {
  const trades = kol.wins + kol.losses
  const wr = winRate(kol.wins, kol.losses)
  const avg = trades > 0 ? kol.profit / trades : 0
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-4">
          <Avatar src={kol.avatar} name={kol.name} size={56} className="h-14 w-14 rounded-full" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">{kol.name}</span>
              {kol.rank <= 3 && <RankBadge rank={kol.rank} />}
            </div>
            <div className="text-sm font-normal capitalize text-muted-foreground">
              Rank #{kol.rank} · {timeFrame}
            </div>
          </div>
        </DialogTitle>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <DetailStat
            label="Realized PnL"
            value={`${formatSignedSol(kol.profit)} SOL`}
            sub={formatSignedUsd(kol.profitUsd, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            color={pnlColor(kol.profit)}
          />
          <DetailStat label="Win rate" value={`${wr.toFixed(1)}%`} sub={`${kol.wins}W / ${kol.losses}L`} />
          <DetailStat label="Total trades" value={String(trades)} sub={`${kol.txCount} tx`} />
          <DetailStat label="Avg / trade" value={`${formatSignedSol(avg)} SOL`} sub={`${formatSol(kol.volumeSol)} SOL volume`} color={pnlColor(avg)} />
        </div>

        <div className="rounded-xl border border-border/50 bg-background/30 p-4">
          <div className="mb-2 text-xs text-muted-foreground">Wallet address</div>
          <div className="flex items-center justify-between gap-3">
            <code className="break-all font-mono text-xs">{kol.fullWallet}</code>
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted/50"
              title="Copy"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/pm?q=${encodeURIComponent(kol.fullWallet)}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
          >
            <Target className="h-4 w-4" /> Find / create market
          </Link>
          <Link
            href={`/kol/${encodeURIComponent(kol.fullWallet)}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/40"
          >
            <ExternalLink className="h-4 w-4" /> Activity & details
          </Link>
          {kol.twitterUrl && (
            <a
              href={kol.twitterUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/40"
            >
              <Twitter className="h-4 w-4 text-sky-400" /> Twitter
            </a>
          )}
        </div>
      </div>
    </>
  )
}

function DetailStat({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/30 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", color)}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</div>
    </div>
  )
}
