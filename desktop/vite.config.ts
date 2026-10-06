import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type ProxyOptions } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));

/*
 * XR Desktop dev server (Phase 14 — real engine).
 *
 * The app talks to the XR engine daemon ONLY through relative `/api/v1` URLs.
 * In dev, Vite proxies them to the loopback daemon and attaches the engine's
 * bearer token server-side; the token never reaches the browser bundle. In the
 * packaged app the same relative calls resolve to the paired sidecar
 * (src/engine/transport.ts) and this file is not involved.
 *
 * Token source (checked per request, so an engine restart — which mints a new
 * token — needs no Vite restart):
 *   XR_DEV_TOKEN        the token itself
 *   XR_DEV_TOKEN_FILE   a file holding it (default: desktop/.xr-dev/token,
 *                       written by `bun run engine`)
 *
 * Exposure (SEC-DEV-01, carried over from the previous generation). A proxy
 * that injects the operator's token for EVERY caller is an unauthenticated
 * engine for anyone who can reach the dev port, so:
 *   (unset)   loopback only — token injected. Default.
 *   "1"       exposed, PAIRING REQUIRED: a caller must present the code printed
 *             to this terminal once (`#pair=<code>` in the URL) and then holds
 *             a per-run session token; the operator token stays server-side.
 *   "trusted" exposed, no pairing — only for disposable sandboxes. Loud warning.
 */
const EXPOSE_MODE = process.env.XR_DEV_EXPOSE ?? '';
const EXPOSE = EXPOSE_MODE === '1' || EXPOSE_MODE === 'trusted';
const PAIRING = EXPOSE && EXPOSE_MODE !== 'trusted';
const DAEMON = process.env.XR_DAEMON_URL ?? 'http://127.0.0.1:3141';
const TOKEN_FILE = process.env.XR_DEV_TOKEN_FILE ?? resolve(projectRoot, '.xr-dev/token');

function operatorToken(): string | null {
  if (process.env.XR_DEV_TOKEN) return process.env.XR_DEV_TOKEN;
  try {
    if (existsSync(TOKEN_FILE)) {
      const t = readFileSync(TOKEN_FILE, 'utf8').trim();
      if (t) return t;
    }
  } catch {
    /* unreadable token file — treated as absent */
  }
  return null;
}

const PAIR_CODE = randomBytes(4).toString('hex');
const SESSION_TOKEN = randomBytes(32).toString('hex');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
let sessionIssuedAt = 0;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function sessionValid(token: string | undefined): boolean {
  if (!token || Date.now() - sessionIssuedAt > SESSION_TTL_MS) return false;
  return safeEqual(token, SESSION_TOKEN);
}

if (EXPOSE) {
  if (PAIRING) {
    console.log(`\n[xr-dev] exposed with pairing — open the app with #pair=${PAIR_CODE} once from a browser you trust.\n`);
  } else {
    console.warn('\n[xr-dev] WARNING: XR_DEV_EXPOSE=trusted — every caller that reaches this port is treated as the operator.\n');
  }
}

/** `/api` → engine, bearer attached server-side (shared by `server` and `preview`). */
function apiProxy(): Record<string, ProxyOptions> {
  return {
    '/api': {
      target: DAEMON,
      changeOrigin: false,
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq, req) => {
          let token = operatorToken();
          if (PAIRING) {
            const hdr = req.headers['x-xr-dev-session'];
            const provided = Array.isArray(hdr) ? hdr[0] : hdr;
            if (!sessionValid(provided)) token = null; // unpaired callers get the engine's 401
          }
          if (token) proxyReq.setHeader('Authorization', `Bearer ${token}`);
        });
        proxy.on('error', (_err, _req, res) => {
          // The engine is down: answer like an unreachable host, not a Vite 500 page.
          const r = res as { headersSent?: boolean; writeHead?: (c: number, h: Record<string, string>) => void; end?: (b: string) => void };
          if (r.writeHead && !r.headersSent) {
            r.writeHead(503, { 'Content-Type': 'application/json', 'x-xr-proxy': 'engine-unreachable' });
            r.end?.(JSON.stringify({ error: 'engine unreachable', engineDown: true }));
          }
        });
      },
    },
  };
}

