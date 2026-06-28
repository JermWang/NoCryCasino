"use client"

import Link from "next/link"
import { LandingCard, type LandingMarket } from "@/components/landing/landing-card"

// Top-3-by-volume featured markets — values from the design's MARKETS seed.
const FEATURED: LandingMarket[] = [
  {
    id: "m1",
    type: "WEEKLY",
    question: "Ansem #1 on the weekly leaderboard?",
    kolHandle: "@blknoiz06",
    kolInitials: "AN",
    yesPct: 73, // 842 / (842+318)
    lockLabel: "Locks in 3h 12m",
    volumeLabel: "1.2K SOL",
    bettorsLabel: "1.2K",
    seed: [12, 18, 15, 22, 28, 24, 31, 29, 35, 33, 40, 44],
  },
  {
    id: "m7",
    type: "MONTHLY",
    question: "Waddles Top-10 this month?",
    kolHandle: "@waddles_eth",
    kolInitials: "WA",
    yesPct: 61, // 612 / (612+388)
    lockLabel: "Locks in 14d 0h",
    volumeLabel: "1K SOL",
    bettorsLabel: "1K",
    seed: [18, 20, 22, 21, 24, 26, 25, 28, 30, 29, 32, 34],
  },
  {
    id: "m4",
    type: "DAILY",
    question: "Cented green today?",
    kolHandle: "@Cented7",
    kolInitials: "CE",
    yesPct: 73, // 521 / (521+190)
    lockLabel: "Locks in 18m",
    lockUrgent: true,
    volumeLabel: "711 SOL",
    bettorsLabel: "654",
    seed: [10, 14, 13, 18, 21, 20, 25, 27, 26, 30, 34, 38],
  },
]

export function FeaturedMarkets() {
  return (
    <section style={{ padding: "28px 0 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <h2
          style={{
            fontFamily: "'Orbitron', sans-serif",
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "#B7C2BA",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#39FF14",
              animation: "ncc-pulse 1.8s ease-in-out infinite",
            }}
          />
          Hottest markets right now
        </h2>
        <Link
          href="/pm"
          style={{ fontSize: 13, fontWeight: 600, color: "#7CFF6B", cursor: "pointer", textDecoration: "none" }}
        >
          All markets →
        </Link>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }} className="ncc-featured-grid">
        {FEATURED.map((mk) => (
          <LandingCard key={mk.id} mk={mk} href="/pm" />
        ))}
      </div>
    </section>
  )
}

export function FooterTrustStrip() {
  const items = [
    { icon: "◆", label: "Real markets" },
    { icon: "◆", label: "Live odds" },
    { icon: "◆", label: "Non-custodial" },
    { icon: "◆", label: "Settles on-chain" },
    { icon: "sol", label: "Solana native" },
  ]
  return (
    <footer
      style={{
        position: "relative",
        zIndex: 1,
        marginTop: 40,
        borderTop: "1px solid rgba(124,255,107,.1)",
        background: "rgba(4,8,6,.5)",
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "22px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          flexWrap: "wrap",
        }}
      >
        {items.map((it, i) => (
          <span
            key={i}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "#84938A",
            }}
          >
            {it.icon === "sol" ? (
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg,#9945FF,#14F195)",
                  display: "inline-block",
                }}
              />
            ) : (
              <span style={{ color: "#39FF14" }}>◆</span>
            )}
            {it.label}
          </span>
        ))}
      </div>
    </footer>
  )
}
