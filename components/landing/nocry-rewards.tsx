"use client"

import { NocryCaBadge } from "@/components/nocry-ca-badge"

const STEPS: { n: string; title: string; body: string }[] = [
  { n: "1", title: "Hold 1M+ $NOCRY", body: "Keep at least 1,000,000 $NOCRY in your wallet. Holders are snapshotted on-chain every day." },
  { n: "2", title: "50% of fees, split daily", body: "Half of all platform house fees are pooled and split among eligible holders, pro-rata to your $NOCRY balance." },
  { n: "3", title: "Claim in your profile", body: "Your share lands in your account as a claimable reward — claim it anytime, straight to your balance." },
]

export function NocryRewards() {
  return (
    <section style={{ padding: "40px 0 16px" }}>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 20,
          border: "1px solid rgba(124,255,107,.16)",
          background: "linear-gradient(180deg,rgba(124,255,107,.05),rgba(0,0,0,0)),#070b09",
          padding: "30px 28px",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <h2
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 800,
              fontSize: 22,
              letterSpacing: ".02em",
              margin: 0,
              color: "#E6EFE8",
            }}
          >
            <span style={{ color: "#7CFF6B", textShadow: "0 0 18px rgba(124,255,107,.4)" }}>$NOCRY</span> Holder Rewards
          </h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "#7CFF6B",
              border: "1px solid rgba(57,255,20,.3)",
              background: "rgba(57,255,20,.08)",
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            Live · 50% of fees
          </span>
        </div>
        <p style={{ margin: "0 0 24px", fontSize: 15, lineHeight: 1.5, color: "#B7C2BA", maxWidth: 640 }}>
          Hold <b style={{ color: "#E6EFE8" }}>1,000,000+ $NOCRY</b> and earn <b style={{ color: "#7CFF6B" }}>50% of all
          platform house fees</b> — pooled and split among holders, paid out every day. Holding 10k+ also waives your own
          betting fees.
        </p>

        {/* steps */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 26 }} className="ncc-featured-grid">
          {STEPS.map((s) => (
            <div
              key={s.n}
              style={{
                borderRadius: 14,
                border: "1px solid rgba(124,255,107,.1)",
                background: "rgba(4,8,6,.5)",
                padding: 16,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "'Orbitron', sans-serif",
                  fontWeight: 800,
                  fontSize: 13,
                  color: "#04130a",
                  background: "linear-gradient(180deg,#6CFF4A,#39FF14)",
                  marginBottom: 10,
                }}
              >
                {s.n}
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#E6EFE8", marginBottom: 5 }}>{s.title}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "#84938A" }}>{s.body}</div>
            </div>
          ))}
        </div>

        {/* CA + soon */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <NocryCaBadge full />
          <span style={{ fontSize: 12, color: "#6E7C72" }}>More holder rewards coming soon.</span>
        </div>
      </div>
    </section>
  )
}
