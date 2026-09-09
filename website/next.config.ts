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
  // Website is a subproject of the monorepo root; anchor Turbopack to it so
  // the multiple lockfiles don't confuse workspace-root inference.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
