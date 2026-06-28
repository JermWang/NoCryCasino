"use client"

import Link from "next/link"
import { Header } from "@/components/header"
import { FeaturedMarkets, FooterTrustStrip } from "@/components/landing/featured-markets"

// Large detailed ASCII laughing-crying smiley (exact from the design home section).
const SMILEY_ASCII = `                      ██████████████████
                ██████░░░░░░░░░░░░░░░░██████
            ████░░░░░░░░░░░░░░░░░░░░░░░░░░████
          ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
        ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
      ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
    ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
    ██░░░░░░████████░░░░░░░░░░░░░░░░████████░░░░░░░░██
  ██░░░░░░██████████░░░░░░░░░░░░░░██████████░░░░░░░░░░██
  ██░░░░████████████░░░░░░░░░░░░░░████████████░░░░░░░░██
  ██░░░░██████████░░░░░░░░░░░░░░░░░░██████████░░░░░░░░██
  ██░░░░░░████████░░░░░░░░░░░░░░░░░░████████░░░░░░░░░░██
  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
  ██░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██░░██
  ██░░░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██░░░░██
    ██░░░░████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████░░░░██
    ██░░░░░░░░████████████████████████████░░░░░░░░░░██
      ██░░░░░░░░░░░░████████████████░░░░░░░░░░░░░░██
        ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
          ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
            ████░░░░░░░░░░░░░░░░░░░░░░░░░░████
                ██████░░░░░░░░░░░░░░░░██████
                      ██████████████████                      `

// Blocky pixel-style "NO CRY CASINO" wordmark (exact from the design home section).
const TITLE_ASCII = `██  ██  █████      █████ █████  ██  ██
███ ██ ██   ██    ██     ██  ██  ████
██████ ██   ██    ██     █████    ██
██ ███ ██   ██    ██     ██  ██   ██
██  ██  █████      █████ ██  ██   ██

 ████   ████  ████  ██ ██  ██  ████
██     ██  ██ ██    ██ ███ ██ ██  ██
██     ██████ ████  ██ ██████ ██  ██
██     ██  ██    ██ ██ ██ ███ ██  ██
 ████  ██  ██ ████  ██ ██  ██  ████  `

export default function HomePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#04070a",
        color: "#E6EFE8",
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      {/* clean radial ambient overlay only — no warping ASCII shader (matches the design canvas) */}
      <div className="ncc-ambient" />

      <div style={{ position: "relative", zIndex: 1 }}>
        <Header />

        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 24px" }}>
          {/* ============ HOME ============ */}
          <section
            style={{
              minHeight: "calc(100vh - 250px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "48px 0 36px",
            }}
          >
            <pre
              aria-label="No Cry Casino smiley"
              style={{
                margin: 0,
                whiteSpace: "pre",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "clamp(5px, .92vw, 11px)",
                lineHeight: 1,
                letterSpacing: "-.05em",
                color: "#7CFF6B",
                textShadow:
                  "0 0 10px rgba(124,255,107,.8), 0 0 30px rgba(124,255,107,.5), 0 0 60px rgba(124,255,107,.3)",
                animation: "ncc-glow 2.6s ease-in-out infinite",
              }}
            >
              {SMILEY_ASCII}
            </pre>

            <pre
              aria-label="No Cry Casino"
              style={{
                margin: "1.6rem 0 0",
                whiteSpace: "pre",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "clamp(7px, 1.25vw, 15px)",
                lineHeight: 1.1,
                letterSpacing: ".05em",
                color: "#7CFF6B",
                textShadow:
                  "0 0 8px rgba(124,255,107,.7), 0 0 24px rgba(124,255,107,.4), 0 0 48px rgba(124,255,107,.2)",
                animation: "ncc-glow 2.6s ease-in-out infinite .5s",
              }}
            >
              {TITLE_ASCII}
            </pre>

            <div
              style={{
                marginTop: "1.7rem",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                letterSpacing: ".34em",
                color: "rgba(124,255,107,.5)",
              }}
            >
              LIVE KOL TRACKING • P2P MARKETS
            </div>

            <div
              style={{
                display: "flex",
                gap: 14,
                marginTop: 38,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <Link
                href="/pm"
                className="ncc-cta-primary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "14px 30px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontFamily: "'Orbitron', sans-serif",
                  fontWeight: 800,
                  fontSize: 13,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                  background: "linear-gradient(180deg,#6CFF4A,#39FF14)",
                  color: "#04130a",
                  boxShadow: "0 12px 34px rgba(57,255,20,.3), inset 0 1px 0 rgba(255,255,255,.4)",
                }}
              >
                Enter Markets →
              </Link>
              <Link
                href="/leaderboard"
                className="ncc-cta-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "14px 28px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                  border: "1px solid rgba(124,255,107,.22)",
                  color: "#7CFF6B",
                  background: "rgba(124,255,107,.04)",
                }}
              >
                Leaderboard
              </Link>
            </div>
          </section>

          {/* featured markets */}
          <FeaturedMarkets />
        </div>

        {/* footer trust strip */}
        <FooterTrustStrip />
      </div>
    </div>
  )
}
