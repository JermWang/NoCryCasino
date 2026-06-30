"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LandingCard, type LandingMarket } from "@/components/landing/landing-card"

type Card = LandingMarket & { href: string }

function lockLabel(lockTs: string): { label: string; urgent: boolean } {
  const ms = Date.parse(lockTs) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return { label: "Locked", urgent: false }
  const totalMin = Math.floor(ms / 60000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d >= 1) return { label: `Locks in ${d}d ${h}h`, urgent: false }
  if (h >= 1) return { label: `Locks in ${h}h ${m}m`, urgent: false }
  return { label: `Locks in ${m}m`, urgent: true }
}

function kolFromQuestion(q: string, fallback: string): string {
  const m = q.match(/^Will\s+(.+?)\s+(be|finish|end|out)/i)
  return (m?.[1] ?? "").trim() || fallback
}

export function FeaturedMarkets() {
  const [cards, setCards] = useState<Card[] | null>(null)

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const r = await fetch("/api/pm/rounds?status=OPEN")
        const j = (await r.json().catch(() => null)) as any
        const rounds = Array.isArray(j?.rounds) ? j.rounds.slice(0, 3) : []
        const out: Card[] = []
        for (const rd of rounds) {
          const dr = (await fetch(`/api/pm/rounds/${encodeURIComponent(rd.round_id)}`)
            .then((x) => x.json())
            .catch(() => null)) as any
          const outcomes: any[] = Array.isArray(dr?.outcomes) ? dr.outcomes : []
          if (outcomes.length === 0) continue
          const top = outcomes.slice().sort((a, b) => Number(b.total_pool ?? 0) - Number(a.total_pool ?? 0))[0]
          const q = String(top.question_text ?? "")
          const name = kolFromQuestion(q, `${String(top.kol_wallet_address).slice(0, 4)}…`)
          const yesPct = top.yes_prob != null ? Math.round(Number(top.yes_prob) * 100) : 50
          const totalVol = outcomes.reduce((s, o) => s + Number(o.total_pool ?? 0), 0)
          const bettors = outcomes.reduce(
            (s, o) => s + Number(o.yes_bettor_count ?? 0) + Number(o.no_bettor_count ?? 0),
            0,
          )
          const lk = lockLabel(rd.lock_ts)
          out.push({
            id: rd.round_id,
            type: rd.market_type,
            question: q || `${rd.market_type} market`,
            kolHandle: name,
            kolInitials: name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "NC",
            yesPct,
            lockLabel: lk.label,
            lockUrgent: lk.urgent,
            volumeLabel: `${totalVol >= 100 ? Math.round(totalVol) : totalVol.toFixed(1)} SOL`,
            bettorsLabel: String(bettors),
            seed: [12, 16, 14, 20, 24, 22, 28, 26, 32, 30, 36, 40],
            href: `/pm/rounds/${encodeURIComponent(rd.round_id)}`,
          })
        }
        if (mounted) setCards(out)
      } catch {
        if (mounted) setCards([])
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <section style={{ padding: "28px 0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
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
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#39FF14", animation: "ncc-pulse 1.8s ease-in-out infinite" }} />
          Hottest markets right now
        </h2>
        <Link href="/pm" style={{ fontSize: 13, fontWeight: 600, color: "#7CFF6B", cursor: "pointer", textDecoration: "none" }}>
          All markets →
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }} className="ncc-featured-grid">
        {cards === null ? (
          [0, 1, 2].map((i) => (
            <div key={i} style={{ height: 188, borderRadius: 16, border: "1px solid rgba(124,255,107,.1)", background: "rgba(124,255,107,.03)", animation: "ncc-pulse 1.6s ease-in-out infinite" }} />
          ))
        ) : cards.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "28px 0", color: "#84938A", fontSize: 14 }}>
            No open markets right now —{" "}
            <Link href="/pm" style={{ color: "#7CFF6B", textDecoration: "none" }}>
              check the markets page
            </Link>
            .
          </div>
        ) : (
          cards.map((mk) => <LandingCard key={mk.id} mk={mk} href={mk.href} />)
        )}
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
    <footer style={{ position: "relative", zIndex: 1, marginTop: 40, borderTop: "1px solid rgba(124,255,107,.1)", background: "rgba(4,8,6,.5)" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "22px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 40, flexWrap: "wrap" }}>
        {items.map((it, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#84938A" }}>
            {it.icon === "sol" ? (
              <span style={{ width: 13, height: 13, borderRadius: "50%", background: "linear-gradient(135deg,#9945FF,#14F195)", display: "inline-block" }} />
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
