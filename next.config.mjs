/** @type {import('next').NextConfig} */

// ---------------------------------------------------------------------------
// Content-Security-Policy
// ---------------------------------------------------------------------------
// Built from explicit allow-lists so production stays locked down while every
// network dependency the app genuinely uses keeps working. If you add a new
// third-party host (RPC, price feed, CDN, wallet bridge), extend the matching
// directive below rather than loosening an existing one to a bare wildcard.
//
// Browser-side network targets that matter for connect-src:
//   - Solana RPC + Helius: wallet adapter (lib/wallet.tsx), on-chain reads
//   - Supabase REST + Realtime (wss): browser client + live subscriptions
//   - CoinGecko / Jupiter price APIs (defensive; mostly called server-side)
// Wallet adapters (Phantom/Solflare/Torus) inject via the page and talk to the
// RPC endpoints above, so 'self' + the RPC hosts cover them.
const cspDirectives = {
  "default-src": ["'self'"],

  // Next.js (App Router) and Tailwind ship inline bootstrap/runtime scripts.
  // 'unsafe-inline' + 'unsafe-eval' are required for the Next runtime and the
  // Solana wallet adapter libraries to initialise in the browser.
  "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],

  // Tailwind / Next inject inline styles; styled wallet-adapter UI does too.
  "style-src": ["'self'", "'unsafe-inline'"],

  // Avatars and assets come from arbitrary https hosts + inline data URIs.
  "img-src": ["'self'", "data:", "https:", "blob:"],

  "font-src": ["'self'", "data:", "https:"],

  // The one that must not break wallet / RPC / realtime traffic.
  "connect-src": [
    "'self'",
    // Solana RPC + Helius
    "https://*.helius-rpc.com",
    "https://api.helius.xyz",
    "https://api.mainnet-beta.solana.com",
    "https://*.solana.com",
    "https://solana-api.projectserum.com",
    // Supabase (REST + Storage + Realtime websockets)
    "https://*.supabase.co",
    "wss://*.supabase.co",
    // Price feeds
    "https://api.coingecko.com",
    "https://price.jup.ag",
  ],

  // Wallet adapters and some libraries spawn web workers from blob URLs.
  "worker-src": ["'self'", "blob:"],

  // No plugins; lock down framing of this origin and what it may embed.
  "frame-src": ["'self'"],
  "frame-ancestors": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
}

const contentSecurityPolicy = Object.entries(cspDirectives)
  .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
  .join("; ")

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    // 2 years, include subdomains, eligible for the HSTS preload list.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Disable powerful features the app does not use.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
]

const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        // Apply the hardened security headers to every route.
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