type DevReq = { url?: string; method?: string; headers: Record<string, string | string[] | undefined> };
type DevRes = { setHeader: (k: string, v: string) => void; statusCode: number; end: (b: string) => void };

/** Is this caller the operator? Loopback mode: always. Pairing: valid session. */
function callerTrusted(req: DevReq): boolean {
  if (!PAIRING) return true;
  const hdr = req.headers['x-xr-dev-session'];
  return sessionValid(Array.isArray(hdr) ? hdr[0] : hdr);
}

let engineChild: ReturnType<typeof spawn> | null = null;

/**
 * `POST /__xr/engine/start` — the banner's "Start engine" button in dev.
 * Launches `bun run scripts/dev-engine.ts` (which writes the token file the
 * proxy reads) detached from the Vite process. Idempotent while it runs.
 */
function startDevEngine(): { started: boolean; reason?: string } {
  if (engineChild && engineChild.exitCode === null) return { started: true, reason: 'already running' };
  if (!existsSync(resolve(projectRoot, '..', 'src', 'index.ts'))) {
    return { started: false, reason: 'engine sources not found next to desktop/ (packaged builds use the sidecar)' };
  }
  try {
    engineChild = spawn('bun', ['run', resolve(projectRoot, 'scripts', 'dev-engine.ts')], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env, NO_COLOR: '1' },
    });
    engineChild.on('exit', () => {
      engineChild = null;
    });
    return { started: true };
  } catch (e) {
    return { started: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Dev-only endpoints under `/__xr/*`: pairing (inert unless exposed) + engine start. */
function pairingPlugin() {
  return {
    name: 'xr-dev-pairing',
    configureServer(server: { middlewares: { use: (fn: (req: DevReq, res: DevRes, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/__xr/engine/start')) {
          res.setHeader('Content-Type', 'application/json');
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'POST only' }));
            return;
          }
          if (!callerTrusted(req)) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: 'not paired' }));
            return;
          }
          const r = startDevEngine();
          res.statusCode = r.started ? 200 : 500;
          res.end(JSON.stringify(r));
          return;
        }
        if (!req.url?.startsWith('/__xr/pair')) return next();
        res.setHeader('Content-Type', 'application/json');
        const code = new URL(req.url, 'http://x').searchParams.get('code');
        if (!PAIRING) {
          res.end(JSON.stringify({ mode: EXPOSE ? 'trusted' : 'loopback', paired: true }));
          return;
        }
        if (code === null) {
          res.end(JSON.stringify({ mode: 'pairing', paired: false }));
          return;
        }
        if (safeEqual(code, PAIR_CODE)) {
          sessionIssuedAt = Date.now();
          res.end(JSON.stringify({ session: SESSION_TOKEN }));
          return;
        }
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'bad pairing code' }));
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), pairingPlugin()],
  // Never watch Rust build artifacts (src-tauri/target can hold 40k+ files
  // after a cargo build and exhausts inotify watchers).
  watch: {
    ignored: ['**/src-tauri/**'],
  },
  // Tauri expects a fixed dev port (see src-tauri/tauri.conf.json > app.windows > devUrl)
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: EXPOSE ? '0.0.0.0' : '127.0.0.1',
    // Host validation stays on; sandbox previews (*.e2b.app) are allowed by suffix.
    allowedHosts: ['localhost', '127.0.0.1', '.e2b.app'],
    proxy: apiProxy(),
  },
  preview: {
    port: 4173,
    host: EXPOSE ? '0.0.0.0' : '127.0.0.1',
    allowedHosts: ['localhost', '127.0.0.1', '.e2b.app'],
    proxy: apiProxy(),
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Multi-page: the main app AND the HUD palette window (Phase 5) —
    // tauri.conf.json's hud window loads dist/hud.html.
    rollupOptions: {
      input: {
        main: resolve(projectRoot, 'index.html'),
        hud: resolve(projectRoot, 'hud.html'),
        orb: resolve(projectRoot, 'orb.html'),
      },
    },
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'oxc' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src'),
    },
  },
});
