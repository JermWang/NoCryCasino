"use client"

import type { ReactNode } from "react"
import { Toaster } from "sonner"
import { Header } from "@/components/header"
import { AsciiShaderBackground } from "@/components/ascii-shader-background"
import { PmFeatureStrip } from "./pm-feature-strip"
import "./pm-theme.css"

type PmShellProps = {
  children: ReactNode
  /** Constrain the main content width. Defaults to the wide 7xl grid. */
  maxWidth?: "lg" | "xl" | "2xl" | "5xl" | "6xl" | "7xl"
  /** Hide the bottom feature strip (e.g. for dense sub-pages). */
  hideFeatureStrip?: boolean
}

const MAX_WIDTH: Record<NonNullable<PmShellProps["maxWidth"]>, string> = {
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
}

/**
 * Shared chrome for every prediction-market page: the animated ASCII
 * background, a near-black neon "No Cry Casino" surface (themed via the scoped
 * .pm-theme wrapper + pm-theme.css), the global header, a self-contained Sonner
 * toaster (the root layout does not mount one), a centered main container, and
 * the REAL MARKETS · LIVE ODDS · … feature strip. Keeps the PM surface visually
 * consistent across list / detail / account.
 */
export function PmShell({ children, maxWidth = "7xl", hideFeatureStrip = false }: PmShellProps) {
  return (
    <div className="pm-theme relative min-h-screen bg-[#04070a]">
      <AsciiShaderBackground mode="plasma" opacity={0.14} color="emerald" />
      <div className="pm-grid-texture" aria-hidden />
      <div className="relative z-10 flex min-h-screen flex-col">
        <Header />
        <main className={`mx-auto w-full flex-1 ${MAX_WIDTH[maxWidth]} px-4 py-8`}>{children}</main>
        {!hideFeatureStrip && <PmFeatureStrip />}
      </div>
      <Toaster
        position="bottom-right"
        theme="dark"
        richColors
        closeButton
        toastOptions={{
          style: {
            background: "#070b09",
            border: "1px solid rgba(124, 255, 107, 0.22)",
            color: "hsl(0 0% 92%)",
          },
        }}
      />
    </div>
  )
}
