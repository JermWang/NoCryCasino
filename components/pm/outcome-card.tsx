"use client"

import { useState, type CSSProperties } from "react"
import { Trophy, XCircle, CheckCircle2 } from "lucide-react"
import { BetDialog } from "./bet-dialog"
import type { OutcomeRow } from "./types"
import { formatCompact, impliedYesPct, shortAddress, type PmSide } from "./pm-client"
import { buildSpark } from "./pm-spark"
import { KolNeonAvatar } from "./market-card-bits"

type OutcomeCardProps = {
  outcome: OutcomeRow
  collateralMint: string
  // Disable betting (round not OPEN or past lock).
  bettingClosed?: boolean
  available?: number | null
  rakeBps?: number
  // Whether the connected wallet qualifies for the $NOCRY fee waiver.
  feeWaived?: boolean
  onBetPlaced?: () => void
}

/**
 * One KOL outcome rendered as the exact No Cry Casino market card (neon tile,
 * 44px green-radial Orbitron avatar, big YES figure + glow, sparkline, 8px
 * pool bar, Vol / bettors footer) with YES / NO action buttons that open the
 * BetDialog. Settled / cancelled outcomes swap the buttons for a verdict.
 */
export function OutcomeCard({
  outcome,
  collateralMint,
  bettingClosed,
  available,
  rakeBps = 250,
  feeWaived,
  onBetPlaced,
}: OutcomeCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [side, setSide] = useState<PmSide>("YES")

  const name =
    outcome.kols?.display_name && outcome.kols.display_name.length > 0
      ? outcome.kols.display_name
      : shortAddress(outcome.kol_wallet_address)
  const handle =
    outcome.kols?.twitter_handle && outcome.kols.twitter_handle.length > 0
      ? `@${outcome.kols.twitter_handle}`
      : shortAddress(outcome.kol_wallet_address)

  const yesPool = Number(outcome.yes_pool ?? 0)
  const noPool = Number(outcome.no_pool ?? 0)
  const totalPool = Number(outcome.total_pool ?? yesPool + noPool)
  const bettors = Number(outcome.yes_bettor_count ?? 0) + Number(outcome.no_bettor_count ?? 0)
  const yesPct = impliedYesPct(yesPool, noPool, outcome.yes_prob)
  const noPct = 100 - yesPct

  const yesShare = yesPool > 0 ? yesPool : totalPool > 0 ? totalPool : 1
  const mult = totalPool > 0 ? totalPool / yesShare : 1

  const spark = buildSpark(outcome.outcome_id, yesPct)
  const sparkColor = spark.trendUp ? "#39FF14" : "#FF5E5E"

  const settled = outcome.status === "SETTLED"
  const cancelled = outcome.status === "CANCELLED"
  const disabled = Boolean(bettingClosed) || settled || cancelled || outcome.status !== "ACTIVE"

  const question =
    outcome.question_text && outcome.question_text.length > 0
      ? outcome.question_text
      : `Will ${name} finish on top?`

  function openBet(s: PmSide) {
    setSide(s)
    setDialogOpen(true)
  }

  const labelColor = settled
    ? outcome.final_outcome
      ? "#5CFF7A"
      : "#FF7676"
    : yesPct >= 50
      ? "#84938A"
      : "#FF7676"

  return (
    <div
      className="pm-market-card"
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
      {/* Avatar + name + handle, with settled badge on the right */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <KolNeonAvatar src={outcome.kols?.avatar_url} name={name} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.25, color: "#E6EFE8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </div>
          {outcome.kols?.twitter_handle ? (
            <a
              href={outcome.kols.twitter_url ?? `https://x.com/${outcome.kols.twitter_handle}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: 12, color: "#6E7C72", fontFamily: "'JetBrains Mono', monospace", marginTop: 2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {handle}
            </a>
          ) : (
            <div style={{ fontSize: 12, color: "#6E7C72", fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
              {handle}
            </div>
          )}
        </div>
        {settled ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
              color: outcome.final_outcome ? "#5CFF7A" : "#FF7676",
              background: outcome.final_outcome ? "rgba(57,255,20,.12)" : "rgba(255,94,94,.12)",
              border: `1px solid ${outcome.final_outcome ? "rgba(57,255,20,.3)" : "rgba(255,94,94,.3)"}`,
            }}
          >
            {outcome.final_outcome ? <Trophy className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {outcome.final_outcome ? "YES won" : "NO won"}
          </span>
        ) : cancelled ? (
          <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: "#84938A", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", flexShrink: 0 }}>
            Cancelled
          </span>
        ) : null}
      </div>

      {/* Question */}
      <div style={{ fontSize: 13, color: "#84938A", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {question}
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
              textShadow: yesPct >= 50 ? "0 0 18px rgba(57,255,20,.35)" : "0 0 18px rgba(255,94,94,.3)",
            }}
          >
            {yesPct}%
          </div>
          <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: labelColor, marginTop: 3 }}>
            YES · ×{mult.toFixed(2)}
          </div>
        </div>
        <svg viewBox="0 0 88 26" width={88} height={26} preserveAspectRatio="none" style={{ overflow: "visible" }}>
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
      <div style={{ height: 8, borderRadius: 999, overflow: "hidden", display: "flex", background: "rgba(255,255,255,.05)" }}>
        <div style={{ width: `${yesPct}%`, background: "linear-gradient(90deg,#39FF14,#5CFF7A)", boxShadow: "0 0 12px rgba(57,255,20,.45)", transition: "width .5s ease" }} />
        <div style={{ width: `${noPct}%`, background: "linear-gradient(90deg,#FF5E5E,#FF3B3B)", transition: "width .5s ease" }} />
      </div>

      {/* Footer: Vol / bettors */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid rgba(124,255,107,.07)", fontSize: 12 }}>
        <span style={{ color: "#84938A" }}>
          Vol <span style={{ color: "#B7C2BA", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{formatCompact(totalPool)}</span>
        </span>
        <span style={{ color: "#84938A" }}>
          <span style={{ color: "#B7C2BA", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{bettors}</span> bettors
        </span>
      </div>

      {/* Action row */}
      {settled ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: "auto", borderRadius: 12, border: "1px solid rgba(124,255,107,.1)", background: "rgba(0,0,0,.25)", padding: "10px 0", fontSize: 12, color: "#84938A" }}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Settled — payouts distributed
        </div>
      ) : cancelled ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: "auto", borderRadius: 12, border: "1px solid rgba(124,255,107,.1)", background: "rgba(0,0,0,.25)", padding: "10px 0", fontSize: 12, color: "#84938A" }}>
          Stakes refunded
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: "auto", paddingTop: 2 }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => openBet("YES")}
            aria-label={`Bet YES on ${name} at ${yesPct} percent`}
            style={ctaStyle(true, disabled)}
          >
            YES · {yesPct}%
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => openBet("NO")}
            aria-label={`Bet NO on ${name} at ${noPct} percent`}
            style={ctaStyle(false, disabled)}
          >
            NO · {noPct}%
          </button>
        </div>
      )}

      <BetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        outcome={outcome}
        side={side}
        collateralMint={collateralMint}
        disabled={disabled}
        available={available}
        rakeBps={rakeBps}
        feeWaived={feeWaived}
        onBetPlaced={onBetPlaced}
      />
    </div>
  )
}

/** YES (solid neon) / NO (red outline) button styles matching the design. */
function ctaStyle(isYes: boolean, disabled: boolean): CSSProperties {
  if (isYes) {
    return {
      borderRadius: 10,
      padding: "10px 0",
      fontFamily: "'Orbitron', sans-serif",
      fontWeight: 800,
      fontSize: 13,
      letterSpacing: ".02em",
      cursor: disabled ? "not-allowed" : "pointer",
      border: "1px solid rgba(57,255,20,.6)",
      background: "linear-gradient(180deg,#6CFF4A,#39FF14)",
      color: "#04130a",
      boxShadow: "0 6px 18px rgba(57,255,20,.28), inset 0 1px 0 rgba(255,255,255,.35)",
      opacity: disabled ? 0.45 : 1,
      transition: "filter .15s ease, transform .15s ease",
    }
  }
  return {
    borderRadius: 10,
    padding: "10px 0",
    fontFamily: "'Orbitron', sans-serif",
    fontWeight: 800,
    fontSize: 13,
    letterSpacing: ".02em",
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid rgba(255,94,94,.38)",
    background: "rgba(255,94,94,.08)",
    color: "#FF7676",
    opacity: disabled ? 0.45 : 1,
    transition: "background-color .15s ease, border-color .15s ease",
  }
}
