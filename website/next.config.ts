import type { NextConfig } from "next";

import { site } from "./src/lib/site";

const isProd = process.env.NODE_ENV === "production";

/**
 * Phase 31 · A9/A6/A7 — security headers for every response, plus a
 * same-site-only CORS posture for any future API route.
 *
 * The CSP keeps Next's own runtime working — an inline bootstrap script
 * and inline `<style>` tags are how the framework ships hydration — so
 * `script-src`/`style-src` allow `'unsafe-inline'` on `'self'` only, and
 * `'unsafe-eval'` exists solely outside production (the dev bundler
 * needs it; a production build never evaluates). `img-src` permits
 * remote `https:` images because `images.remotePatterns` below is an
 * explicit, pre-existing product decision to render operator-supplied
 * artwork; nothing is widened beyond what the site already loads.
 * HSTS is production-only so local/LAN development over plain HTTP is
 * never poisoned by a cached upgrade.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  // A7 — never ship browser source maps in production builds.
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // A6 — if API routes are added they answer only to this site's
        // own origin, never `*`. Inert while no `/api` route exists.
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: site.url },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
          { key: "Vary", value: "Origin" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  /**
   * Development origins.
   *
   * Next refuses to serve its dev-only resources (the HMR client, the dev
   * bootstrap) to a host it does not recognise — a real protection, since a dev
   * server binds to every interface. The consequence when it misfires is silent
   * and expensive: every page still returns 200 and renders, the chunks still
   * download, and **nothing hydrates**, so a client-rendered screen sits on its
   * server fallback forever with no error in the console.
   *
   * That is exactly what happened while capturing the Phase 30 screenshots: the
   * browser loaded the console from `127.0.0.1:3000` while the dev server's
   * origin was `localhost:3000`, the dev bootstrap was refused, and nine console
   * pages photographed as "Loading console…".
   *
   * The allowlist is therefore explicit and narrow: loopback by both names, plus
   * the sandbox preview hosts this repository is developed and reviewed behind.
   * It has no effect on a production build, which serves no dev resources at all.
   */
  allowedDevOrigins: ["localhost", "127.0.0.1", "[::1]", "*.e2b.app", "*.arena.ai"],
};

export default nextConfig;
