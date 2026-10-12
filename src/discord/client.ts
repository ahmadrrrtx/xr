/**
 * XR — Discord transport: REST over fetch + the gateway over a WebSocket.
 *
 * Why not discord.js: XR needs five REST calls and four gateway events. A
 * structure library would add megabytes of caches and builders the bot never
 * touches, and it would own the reconnect policy this file has to get right
 * anyway. The token is never logged: every log line is filtered through
 * `redact`, and the raw gateway frames are never printed.
 *
 * Two things are injected so tests need no network:
 *   · `fetchFn`   — REST calls
 *   · `wsFactory` — the gateway socket (Bun's global WebSocket by default)
 *
 * Both a fake socket (unit tests) and a real local WebSocket server
 * (integration test) drive this class.
 */
import type { DiscordApplication, DiscordChannel, DiscordGuildSummary, DiscordMessage, DiscordUser } from "./types.ts";
import { CALLBACK_FLAG, CALLBACK_TYPE, CLOSE_FATAL_AUTH, INTENTS, OP, REQUIRED_INTENTS } from "./types.ts";
import type { DiscordOutgoing } from "./render.ts";

export const API_BASE = "https://discord.com/api/v10";
export const GATEWAY_FALLBACK = "wss://gateway.discord.gg";
const USER_AGENT = "DiscordBot (https://github.com/ahmadrrrtx/xr, 1.0.0)";

/** The slice of the WebSocket API this client uses. */
export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WsFactory = (url: string) => WsLike;

export interface GatewayState {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "resuming" | "stopped";
  latencyMs: number | null;
  /** Last close code seen (diagnostics). */
  lastCloseCode: number | null;
  sessionActive: boolean;
}

export interface DiscordClientOptions {
  token: string;
  /** Dispatched gateway events (MESSAGE_CREATE, INTERACTION_CREATE, READY…). */
  onDispatch: (event: string, data: any, seq: number | null) => void | Promise<void>;
  onLog?: (line: string) => void;
  onState?: (state: GatewayState) => void;
  /** Non-retryable failure (bad token). */
  onFatal?: (reason: string) => void;
  /** Persisted gateway session, so a restart resumes instead of re-identifying. */
  session?: { id: string | null; url: string | null; seq: number | null };
  onSession?: (patch: { id?: string | null; url?: string | null; seq?: number | null }) => void;
  fetchFn?: typeof fetch;
  wsFactory?: WsFactory;
  intents?: number;
  /** Presence text shown while online. */
  presence?: string;
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  heartbeatMs?: number;
  /** REST retries for 429/5xx before giving up. */
  maxRestRetries?: number;
}

interface GatewayFrame {
  op: number;
  d?: any;
  s?: number | null;
  t?: string | null;
}

export class DiscordClient {
  private readonly f: typeof fetch;
  private readonly wsFactory: WsFactory;
  private ws: WsLike | null = null;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private identifyAttempts = 0;
  private awaitingAck = false;
  private seq: number | null;
  private sessionId: string | null;
  private resumeUrl: string | null;
  private gatewayUrl: string | null = null;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private state: GatewayState = { status: "idle", latencyMs: null, lastCloseCode: null, sessionActive: false };
  private lastBeatAt = 0;

