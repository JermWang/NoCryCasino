"use client"

import Link from "next/link"

export type LandingMarket = {
  id: string
  type: "DAILY" | "WEEKLY" | "MONTHLY"
  question: string
  kolHandle: string
  kolInitials: string
  yesPct: number
  lockLabel: string
  lockUrgent?: boolean
  volumeLabel: string
  bettorsLabel: string
  seed: number[]
}

function typeColor(t: LandingMarket["type"]) {
  if (t === "DAILY") return "#5CFF7A"
  if (t === "WEEKLY") return "#39FF14"
  return "#FFC53D"
}

// spark polyline — identical math to the design's spark()
function spark(seed: number[]) {
  const w = 88
  const h = 26
  const n = seed.length
  const min = Math.min(...seed)
  const max = Math.max(...seed)
  const span = max - min || 1
  return seed
    .map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ")
}

export function LandingCard({ mk, href = "/pm" }: { mk: LandingMarket; href?: string }) {
  const tc = typeColor(mk.type)
  const yesPct = mk.yesPct
  const noPct = 100 - yesPct
  const trendUp = mk.seed[mk.seed.length - 1] >= mk.seed[0]
  const sparkColor = trendUp ? "#39FF14" : "#FF5E5E"
  const multLabel = "×" + (100 / Math.max(1, yesPct)).toFixed(2)

  return (
    <Link
      href={href}
      className="ncc-landing-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        height: "100%",
        background: "linear-gradient(180deg,rgba(124,255,107,.022),rgba(0,0,0,0)),#0a0f0c",
        border: "1px solid rgba(124,255,107,.1)",
        borderRadius: 16,
        padding: 18,
        cursor: "pointer",
        textDecoration: "none",
        transition: "border-color .2s ease, box-shadow .2s ease, transform .2s ease",
      }}
    >
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
            color: tc,
            borderColor: tc + "55",
            background: tc + "12",
          }}
        >
          {mk.type}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            color: mk.lockUrgent ? "#FFC53D" : "#84938A",
            fontWeight: 500,
          }}
        >
          {mk.lockLabel}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Orbitron', sans-serif",
            fontWeight: 700,
            fontSize: 14,
            color: "#7CFF6B",
            background: "radial-gradient(circle at 30% 30%, rgba(57,255,20,.18), rgba(8,14,10,.9))",
            border: "1px solid rgba(57,255,20,.22)",
          }}
        >
          {mk.kolInitials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.25, color: "#E6EFE8" }}>{mk.question}</div>
          <div
            style={{
              fontSize: 12,
              color: "#6E7C72",
              fontFamily: "'JetBrains Mono', monospace",
              marginTop: 2,
            }}
          >
            {mk.kolHandle}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 800,
              fontSize: 30,
              lineHeight: 1,
              color: "#39FF14",
              textShadow: "0 0 18px rgba(57,255,20,.35)",
            }}
          >
            {yesPct}%
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
            YES · {multLabel}
          </div>
        </div>
        <svg viewBox="0 0 88 26" width="88" height="26" preserveAspectRatio="none" style={{ overflow: "visible" }}>
          <polyline
            points={spark(mk.seed)}
            fill="none"
            stroke={sparkColor}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(0 0 4px rgba(57,255,20,.5))" }}
          />
        </svg>
      </div>

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
            width: yesPct + "%",
            background: "linear-gradient(90deg,#39FF14,#5CFF7A)",
            boxShadow: "0 0 12px rgba(57,255,20,.45)",
            transition: "width .5s ease",
          }}
        />
        <div
          style={{
            width: noPct + "%",
            background: "linear-gradient(90deg,#FF5E5E,#FF3B3B)",
            transition: "width .5s ease",
          }}
        />
      </div>

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
            {mk.volumeLabel}
          </span>
        </span>
        <span style={{ color: "#84938A" }}>
          <span style={{ color: "#B7C2BA", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
            {mk.bettorsLabel}
          </span>{" "}
          bettors
        </span>
      </div>
    </Link>
  )
}
