"use client"

import { useEffect, useRef } from "react"

/**
 * Adds the `is-in` class when the element scrolls into view, driving the
 * `.ncc-reveal` CSS transition. No-op (always visible) when IntersectionObserver
 * is unavailable or the user prefers reduced motion — content never hides.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches

    if (reduce || typeof IntersectionObserver === "undefined") {
      el.classList.add("is-in")
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in")
            io.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    )

    io.observe(el)
    return () => io.disconnect()
  }, [])

  return ref
}
