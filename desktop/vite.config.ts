import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * XR Desktop dev server.
 *
 * The shell talks to the XR engine daemon ONLY through relative /api URLs.
 * In dev, Vite proxies them to the loopback daemon and injects the bearer
 * token from XR_DEV_TOKEN (never shipped to the browser, never in code).
 * In a Tauri build the same relative calls are served by the sidecar bridge.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // preview/remote dev hosts (sandboxed previews, LAN); API auth stays bearer-based
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.XR_DAEMON_URL ?? "http://127.0.0.1:3141",
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            const token = process.env.XR_DEV_TOKEN;
            if (token) proxyReq.setHeader("Authorization", `Bearer ${token}`);
          });
        },
      },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
