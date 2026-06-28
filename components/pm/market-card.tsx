"use client"

import Link from "next/link"
import type { RoundSummary } from "./types"
import { formatCompact, impliedYesPct, isPastLock, shortAddress } from "./pm-client"
import { buildSpark } from "./pm-spark"
import { KolNeonAvatar, typeBadgeStyle, lockLabel } from "./market-card-bits"

/**
 * The exact "Market Card" from the No Cry Casino design canvas
 * (design enhancements/Market Card.dc.html), bound to a parimutuel round.
 *
 * The design card is single-KOL: it shows one headline question, the big YES
 * figure, a sparkline, an 8px YES/NO pool bar, and a Vol / bettors footer. We
 * bind the round's most-traded outcome as the headline KOL and fold the round's
 * pool aggregates into the bar + footer. Styling matches the spec pixel-for-
 * pixel (gradient, border, radius, hover lift, type pill, 44px green-radial
 * avatar, Orbitron 800 30px #39FF14 glow figure, sparkline, pool bar, footer).
 */
export function MarketCard({ round }: { round: RoundSummary }) {
  const isOpen = round.status === "OPEN"
  const locked = isPastLock(round.lock_ts)
  const top = round.topOutcome

  const kolName =
    top?.kols?.display_name && top.kols.display_name.length > 0
      ? top.kols.display_name
      : top
        ? shortAddress(top.kol_wallet_address)
        : "KOL Round"
  const kolHandle =
    top?.kols?.twitter_handle && top.kols.twitter_handle.length > 0
      ? `@${top.kols.twitter_handle}`
      : top
        ? shortAddress(top.kol_wallet_address)
        : `${round.outcomeCount} markets`

  const question =
    top?.question_text && top.question_text.length > 0
      ? top.question_text
      : top
        ? `Will ${kolName} finish on top?`
        : `${round.market_type.charAt(0)}${round.market_type.slice(1).toLowerCase()} KOL performance round`

  const yesPct =
    round.avgYesProb != null
      ? Math.round(round.avgYesProb * 100)
      : top
        ? impliedYesPct(top.yes_pool, top.no_pool, top.yes_prob)
        : 50
  const noPct = 100 - yesPct

  // Decimal YES payout multiplier: total / yes share (design: total/p.yes).
  const total = round.totalPool
  const yesShare = round.yesPool > 0 ? round.yesPool : total > 0 ? total : 1
  const mult = total > 0 ? total / yesShare : 1
  const multLabel = `×${mult.toFixed(2)}`

  const spark = buildSpark(round.round_id, yesPct)
  const sparkColor = spark.trendUp ? "#39FF14" : "#FF5E5E"

  const urgent = !locked && timeLeftMinutes(round.lock_ts) <= 60
  const lock = lockLabel(round.lock_ts, locked, !isOpen)

  const tb = typeBadgeStyle(round.market_type)

  return (
    <Link
      href={`/pm/rounds/${encodeURIComponent(round.round_id)}`}
      className="pm-market-card block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(57,255,20,0.5)]"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        height: "100%",
        background:
          "linear-gradient(180deg,rgba(124,255,107,.022),rgba(0,0,0,0)),#0a0f0c",
        border: "1px solid rgba(124,255,107,.1)",
        borderRadius: 16,
        padding: 18,
        cursor: "pointer",
      }}
    >
      {/* Type badge + lock label */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            display: "inline-flex",
            padding: "4px 11px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".08em",
            border: "1px solid",
            color: tb.color,
            borderColor: tb.borderColor,
            background: tb.background,
          }}
        >
          {round.market_type}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            color: urgent ? "#FFC53D" : "#84938A",
            fontWeight: 500,
          }}
        >
          {lock}
        </span>
      </div>

      {/* Avatar + question + handle */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <KolNeonAvatar src={top?.kols?.avatar_url} name={kolName} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 15,
              lineHeight: 1.25,
              color: "#E6EFE8",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {question}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#6E7C72",
              fontFamily: "'JetBrains Mono', monospace",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {kolHandle}
          </div>
        </div>
      </div>

      {/* Big YES figure + sparkline */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 800,
              fontSize: 30,
              lineHeight: 1,
              color: yesPct >= 50 ? "#39FF14" : "#FF5E5E",
              textShadow:
                yesPct >= 50
                  ? "0 0 18px rgba(57,255,20,.35)"
                  : "0 0 18px rgba(255,94,94,.3)",
            }}
          >
            {round.hydrated ? `${yesPct}%` : "—"}
          </div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "#6E7C72",
              marginTop: 3,
            }}
          >
            YES · {round.hydrated ? multLabel : "×—"}
          </div>
        </div>
        <svg
          viewBox="0 0 88 26"
          width={88}
          height={26}
          preserveAspectRatio="none"
          style={{ overflow: "visible" }}
        >
          <polyline
            points={spark.points}
            fill="none"
            stroke={sparkColor}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: `drop-shadow(0 0 4px ${spark.trendUp ? "rgba(57,255,20,.5)" : "rgba(255,94,94,.5)"})` }}
          />
        </svg>
      </div>

      {/* 8px YES/NO pool bar */}
      <div
        style={{
          height: 8,
          borderRadius: 999,
          overflow: "hidden",
          display: "flex",
          background: "rgba(255,255,255,.05)",
        }}
      >
        <div
          style={{
            width: `${round.hydrated ? yesPct : 50}%`,
            background: "linear-gradient(90deg,#39FF14,#5CFF7A)",
            boxShadow: "0 0 12px rgba(57,255,20,.45)",
            transition: "width .5s ease",
          }}
        />
        <div
          style={{
            width: `${round.hydrated ? noPct : 50}%`,
            background: "linear-gradient(90deg,#FF5E5E,#FF3B3B)",
            transition: "width .5s ease",
          }}
        />
      </div>

      {/* Footer: Vol / bettors */}
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 12,
          borderTop: "1px solid rgba(124,255,107,.07)",
          fontSize: 12,
        }}
      >
        <span style={{ color: "#84938A" }}>
          Vol{" "}
          <span style={{ color: "#B7C2BA", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
            {round.hydrated ? formatCompact(total) : "—"}
          </span>
        </span>
        <span style={{ color: "#84938A" }}>
          <span style={{ color: "#B7C2BA", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
            {round.hydrated ? round.bettorCount : "—"}
          </span>{" "}
          bettors
        </span>
      </div>
    </Link>
  )
}

/** Minutes until lock, or a large number once past / closed. */
function timeLeftMinutes(lockTs: string): number {
  const t = new Date(lockTs).getTime()
  if (!Number.isFinite(t)) return Number.MAX_SAFE_INTEGER
  return (t - Date.now()) / 60000
}

/** Skeleton placeholder card for the loading grid (matches the neon card). */
export function MarketCardSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        height: "100%",
        background:
          "linear-gradient(180deg,rgba(124,255,107,.022),rgba(0,0,0,0)),#0a0f0c",
        border: "1px solid rgba(124,255,107,.1)",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="pm-skeleton h-5 w-16 rounded-full" />
        <div className="pm-skeleton h-4 w-20 rounded-full" />
      </div>
      <div className="flex items-center gap-3">
        <div className="pm-skeleton h-11 w-11 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <div className="pm-skeleton h-4 w-3/4" />
          <div className="pm-skeleton h-3 w-1/2" />
        </div>
      </div>
      <div className="flex items-end justify-between">
        <div className="pm-skeleton h-8 w-20 rounded" />
        <div className="pm-skeleton h-6 w-20 rounded" />
      </div>
      <div className="pm-skeleton h-2 w-full rounded-full" />
      <div className="flex items-center justify-between pt-3">
        <div className="pm-skeleton h-3 w-16" />
        <div className="pm-skeleton h-3 w-16" />
      </div>
    </div>
  )
}
