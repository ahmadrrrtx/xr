/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/ahmadrrrtx/xr/**",
      },
    ],
  },
  transpilePackages: ["framer-motion"],
};

module.exports = nextConfig;