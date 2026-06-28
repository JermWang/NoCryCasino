"use client"

// Deterministic sparkline generator for the No Cry Casino market cards.
// The design canvas drives its sparkline from a per-market `seed` array; the
// real app has no historical series, so we synthesize a stable pseudo-series
// from a string key (outcome/round id) plus the live YES probability so the
// trend reads "up" when YES is winning. Same key + pct => identical points.

const SPARK_W = 88
const SPARK_H = 26
const SPARK_N = 12

/** Small fast string hash (FNV-1a) for stable per-key seeding. */
function hashString(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Mulberry32 PRNG seeded from a 32-bit integer. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Spark = {
  /** SVG polyline `points` attribute, mapped into an 88×26 viewBox. */
  points: string
  /** Whether the synthesized series trends upward (last >= first). */
  trendUp: boolean
}

/**
 * Build a stable 12-point sparkline for a market. `pct` (0-100) biases the
 * series so a YES-favored market drifts up and a NO-favored one drifts down,
 * matching the design's green-up / red-down sparkline coloring.
 */
export function buildSpark(key: string, pct = 50): Spark {
  const rand = mulberry32(hashString(key || "spark"))
  // Drift in [-0.5, 0.5] from the implied probability — favored side rises.
  const drift = (pct - 50) / 100
  const series: number[] = []
  let level = 0.5 - drift * 0.5
  for (let i = 0; i < SPARK_N; i++) {
    const wobble = (rand() - 0.5) * 0.28
    level = Math.min(1, Math.max(0, level + drift / SPARK_N + wobble))
    series.push(level)
  }

  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const points = series
    .map((v, i) => {
      const x = ((i / (SPARK_N - 1)) * SPARK_W).toFixed(1)
      const y = (SPARK_H - ((v - min) / span) * SPARK_H).toFixed(1)
      return `${x},${y}`
    })
    .join(" ")

  return { points, trendUp: series[series.length - 1]! >= series[0]! }
}
