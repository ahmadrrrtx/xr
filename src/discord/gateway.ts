/**
 * XR — Discord gateway client (Phase 26).
 *
 * A small WebSocket client for the Discord gateway (JSON encoding, API v10):
 * IDENTIFY, heartbeats with jitter, zombie detection, RESUME after a dropped
 * connection, and reconnect backoff. Fatal close codes (bad token, disallowed
 * intents) stop the client instead of retrying forever.
 *
 * The WebSocket constructor is injected so tests can run against a local server.
 */
import { DiscordReady, FATAL_CLOSE_CODES } from "./types.ts";

/** The subset of the WebSocket API the client uses. */
export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: any) => void): void;
}

export type WsCtor = new (url: string) => WsLike;

export type GatewayStatus = "connecting" | "ready" | "reconnecting" | "stopped" | "fatal";

export interface GatewayOptions {
  token: string;
  intents: number;
  /** Base gateway URL from GET /gateway/bot. Query params are added here. */
  url: string;
  WebSocketCtor?: WsCtor;
  onReady: (d: DiscordReady) => void;
  onDispatch: (type: string, data: unknown) => void;
  onStatus: (s: GatewayStatus, detail?: string) => void;
  /** Injected for tests; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => unknown;
  random?: () => number;
}

const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 } as const;

export class DiscordGateway {
  private ws: WsLike | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private heartbeatTimer: unknown = null;
  private heartbeatMs = 0;
  private ackPending = false;
  private stopped = true;
  private backoffMs = 1000;
  private reconnectTimer: unknown = null;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly random: () => number;

  constructor(private readonly opts: GatewayOptions) {
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.random = opts.random ?? Math.random;
  }

  start(): void {
    this.stopped = false;
    this.opts.onStatus("connecting");
    this.open(this.opts.url);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    try {
      this.ws?.close(1000, "xr stop");
    } catch {
      // Already closed.
    }
    this.ws = null;
    this.opts.onStatus("stopped");
  }

  private open(baseUrl: string): void {
    const base = this.sessionId && this.resumeUrl ? this.resumeUrl : baseUrl;
    const url = `${base}${base.includes("?") ? "&" : "?"}v=10&encoding=json`;
    const Ctor: WsCtor = this.opts.WebSocketCtor ?? (globalThis.WebSocket as unknown as WsCtor);
    const ws = new Ctor(url);
    this.ws = ws;
    // Events from a socket we already replaced must not touch the live one.
    ws.addEventListener("message", (ev) => {
      if (this.ws === ws) this.onMessage(ev);
    });
    ws.addEventListener("close", (ev) => {
      if (this.ws === ws) this.onClose(ev.code ?? 1006);
    });
    ws.addEventListener("error", () => {
      // A failed connection also emits close; reconnect is handled there.
    });
  }

  private onMessage(ev: { data: unknown }): void {
    if (this.stopped) return;
    let frame: { op: number; t?: string | null; s?: number | null; d?: unknown };
    try {
      frame = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (typeof frame.s === "number") this.seq = frame.s;
    switch (frame.op) {
      case OP.HELLO: {
        const interval = Number((frame.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 41250);
        this.startHeartbeat(interval);
        if (this.sessionId && this.seq !== null) this.send(OP.RESUME, { token: this.opts.token, session_id: this.sessionId, seq: this.seq });
        else this.send(OP.IDENTIFY, this.identifyPayload());
        return;
      }
      case OP.HEARTBEAT:
        this.beat();
        return;
      case OP.HEARTBEAT_ACK:
        this.ackPending = false;
        this.backoffMs = 1000;
        return;
      case OP.RECONNECT:
        this.dropAndReconnect(4000);
        return;
      case OP.INVALID_SESSION: {
        const resumable = frame.d === true;
        if (!resumable) {
          this.sessionId = null;
          this.resumeUrl = null;
          this.seq = null;
        }
        this.scheduleReconnect(1000 + Math.floor(this.random() * 4000));
        this.dropAndReconnect(4000, false);
        return;
      }
      case OP.DISPATCH:
        this.onDispatch(frame.t ?? "", frame.d);
        return;
    }
  }

  private onDispatch(type: string, data: unknown): void {
    if (type === "READY") {
      const ready = data as DiscordReady;
      this.sessionId = ready.session_id;
      this.resumeUrl = ready.resume_gateway_url;
      this.opts.onReady(ready);
      this.opts.onStatus("ready");
      return;
    }
    if (type === "RESUMED") {
      this.opts.onStatus("ready", "resumed");
      return;
    }
    this.opts.onDispatch(type, data);
  }

  private onClose(code: number): void {
    this.clearHeartbeat();
    this.ws = null;
    if (this.stopped) return;
    if (FATAL_CLOSE_CODES.has(code)) {
      this.stopped = true;
      this.opts.onStatus("fatal", closeReason(code));
      return;
    }
    // Some codes invalidate the session: the next connect must IDENTIFY.
    if (code === 4007 || code === 4009) {
      this.sessionId = null;
      this.resumeUrl = null;
      this.seq = null;
    }
    this.scheduleReconnect(this.backoffMs);
  }

  private scheduleReconnect(ms: number): void {
    if (this.reconnectTimer) return;
    this.opts.onStatus("reconnecting", `retry in ${Math.round(ms / 1000)}s`);
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
      this.open(this.opts.url);
    }, ms);
  }

  private dropAndReconnect(code: number, scheduleNow = true): void {
    this.clearHeartbeat();
    try {
      this.ws?.close(code, "reconnect");
    } catch {
      // Ignore: the close handler will not run for an already-dead socket.
    }
    this.ws = null;
    if (scheduleNow && !this.stopped) this.scheduleReconnect(this.backoffMs);
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeatMs = intervalMs;
    this.ackPending = false;
    const tick = () => {
      if (this.stopped) return;
      if (this.ackPending) {
        // No ACK since the last beat: the connection is a zombie. Reconnect and resume.
        this.dropAndReconnect(4000);
        return;
      }
      this.beat();
      this.heartbeatTimer = this.schedule(tick, this.heartbeatMs);
    };
    this.heartbeatTimer = this.schedule(tick, Math.floor(intervalMs * this.random()));
  }

  private beat(): void {
    this.ackPending = true;
    this.send(OP.HEARTBEAT, this.seq);
  }

  private identifyPayload() {
    return {
      token: this.opts.token,
      intents: this.opts.intents,
      properties: { os: "linux", browser: "xr", device: "xr" },
      presence: {
        status: "online",
        afk: false,
        activities: [{ name: "Custom Status", type: 4, state: "XR · running on your machine" }],
      },
    };
  }

  private send(op: number, d: unknown): void {
    try {
      this.ws?.send(JSON.stringify({ op, d }));
    } catch {
      // The close handler owns recovery.
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer as ReturnType<typeof setTimeout>);
    this.heartbeatTimer = null;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer as ReturnType<typeof setTimeout>);
    this.reconnectTimer = null;
  }
}

function closeReason(code: number): string {
  switch (code) {
    case 4004:
      return "Discord rejected the bot token. Paste a new token in Integrations.";
    case 4014:
      return "Discord refused the message-content intent. Enable it in the Developer Portal, then reconnect.";
    default:
      return `Discord closed the gateway connection (${code}).`;
  }
}