  constructor(private readonly opts: DiscordClientOptions) {
    this.f = opts.fetchFn ?? fetch;
    this.wsFactory = opts.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as WsLike);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
    this.seq = opts.session?.seq ?? null;
    this.sessionId = opts.session?.id ?? null;
    this.resumeUrl = opts.session?.url ?? null;
  }

  // ── logging ──────────────────────────────────────────────────────────────

  /** Strip the token and anything token-shaped before it reaches a log. */
  private redact(line: string): string {
    const token = this.opts.token;
    let out = token ? line.split(token).join("<redacted>") : line;
    out = out.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}/g, "<redacted>");
    return out;
  }

  private log(line: string): void {
    this.opts.onLog?.(this.redact(line));
  }

  private setState(patch: Partial<GatewayState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onState?.(this.state);
  }

  get gatewayState(): GatewayState {
    return this.state;
  }

  // ── REST ─────────────────────────────────────────────────────────────────

  /**
   * One REST call. 429 is honoured properly (Discord returns `retry_after` in
   * seconds, globally or per route); 5xx backs off. Returns null for 204.
   */
  async rest<T = any>(
    method: string,
    path: string,
    body?: unknown,
    opts: { auth?: boolean; retries?: number; interactionToken?: boolean } = {},
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const maxRetries = opts.retries ?? this.opts.maxRestRetries ?? 4;
    let attempt = 0;
    for (;;) {
      const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/json" };
      if (opts.auth !== false) headers.authorization = `Bot ${this.opts.token}`;
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await this.f(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        if (attempt >= maxRetries) {
          this.log(`rest ${method} ${path} gave up after ${attempt} retries (${res.status})`);
          return null as T;
        }
        const retryAfter = await this.retryAfterMs(res);
        attempt += 1;
        this.log(`rest ${method} ${path} rate-limited; waiting ${retryAfter} ms`);
        await this.sleep(retryAfter);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        const text = await res.text().catch(() => "");
        this.log(`rest ${method} ${path} → ${res.status}`);
        throw new DiscordRestError(res.status, text.slice(0, 200));
      }
      if (res.status === 204) return null as T;
      const text = await res.text().catch(() => "");
      if (!res.ok) throw new DiscordRestError(res.status, text.slice(0, 200));
      if (!text) return null as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return null as T;
      }
    }
  }

  private async retryAfterMs(res: Response): Promise<number> {
    const header = res.headers.get("retry-after");
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.max(250, seconds * 1000));
    }
    const body = (await res.json().catch(() => null)) as { retry_after?: number } | null;
    const seconds = Number(body?.retry_after ?? 1);
    return Math.min(60_000, Math.max(250, (Number.isFinite(seconds) ? seconds : 1) * 1000));
  }

  getApplication(): Promise<DiscordApplication | null> {
    return this.rest<DiscordApplication>("GET", "/applications/@me");
  }

  getBotUser(): Promise<DiscordUser | null> {
    return this.rest<DiscordUser>("GET", "/users/@me");
  }

  async getGatewayUrl(): Promise<string> {
    try {
      const res = await this.rest<{ url?: string }>("GET", "/gateway/bot");
      if (res?.url) return res.url;
    } catch {
      /* fall through to the documented default */
    }
    return GATEWAY_FALLBACK;
  }

  registerCommands(applicationId: string, commands: unknown, guildId?: string): Promise<unknown> {
    const path = guildId
      ? `/applications/${applicationId}/guilds/${guildId}/commands`
      : `/applications/${applicationId}/commands`;
    return this.rest("PUT", path, commands);
  }

  listGuilds(): Promise<DiscordGuildSummary[] | null> {
    return this.rest<DiscordGuildSummary[]>("GET", "/users/@me/guilds");
  }

  listGuildChannels(guildId: string): Promise<DiscordChannel[] | null> {
    return this.rest<DiscordChannel[]>("GET", `/guilds/${encodeURIComponent(guildId)}/channels`);
  }

  getChannel(channelId: string): Promise<DiscordChannel | null> {
    return this.rest<DiscordChannel>("GET", `/channels/${encodeURIComponent(channelId)}`);
  }

  /** Send a message. Components/embeds are attached when the renderer used them. */
  async sendMessage(channelId: string, msg: DiscordOutgoing): Promise<DiscordMessage | null> {
    const body: Record<string, unknown> = { allowed_mentions: { parse: [] } };
    if (msg.content) body.content = msg.content;
    if (msg.embeds?.length) body.embeds = msg.embeds;
    if (msg.components?.length) body.components = msg.components;
    if (msg.replyToMessageId) body.message_reference = { message_id: msg.replyToMessageId, fail_if_not_exists: false };
    if (!body.content && !body.embeds) body.content = "…";
    return this.rest<DiscordMessage>("POST", `/channels/${encodeURIComponent(channelId)}/messages`, body);
  }

  /**
   * Edit a message. XR only edits approval messages, and an edit always clears
   * the buttons so a resolved approval cannot be clicked twice.
   */
  async editMessage(channelId: string, messageId: string, text: string): Promise<void> {
    await this.rest("PATCH", `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, {
      content: text,
      embeds: [],
      components: [],
    });
  }

  triggerTyping(channelId: string): Promise<void> {
    return this.rest("POST", `/channels/${encodeURIComponent(channelId)}/typing`).then(() => undefined);
  }

  /** Answer a slash command: defer first (Discord requires a 3-second ack). */
  deferInteraction(interactionId: string, token: string, ephemeral: boolean): Promise<void> {
    const type = CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE;
    return this.rest("POST", `/interactions/${interactionId}/${token}/callback`, {
      type,
      data: ephemeral ? { flags: 64 } : {},
    }).then(() => undefined);
  }

  /**
   * Respond to an interaction straight away.
   *   · "message" → a new reply (ephemeral when asked)
   *   · "update"  → replace the message the component lives on
   */
  respondInteraction(
    interactionId: string,
    token: string,
    msg: DiscordOutgoing & { ephemeral?: boolean },
    kind: "message" | "update",
  ): Promise<void> {
    const data: Record<string, unknown> = {};
    if (msg.content) data.content = msg.content;
    if (msg.embeds?.length) data.embeds = msg.embeds;
    if (msg.components?.length) data.components = msg.components;
    if (!data.content && !data.embeds) data.content = "…";
    if (kind === "message" && msg.ephemeral) data.flags = CALLBACK_FLAG.EPHEMERAL;
    return this.rest("POST", `/interactions/${interactionId}/${token}/callback`, {
      type: kind === "update" ? CALLBACK_TYPE.UPDATE_MESSAGE : CALLBACK_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
      data,
    }).then(() => undefined);
  }

  /** Replace the deferred original response (the streamed answer). */
  async editInteractionOriginal(
    applicationId: string,
    token: string,
    msg: DiscordOutgoing,
  ): Promise<void> {
    const body: Record<string, unknown> = { allowed_mentions: { parse: [] } };
    if (msg.content) body.content = msg.content;
    if (msg.embeds) body.embeds = msg.embeds;
    if (msg.components) body.components = msg.components;
    if (msg.content == null && !msg.embeds) body.content = "…";
    await this.rest("PATCH", `/webhooks/${applicationId}/${token}/messages/@original`, body, { auth: false });
  }

  /** A private follow-up (ephemeral) in the same interaction context. */
  async interactionFollowUp(
    applicationId: string,
    token: string,
    msg: DiscordOutgoing & { ephemeral?: boolean },
  ): Promise<void> {
    const body: Record<string, unknown> = { allowed_mentions: { parse: [] } };
    if (msg.content) body.content = msg.content;
    if (msg.embeds) body.embeds = msg.embeds;
    if (msg.components) body.components = msg.components;
    if (msg.ephemeral) body.flags = 64;
    await this.rest("POST", `/webhooks/${applicationId}/${token}`, body, { auth: false });
  }

  // ── gateway ──────────────────────────────────────────────────────────────

  /** Open the gateway and keep it open until `disconnect()`. */
  async connect(): Promise<void> {
    this.stopped = false;
    this.gatewayUrl = await this.getGatewayUrl();
    await this.openSocket();
  }

  private async openSocket(): Promise<void> {
    if (this.stopped) return;
    const base = this.resumeUrl ?? this.gatewayUrl ?? GATEWAY_FALLBACK;
    const url = `${base.replace(/\/+$/, "")}/?v=10&encoding=json`;
    const resuming = Boolean(this.sessionId && this.seq != null);
    this.setState({ status: resuming ? "resuming" : "connecting" });

    let ws: WsLike;
    try {
      ws = this.wsFactory(url);
    } catch (err) {
      this.log(`gateway socket failed: ${(err as Error).message}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onmessage = (ev) => void this.onFrame(String((ev as { data: unknown }).data ?? ""));
    ws.onerror = () => this.log("gateway socket error");
    ws.onclose = (ev) => this.onClose(ev?.code ?? null);
  }

  private async onFrame(raw: string): Promise<void> {
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(raw) as GatewayFrame;
    } catch {
      return;
    }
    switch (frame.op) {
      case OP.HELLO: {
        const interval = Number(frame.d?.heartbeat_interval ?? 41_250);
        this.startHeartbeat(this.opts.heartbeatMs ?? interval);
        this.identifyAttempts = 0;
        if (this.sessionId && this.seq != null) {
          this.send(OP.RESUME, { token: this.opts.token, session_id: this.sessionId, seq: this.seq });
        } else {
          this.identify();
        }
        return;
      }
      case OP.HEARTBEAT_ACK: {
        this.awaitingAck = false;
        this.setState({ latencyMs: Date.now() - this.lastBeatAt });
        return;
      }
      case OP.HEARTBEAT: {
        this.send(OP.HEARTBEAT, this.seq);
        return;
      }
      case OP.RECONNECT: {
        this.log("gateway asked for a reconnect");
        this.reconnect();
        return;
      }
      case OP.INVALID_SESSION: {
        const resumable = Boolean(frame.d);
        if (!resumable) {
          this.sessionId = null;
          this.seq = null;
          this.resumeUrl = null;
          this.opts.onSession?.({ id: null, url: null, seq: null });
        }
        const wait = 1000 + Math.floor(this.random() * 4000);
        await this.sleep(wait);
        this.reconnect();
        return;
      }
      case OP.DISPATCH: {
        if (typeof frame.s === "number") {
          this.seq = frame.s;
          this.opts.onSession?.({ seq: frame.s });
        }
        const name = String(frame.t ?? "");
        if (name === "READY") {
          const d = frame.d ?? {};
          this.sessionId = String(d.session_id ?? "") || null;
          this.resumeUrl = String(d.resume_gateway_url ?? "") || null;
          this.setState({ status: "connected", sessionActive: true, lastCloseCode: null });
          this.opts.onSession?.({ id: this.sessionId, url: this.resumeUrl, seq: this.seq });
          this.log("gateway ready");
        }
        if (name === "RESUMED") {
          this.setState({ status: "connected", sessionActive: true });
          this.log("gateway resumed");
        }
        if (process.env.XR_DISCORD_DEBUG) this.log(`dispatch ${name}`);
        if (name) await this.opts.onDispatch(name, frame.d, this.seq);
        return;
      }
      default:
        return;
    }
  }

  private identify(): void {
    this.send(OP.IDENTIFY, {
      token: this.opts.token,
      intents: this.opts.intents ?? REQUIRED_INTENTS,
      properties: { os: process.platform, browser: "xr", device: "xr" },
      presence: {
        since: null,
        afk: false,
        status: "online",
        activities: [{ name: this.opts.presence ?? "XR · running on your machine", type: 0 }],
      },
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    const beat = () => {
      if (this.stopped) return;
      if (this.awaitingAck) {
        // The gateway never acknowledged the previous beat: the socket is a
        // zombie. Discord's own guidance is to close and resume.
        this.log("gateway heartbeat missed; reconnecting");
        this.reconnect();
        return;
      }
      this.awaitingAck = true;
      this.lastBeatAt = Date.now();
      this.send(OP.HEARTBEAT, this.seq);
      this.heartbeat = setTimeout(beat, intervalMs);
    };
    // First beat after jitter, as the gateway asks.
    const jitter = Math.floor(this.random() * intervalMs);
    this.heartbeat = setTimeout(beat, jitter);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.heartbeat = null;
  }

  private send(op: number, d: unknown): void {
    try {
      this.ws?.send(JSON.stringify(d === undefined ? { op, d: null } : { op, d }));
    } catch (err) {
      this.log(`gateway send failed: ${(err as Error).message}`);
    }
  }

  private reconnect(): void {
    this.closeSocket();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.identifyAttempts += 1;
    const backoff = Math.min(30_000, 1000 * 2 ** Math.min(this.identifyAttempts, 5));
    const wait = backoff * (0.8 + this.random() * 0.4);
    this.setState({ status: "reconnecting" });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket();
    }, Math.floor(wait));
  }

  private onClose(code: number | null): void {
    this.ws = null;
    this.stopHeartbeat();
    this.setState({ lastCloseCode: code ?? null, sessionActive: false });
    if (this.stopped) {
      this.setState({ status: "stopped" });
      return;
    }
    if (code === CLOSE_FATAL_AUTH) {
      this.stopped = true;
      this.setState({ status: "stopped" });
      this.opts.onFatal?.("Discord rejected the bot token. Paste a new token in Integrations.");
      return;
    }
    // Codes 4000-4003/4005-4009 mean the session is gone: reconnect (Discord
    // expects RESUME first, then IDENTIFY when the session is invalid).
    if (code === 4007 || code === 4009) {
      this.sessionId = null;
      this.seq = null;
      this.resumeUrl = null;
      this.opts.onSession?.({ id: null, url: null, seq: null });
    }
    this.log(`gateway closed (${code ?? "no code"})`);
    this.scheduleReconnect();
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onopen = null;
      ws.close(1000, "xr reconnect");
    } catch {
      /* already gone */
    }
  }

  /** Stop the gateway for good (daemon shutdown or Stop in the UI). */
  disconnect(): void {
    this.stopped = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.closeSocket();
    this.setState({ status: "stopped" });
  }
}

export class DiscordRestError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`Discord API ${status}: ${detail || "request failed"}`);
    this.name = "DiscordRestError";
  }
}

/** Intents XR requests, exported for the status view and docs. */
export { INTENTS, REQUIRED_INTENTS };
