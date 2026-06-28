"use client"

import { useState, type CSSProperties } from "react"
import { timeUntil } from "./pm-client"

/* -------------------------------------------------------------------------- */
/*  Type badge color — exact No Cry Casino mapping                            */
/* -------------------------------------------------------------------------- */

/** Per-type accent color (design: DAILY #5CFF7A, WEEKLY #39FF14, else amber). */
export function typeColor(type: string): string {
  if (type === "DAILY") return "#5CFF7A"
  if (type === "WEEKLY") return "#39FF14"
  return "#FFC53D"
}

/** Inline style for the type pill: tinted text/border/background off one hue. */
export function typeBadgeStyle(type: string): {
  color: string
  borderColor: string
  background: string
} {
  const c = typeColor(type)
  return { color: c, borderColor: `${c}55`, background: `${c}12` }
}

/* -------------------------------------------------------------------------- */
/*  Lock label                                                                */
/* -------------------------------------------------------------------------- */

/** "Locks in 1h 23m" / "Betting closed" text for a market card. */
export function lockLabel(lockTs: string, locked: boolean, closed: boolean): string {
  if (closed && !locked) return "Betting closed"
  if (locked) return "Locked"
  return `Locks in ${timeUntil(lockTs)}`
}

/* -------------------------------------------------------------------------- */
/*  Neon KOL avatar — 44px rounded-12 green radial + Orbitron initials        */
/* -------------------------------------------------------------------------- */

/**
 * The design's KOL avatar: a square rounded-12 tile with a green radial-gradient
 * background, neon border, and Orbitron initials in #7CFF6B. When a real avatar
 * image is available we show it (same tile shape + neon ring); otherwise we fall
 * back to the Orbitron initials exactly as specified.
 */
export function KolNeonAvatar({
  src,
  name,
  size = 44,
  fontSize,
}: {
  src?: string | null
  name: string
  size?: number
  fontSize?: number
}) {
  const [failed, setFailed] = useState(false)
  const initials = name.trim().slice(0, 2).toUpperCase() || "?"
  const radius = Math.round(size * 0.27) // 44 -> 12, 64 -> 14
  const fs = fontSize ?? Math.round(size * 0.32)

  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Orbitron', sans-serif",
    fontWeight: 700,
    fontSize: fs,
    color: "#7CFF6B",
    background: "radial-gradient(circle at 30% 30%, rgba(57,255,20,.18), rgba(8,14,10,.9))",
    border: "1px solid rgba(57,255,20,.22)",
    overflow: "hidden",
  }

  if (!src || failed) {
    return <div style={base}>{initials}</div>
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      style={{ ...base, objectFit: "cover" }}
    />
  )
}
