import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
