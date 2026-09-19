import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * XR Desktop dev server.
 *
 * The shell talks to the XR engine daemon ONLY through relative /api URLs.
 * In dev, Vite proxies them to the loopback daemon and injects the bearer
 * token from XR_DEV_TOKEN (never shipped to the browser, never in code).
 * In a Tauri build the same relative calls are served by the sidecar bridge.
 *
 * =========================================================================
 * PHASE 1 · SEC-DEV-01 — THIS FILE USED TO BE AN UNAUTHENTICATED BACK DOOR
 * =========================================================================
 * Before this change the config was:
 *
 *     server: { host: "0.0.0.0", allowedHosts: true,
 *               proxy: { "/api": { target: …, configure: proxyReq.setHeader(
 *                        "Authorization", `Bearer ${XR_DEV_TOKEN}`) } } }
 *
 * with the comment "API auth stays bearer-based". It did not. The proxy
 * injected the operator's bearer token on behalf of EVERY caller, so the
 * caller never needed one. Reproduced in the Phase 0 audit:
 *
 *     curl http://127.0.0.1:5173/api/v1/audit        → 200 (full audit chain)
 *     curl http://127.0.0.1:5173/api/v1/providers    → 200 (26 providers)
 *     curl http://127.0.0.1:3141/api/v1/audit        → 401  ← the daemon is fine
 *
 * Anyone able to reach the dev port gained a fully authenticated engine
 * client: read/write workspace files, submit approvals, run the terminal.
 *
 * THE FIX, in three rules:
 *   1. LOOPBACK BY DEFAULT. Binding wider requires an explicit opt-in.
 *   2. A BROWSER NEVER GETS THE OPERATOR TOKEN. Even in expose mode the proxy
 *      authenticates with a per-run DEV SESSION TOKEN it mints itself; the
 *      operator's XR_DEV_TOKEN stays server-side.
 *   3. UNPROVEN CALLERS GET 401. In expose mode a caller must first pair by
 *      presenting the pairing code, which is printed ONLY to this process's
 *      terminal — so pairing requires local access to the machine. A remote
 *      caller cannot pair, therefore cannot reach the daemon.
 *
 * The packaged app is unaffected: it never uses this file.
 */

/**
 * Exposure mode. There is no silent middle ground:
 *   (unset)          → loopback only. Operator token injected. Default, safe.
 *   "1"              → exposed, PAIRING REQUIRED. A caller must pair using the
 *                      code printed to this terminal, which proves local
 *                      access. Use for LAN development.
 *   "trusted"        → exposed, NO pairing. Every reachable caller is treated
 *                      as the operator. Only for throwaway sandboxes whose
 *                      contents are already public and disposable. Prints a
 *                      loud warning on every boot.
 */
const EXPOSE_MODE = process.env.XR_DEV_EXPOSE ?? "";
const EXPOSE = EXPOSE_MODE === "1" || EXPOSE_MODE === "trusted";
const TRUSTED = EXPOSE_MODE === "trusted";
const PAIRING = EXPOSE && !TRUSTED;
const DAEMON = process.env.XR_DAEMON_URL ?? "http://127.0.0.1:3141";
/** Operator's engine token — server-side only, never sent to a browser. */
const OPERATOR_TOKEN = process.env.XR_DEV_TOKEN ?? null;

