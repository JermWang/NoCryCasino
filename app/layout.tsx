import type React from "react"
import type { Metadata, Viewport } from "next"
import { Analytics } from "@vercel/analytics/next"
import { WalletProvider } from "@/lib/wallet"
import "./globals.css"

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://nocry.casino"
const TITLE = "No Cry Casino — KOL Prediction Markets"
const DESCRIPTION =
  "Bet on the best Solana traders. Real markets, real payouts. No Cry Casino is a crypto KOL prediction market — stake SOL or USDC on whether a KOL finishes Top-N, and winners split the pool."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s — No Cry Casino",
  },
  description: DESCRIPTION,
  applicationName: "No Cry Casino",
  generator: "Next.js",
  keywords: [
    "No Cry Casino",
    "NOCRY",
    "Solana",
    "prediction markets",
    "KOL",
    "crypto trading",
    "SOL",
    "USDC",
    "parimutuel",
    "leaderboard",
  ],
  authors: [{ name: "No Cry Casino" }],
  creator: "No Cry Casino",
  publisher: "No Cry Casino",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-dark-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icon.svg"],
  },
  openGraph: {
    type: "website",
    siteName: "No Cry Casino",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
    images: [
      {
        url: "/apple-icon.png",
        width: 1200,
        height: 630,
        alt: "No Cry Casino — KOL Prediction Markets",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/apple-icon.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  category: "finance",
}

export const viewport: Viewport = {
  themeColor: "#050a06",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* No Cry Casino brand fonts — loaded as literal families so
            `font-family: 'Orbitron' / 'Space Grotesk' / 'JetBrains Mono'`
            resolves globally across the app (header, landing, markets UI). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <WalletProvider>{children}</WalletProvider>
        <Analytics />
      </body>
    </html>
  )
}
