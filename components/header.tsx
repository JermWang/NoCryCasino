"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { useWallet } from "@/lib/wallet"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { NOCRY_CA } from "@/components/nocry-ca-badge"

// ---- live ticker rows (KOL PnL) — sample rows from the design ----
const TICKER_ROWS: { name: string; val: string; color: string }[] = [
  { name: "Ansem", val: "+1,842.6 SOL", color: "#5CFF7A" },
  { name: "Cupsey", val: "+1,310.2 SOL", color: "#5CFF7A" },
  { name: "Euris", val: "+1,180.4 SOL", color: "#5CFF7A" },
  { name: "Cented", val: "+904.8 SOL", color: "#5CFF7A" },
  { name: "Mitch", val: "+786.3 SOL", color: "#5CFF7A" },
  { name: "Kreo", val: "+612.5 SOL", color: "#5CFF7A" },
  { name: "Waddles", val: "+540.9 SOL", color: "#5CFF7A" },
  { name: "Sebastian", val: "+498.1 SOL", color: "#5CFF7A" },
  { name: "Pow", val: "+432.7 SOL", color: "#5CFF7A" },
  { name: "Gake", val: "+388.2 SOL", color: "#5CFF7A" },
  { name: "Jijo", val: "+301.5 SOL", color: "#5CFF7A" },
  { name: "Loopier", val: "+268.9 SOL", color: "#5CFF7A" },
]

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/markets", label: "Markets" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/pm", label: "Portfolio" },
]

function TickerRow({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", padding: "7px 0" }}
      aria-hidden={ariaHidden || undefined}
    >
      {TICKER_ROWS.map((t, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "0 22px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "#7CFF6B", textShadow: "0 0 8px rgba(124,255,107,.6)" }}>◆</span>
          <span style={{ color: "#B7C2BA" }}>{t.name}</span>
          <span style={{ color: t.color, fontWeight: 500 }}>{t.val}</span>
        </span>
      ))}
    </div>
  )
}

export function Header() {
  const pathname = usePathname()
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const { connected, publicKey, balance, disconnect } = useWallet()
  const { setVisible } = useWalletModal()

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const res = await fetch("/api/price/sol")
        const json = (await res.json().catch(() => null)) as any
        if (!mounted) return
        if (res.ok && json?.ok && typeof json?.solPriceUsd === "number") {
          setSolPriceUsd(json.solPriceUsd)
          return
        }
        setSolPriceUsd(null)
      } catch {
        if (!mounted) return
        setSolPriceUsd(null)
      }
    }

    load()
    const t = setInterval(load, 60_000)

    return () => {
      mounted = false
      clearInterval(t)
    }
  }, [])

  const copyCa = async () => {
    try {
      await navigator.clipboard.writeText(NOCRY_CA)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const onWallet = () => {
    if (connected) {
      disconnect()
    } else {
      setVisible(true)
    }
  }

  const solLabel = solPriceUsd !== null ? `$${solPriceUsd.toFixed(2)}` : "$--.--"
  const addr = publicKey ? `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}` : ""
  const walletLabel = connected ? `${balance.toFixed(2)} SOL` : "Connect Wallet"

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "rgba(4,7,10,.82)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(124,255,107,.1)",
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "0 24px",
          height: 64,
          display: "flex",
          alignItems: "center",
          gap: 28,
        }}
      >
        {/* logo */}
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            cursor: "pointer",
            textDecoration: "none",
          }}
          title="No Cry Casino"
        >
          <Image
            src="/ncc-smiley.png"
            alt="No Cry Casino"
            width={34}
            height={34}
            style={{ width: 34, height: 34, borderRadius: 8, boxShadow: "0 0 18px rgba(57,255,20,.35)" }}
          />
          <div
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: ".04em",
              lineHeight: 1,
              color: "#E6EFE8",
            }}
          >
            NO CRY
            <br />
            <span style={{ color: "#7CFF6B" }}>CASINO</span>
          </div>
        </Link>

        {/* nav */}
        <nav style={{ display: "flex", alignItems: "center", gap: 26, height: "100%" }}>
          {NAV_ITEMS.map((n) => {
            const active = pathname === n.href || (n.href !== "/" && pathname?.startsWith(n.href))
            return (
              <Link
                key={n.href}
                href={n.href}
                style={{
                  padding: "8px 4px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: active ? "#E6EFE8" : "#84938A",
                  position: "relative",
                  borderBottom: active ? "2px solid #39FF14" : "2px solid transparent",
                  transition: "color .15s ease",
                  textDecoration: "none",
                }}
              >
                {n.label}
              </Link>
            )
          })}
        </nav>

        <div style={{ flex: 1 }} />

        {/* SOL price chip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(124,255,107,.12)",
            background: "rgba(124,255,107,.04)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#9945FF,#14F195)",
              display: "inline-block",
            }}
          />
          <span style={{ color: "#84938A" }}>SOL</span>
          <span style={{ color: "#E6EFE8", fontWeight: 500 }} className="tabular-nums">
            {solLabel}
          </span>
        </div>

        {/* $NOCRY chip — click-to-copy CA */}
        <button
          type="button"
          onClick={copyCa}
          title="Copy $NOCRY contract — hold 10,000+ $NOCRY for zero platform fees"
          aria-label="Copy $NOCRY contract address. Hold 10,000 or more $NOCRY for zero platform fees."
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            borderRadius: 10,
            border: "1px solid rgba(57,255,20,.28)",
            background: "rgba(57,255,20,.08)",
            fontSize: 12,
            fontWeight: 700,
            color: "#7CFF6B",
            cursor: "pointer",
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
          }}
        >
          <span style={{ fontSize: 11 }}>◆</span> {copied ? "Copied!" : "$NOCRY"}
          <span className="sr-only" role="status" aria-live="polite">
            {copied ? "Copied" : ""}
          </span>
        </button>

        {/* wallet button — wired to the real wallet connect */}
        <button
          type="button"
          onClick={onWallet}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "7px 16px",
            borderRadius: 10,
            cursor: "pointer",
            minWidth: 132,
            border: "none",
            background: "linear-gradient(180deg,#6CFF4A,#39FF14)",
            color: "#04130a",
            boxShadow: "0 6px 20px rgba(57,255,20,.28)",
          }}
        >
          <span style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 13, lineHeight: 1.1 }}>
            {walletLabel}
          </span>
          {connected && addr ? (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, opacity: 0.65 }}>{addr}</span>
          ) : null}
        </button>
      </div>

      {/* live ticker */}
      <div
        style={{
          overflow: "hidden",
          borderTop: "1px solid rgba(124,255,107,.07)",
          background: "rgba(0,0,0,.3)",
        }}
      >
        <div style={{ display: "flex", width: "max-content", animation: "ncc-marquee 48s linear infinite" }}>
          <TickerRow />
          <TickerRow ariaHidden />
        </div>
      </div>
    </header>
  )
}