/** Extra Host values allowed when exposed (comma-separated). */
const EXTRA_HOSTS = (process.env.XR_DEV_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

/**
 * Host allowlist. Host validation stays ENABLED (that is the point — the old
 * `allowedHosts: true` disabled it). Exposed runs additionally permit known
 * preview/tunnel domains so a sandboxed preview works without falling back to
 * the wildcard. Override entirely with XR_DEV_HOSTS.
 */
const HOSTS = [
  "localhost",
  "127.0.0.1",
  ...(EXPOSE ? [".e2b.app", ".trycloudflare.com", ".ngrok-free.app"] : []),
  ...EXTRA_HOSTS,
];

/** Per-run pairing code + the session token issued after pairing. */
const PAIR_CODE = randomBytes(4).toString("hex");
const SESSION_TOKEN = randomBytes(32).toString("hex");
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
let sessionIssuedAt = 0;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function sessionValid(token: string | undefined): boolean {
  if (!token) return false;
  if (Date.now() - sessionIssuedAt > SESSION_TTL_MS) return false;
  return safeEqual(token, SESSION_TOKEN);
}

/**
 * The /api proxy, shared by `server` (human dev) and `preview` (the renderer
 * lane, which tests the BUILT app — the artifact that ships).
 *
 * Duplicating it would let the two drift, and a drift here is a security
 * defect (SEC-DEV-01 lived in this block).
 */
function apiProxy() {
  return {
    "/api": {
      target: DAEMON,
      changeOrigin: false,
      configure: (proxy: {
        on: (ev: string, fn: (proxyReq: { setHeader: (k: string, v: string) => void }, req: { headers: Record<string, string | string[] | undefined> }) => void) => void;
      }) => {
        proxy.on("proxyReq", (proxyReq, req) => {
          let token: string | null = OPERATOR_TOKEN;
          if (PAIRING) {
            const hdr = req.headers["x-xr-dev-session"];
            const provided = Array.isArray(hdr) ? hdr[0] : hdr;
            if (!sessionValid(provided)) token = null; // RULE 3 — unpaired callers get 401
          }
          if (token) proxyReq.setHeader("Authorization", `Bearer ${token}`);
        });
      },
    },
  };
}

export default defineConfig({
  server: {
    // RULE 1 — loopback unless explicitly exposed.
    host: EXPOSE ? "0.0.0.0" : "127.0.0.1",
    port: 5173,
    /**
     * RULE 1b — Host allowlist. `allowedHosts: true` disabled Host validation
     * entirely (DNS-rebinding friendly). We allow loopback always, plus any
     * host the developer explicitly names for a sandboxed preview/LAN.
     */
    allowedHosts: HOSTS,
    proxy: apiProxy(),
  },
  preview: {
    host: EXPOSE ? "0.0.0.0" : "127.0.0.1",
    port: 4173,
    allowedHosts: HOSTS,
    proxy: apiProxy(),
  },
  build: { outDir: "dist", sourcemap: true },
  plugins: [
    react(),
    /**
   * Dev-only pairing endpoint. Two purposes:
   *   GET  /__xr/pair?code=<PAIR_CODE>  → issues the session token (local only:
   *        the code is printed in the terminal running this dev server).
   *   GET  /__xr/pair                   → reports the current pairing state.
   * Nothing here exists in a production build.
   */
    {
      name: "xr-dev-pairing",
      configureServer(server) {
        server.middlewares.use("/__xr/pair", (req, res) => {
          const url = new URL(req.url ?? "/", "http://localhost");
          const code = url.searchParams.get("code");
          res.setHeader("Content-Type", "application/json");
          if (!code) {
            res.end(
              JSON.stringify({
                exposed: EXPOSE,
                mode: TRUSTED ? "trusted" : PAIRING ? "pairing" : "loopback",
                paired: TRUSTED || sessionValid(url.searchParams.get("session") ?? undefined),
              }),
            );
            return;
          }
          if (TRUSTED) {
            // Trusted mode never issues sessions; report the mode honestly.
            res.end(JSON.stringify({ mode: "trusted", session: null, note: "no pairing in trusted mode" }));
            return;
          }
          if (!safeEqual(code, PAIR_CODE)) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: "invalid pairing code" }));
            return;
          }
          sessionIssuedAt = Date.now();
          res.end(JSON.stringify({ session: SESSION_TOKEN, ttlMs: SESSION_TTL_MS }));
        });
      },
    },
  ],
});

/* --------------------------------------------------------------------------
 * Startup banner. The pairing code is printed ONLY here — to the developer's
 * terminal — which is what makes pairing a proof of local access.
 * ------------------------------------------------------------------------ */
if (TRUSTED) {
  // eslint-disable-next-line no-console
  console.warn(
    [
      "",
      "  ⚠⚠  XR DEV SERVER EXPOSED IN TRUSTED MODE (XR_DEV_EXPOSE=trusted)",
      "      ANY caller that can reach this port IS the operator: full engine",
      "      access — file writes, approvals, terminal. Intended ONLY for",
      "      disposable sandboxes whose contents are already public.",
      `      allowed hosts: ${HOSTS.join(", ")}`,
      "      Do NOT use this on a network you do not fully control.",
      "",
    ].join("\n"),
  );
} else if (PAIRING) {
  // eslint-disable-next-line no-console
  console.warn(
    [
      "",
      "  ⚠  XR DEV SERVER EXPOSED BEYOND LOOPBACK — PAIRING REQUIRED",
      "     · /api returns 401 until a client pairs",
      "     · the engine bearer token is never sent to a browser",
      `     · pair once:  curl 'http://<this-host>:5173/__xr/pair?code=${PAIR_CODE}'`,
      `     · allowed hosts: ${HOSTS.join(", ")}`,
      "     · the pairing code is printed here only — that is what proves local access",
      "",
    ].join("\n"),
  );
}
