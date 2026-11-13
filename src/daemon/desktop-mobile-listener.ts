/** Explicit desktop-only LAN companion. Phone TLS trust is enforced by its browser. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CORE_VERSION } from "../core/version.ts";
import type { DaemonState } from "./routes/router.ts";
import type { LanInput, makeHandler } from "./server.ts";
import { loadDesktopMobileIdentity } from "./desktop-mobile-cert.ts";
import { clearPairingCode, setQrRenderer, type MobileRouteDeps } from "./mobile-pairing.ts";
import { ensureVapidKeys, vapidPublicKey, sendPush, DEFAULT_TTL_SECONDS } from "./web-push.ts";

/** Limit the opt-in listener to IPv4 private, link-local and loopback peers. */
export function privateMobilePeer(address: string | undefined): boolean {
  const ip = (address ?? "").replace(/^::ffff:/i, "");
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 127 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** A positive allowlist, not the legacy broad mobile denylist. */
export function desktopMobilePathAllowed(method: string, path: string): boolean {
  if ((method === "GET" || method === "HEAD") && (path === "/mobile" || path.startsWith("/mobile/"))) return true;
  const p = path.startsWith("/api/v1/") ? `/api${path.slice(7)}` : path;
  if (method === "GET" && ["/api/meta/version", "/api/mobile/cert-fingerprint", "/api/mobile/models", "/api/mobile/budget", "/api/mobile/approvals", "/api/mobile/chats", "/api/mobile/push/vapid-pubkey"].includes(p)) return true;
  if (method === "GET" && /^\/api\/mobile\/(?:chats\/[\w.-]+\/messages|approvals\/[\w-]+)$/.test(p)) return true;
  if (method === "POST" && ["/api/mobile/pair", "/api/mobile/chats", "/api/mobile/chat", "/api/mobile/push/subscribe", "/api/mobile/push/test", "/api/voice/transcribe"].includes(p)) return true;
  if (method === "POST" && /^\/api\/mobile\/approvals\/[\w-]+$/.test(p)) return true;
  return method === "DELETE" && ["/api/mobile/session", "/api/mobile/push/subscribe"].includes(p);
}

export class DesktopMobileListener {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private runningDeps: MobileRouteDeps | null = null;
  private state: DaemonState | null = null;
  private generation = 0;
  private starting = false;
  constructor(private readonly token: string, private readonly home: string,
    private readonly createHandler: (lan: LanInput, state: DaemonState) => ReturnType<typeof makeHandler>) {}
  captureState(state: DaemonState): void { this.state = state; }
  get deps(): MobileRouteDeps | null { return this.runningDeps; }
  status(): { enabled: boolean; tlsDir: string; url?: string; fingerprint?: string } {
    const tlsDir = join(this.home, "mobile-tls");
    return this.runningDeps ? { enabled: true, tlsDir, url: this.runningDeps.ctx.lanUrl, fingerprint: this.runningDeps.ctx.fingerprint } : { enabled: false, tlsDir };
  }
  async start(host: string): Promise<ReturnType<DesktopMobileListener["status"]>> {
    if (this.server || this.starting) throw new Error("Mobile listener is already running or starting");
    if (!this.state) throw new Error("Desktop engine state is unavailable");
    const dist = process.env.XR_MOBILE_DIST;
    if (!dist || !existsSync(join(dist, "index.html"))) throw new Error("Packaged mobile assets are unavailable");
    this.starting = true;
    const generation = this.generation;
    try {
      const identity = await loadDesktopMobileIdentity(this.home, host);
      await ensureVapidKeys();
      try { const qr = await import("qrcode"); setQrRenderer((text) => qr.default.toDataURL(text)); } catch { /* manual link remains available */ }
      if (generation !== this.generation) throw new Error("Mobile listener start cancelled");
      const lan: LanInput = { cert: { ...identity, fingerprintPretty: identity.fingerprint.match(/../g)!.join(":"), sans: [identity.host] }, allowedHosts: [identity.host] };
      const handler = this.createHandler(lan, this.state);
      let authority = "";
      const server = Bun.serve({ hostname: "0.0.0.0", port: 0, tls: { cert: identity.cert, key: identity.key }, idleTimeout: 120,
        fetch: (req, peer) => {
          const url = new URL(req.url);
          if (!privateMobilePeer(peer.requestIP(req)?.address) || req.headers.has("authorization") || url.host.toLowerCase() !== authority || (req.headers.get("host") ?? "").toLowerCase() !== authority || !desktopMobilePathAllowed(req.method, url.pathname)) return new Response("not found", { status: 404 });
          return handler(req, peer);
        },
      });
      if (!server.port) { server.stop(true); throw new Error("Mobile listener did not obtain a port"); }
      authority = `${identity.host}:${server.port}`;
      lan.lanUrl = `https://${authority}`;
      this.runningDeps = { ctx: { lan: true, fingerprint: identity.fingerprint, lanUrl: lan.lanUrl, version: CORE_VERSION, daemonToken: this.token }, vapidPublicKey,
        sendTestPush: async (device) => (await sendPush(device, { title: "XR test push", body: "Push works — your phone is paired.", ts: Date.now() }, DEFAULT_TTL_SECONDS)).ok };
      this.server = server;
      return this.status();
    } finally { this.starting = false; }
  }
  stop(): void {
    this.generation++;
    clearPairingCode();
    this.runningDeps = null;
    this.server?.stop(true);
    this.server = null;
  }
}
