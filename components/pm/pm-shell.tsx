"use client"

import type { ReactNode } from "react"
import { Toaster } from "sonner"
import { Header } from "@/components/header"
import { AsciiShaderBackground } from "@/components/ascii-shader-background"

type PmShellProps = {
  children: ReactNode
  /** Constrain the main content width. Defaults to the wide 7xl grid. */
  maxWidth?: "lg" | "xl" | "2xl" | "5xl" | "6xl" | "7xl"
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
 * background, the global header, a self-contained Sonner toaster (the root
 * layout does not mount one), and a centered main container. Keeps the PM
 * surface visually consistent and trustworthy across list / detail / account.
 */
export function PmShell({ children, maxWidth = "7xl" }: PmShellProps) {
  return (
    <div className="relative min-h-screen bg-black">
      <AsciiShaderBackground mode="plasma" opacity={0.1} color="emerald" />
      <div className="relative z-10">
        <Header />
        <main className={`mx-auto ${MAX_WIDTH[maxWidth]} px-4 py-8`}>{children}</main>
      </div>
      <Toaster
        position="bottom-right"
        theme="dark"
        richColors
        closeButton
        toastOptions={{
          style: {
            background: "hsl(0 0% 12%)",
            border: "1px solid hsl(0 0% 18%)",
            color: "hsl(0 0% 84%)",
          },
        }}
      />
    </div>
  )
}
