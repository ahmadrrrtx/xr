/**
 * Minimal client for the XR daemon's HTTP API.
 *
 * Every request goes to the configured loopback origin with the bearer token.
 * Errors carry the HTTP status and the daemon's own error text, never the
 * token. The chat stream is parsed into typed events; unknown frames are
 * dropped rather than trusted.
 */

import { createSseParser } from "./sse";

export class DaemonHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DaemonHttpError";
  }
}

export type ChatEvent =
  | { kind: "status"; status: string; provider?: string; model?: string; message?: string }
  | { kind: "token"; text: string }
  | { kind: "narration"; text: string }
  | { kind: "tool_call"; id: string; tool: string; args?: unknown }
  | { kind: "tool_result"; id: string; tool: string; ok: boolean; error?: string }
  | { kind: "approval"; id: string; tool: string; reason: string; riskTier?: string; preview?: string; args?: unknown }
  | { kind: "usage"; totalTokens?: number; totalUsd?: number }
  | { kind: "done"; fullText: string; finishReason?: string }
  | { kind: "error"; message: string; retryable: boolean };

export interface ChatRequest {
  message: string;
  mode: "ask" | "agent";
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  context?: string;
  sessionId?: string;
}

export interface ProvidersResponse {
  primary: string;
  model: string;
  providers: Array<{
    id: string;
    label: string;
    healthy: boolean;
    hasKey: boolean;
    defaultModel?: string;
    detail?: string;
  }>;
}

export interface BudgetResponse {
  usage: { dayUsd: number; monthUsd: number; totalUsd: number };
  persisted?: { daily_cap: number | null; monthly_cap: number | null };
}

/** Parse one JSON payload from the stream. Returns null for frames we do not render. */
export function parseChatEvent(raw: unknown): ChatEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const type = typeof o.type === "string" ? o.type : undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  switch (type) {
    case "status": {
      const status = str(o.status);
      if (!status) return null;
      return { kind: "status", status, provider: str(o.provider), model: str(o.model), message: str(o.message) };
    }
    case "token":
      return typeof o.text === "string" ? { kind: "token", text: o.text } : null;
    case "tool_call": {
      const id = str(o.id);
      const tool = str(o.tool);
      return id && tool ? { kind: "tool_call", id, tool, args: o.args } : null;
    }
    case "tool_result": {
      const id = str(o.id);
      const tool = str(o.tool);
      if (!id || !tool) return null;
      return { kind: "tool_result", id, tool, ok: o.ok === true, error: str(o.error) };
    }
    case "approval_required": {
      const req = o.approval_required as Record<string, unknown> | undefined;
      if (!req) return null;
      const id = str(req.id);
      const tool = str(req.tool);
      if (!id || !tool) return null;
      return {
        kind: "approval",
        id,
        tool,
        reason: str(req.reason) ?? "",
        riskTier: str(req.riskTier),
        preview: str(req.preview),
        args: req.args,
      };
    }
    case "usage": {
      const u = (o.usage ?? {}) as Record<string, unknown>;
      return {
        kind: "usage",
        totalTokens: typeof u.totalTokens === "number" ? u.totalTokens : undefined,
        totalUsd: typeof u.totalUsd === "number" ? u.totalUsd : typeof u.costUsd === "number" ? u.costUsd : undefined,
      };
    }
    case "done":
      return { kind: "done", fullText: str(o.fullText) ?? str(o.finalMessage) ?? "", finishReason: str(o.finishReason) };
    case "error":
      return { kind: "error", message: str(o.message) ?? "The daemon reported an error.", retryable: o.retryable === true };
    case undefined:
      // Untyped frames are narration lines ("▸ think (step 1/12) …").
      return typeof o.text === "string" ? { kind: "narration", text: o.text } : null;
    default:
      return null;
  }
}

export class DaemonClient {
  constructor(
    private readonly origin: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, accept: "application/json", ...extra };
  }

  private async getJson<T>(path: string, timeoutMs = 4000): Promise<T> {
    const res = await this.fetchImpl(this.origin + path, {
      headers: this.headers(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new DaemonHttpError(res.status, await errorText(res));
    return (await res.json()) as T;
  }

  private async postJson<T>(path: string, body: unknown, timeoutMs = 8000): Promise<T> {
    const res = await this.fetchImpl(this.origin + path, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new DaemonHttpError(res.status, await errorText(res));
    return (await res.json()) as T;
  }

  /** Unauthenticated liveness and version probe. */
  async health(): Promise<{ ok: boolean; version?: string }> {
    const res = await this.fetchImpl(this.origin + "/api/health", { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new DaemonHttpError(res.status, "Health check failed.");
    const body = (await res.json()) as { ok?: boolean; version?: { version?: string } };
    return { ok: body.ok === true, version: body.version?.version };
  }

  budget(): Promise<BudgetResponse> {
    return this.getJson<BudgetResponse>("/api/budget");
  }

  providers(): Promise<ProvidersResponse> {
    return this.getJson<ProvidersResponse>("/api/providers");
  }

  /**
   * Switch the primary provider and model. The daemon overwrites the fallback
   * on every call, so the current fallback is read first and passed back.
   */
  async setProvider(provider: string, model: string): Promise<void> {
    const chain = await this.getJson<{ steps?: Array<{ kind: string; providerId: string; modelId: string }> }>(
      "/api/providers/fallback",
    );
    // Step kinds come from src/providers/fallback-chain.ts: primary | fallbackProvider | local.
    const fallback = chain.steps?.find((s) => s.kind === "fallbackProvider");
    await this.postJson("/api/providers/set", {
      provider,
      model,
      fallbackProvider: fallback?.providerId ?? null,
      fallbackModel: fallback?.modelId ?? null,
    });
  }

  async decideApproval(id: string, approved: boolean): Promise<void> {
    await this.postJson(`/api/approvals/${encodeURIComponent(id)}/decision`, { approved, userId: "vscode" });
  }

  /**
   * Stream a chat turn. Yields normalized events and ends when the daemon
   * sends [DONE] or the stream closes. Aborting `signal` cancels the run; the
   * daemon treats a dropped stream as a cancellation.
   */
  async *chat(body: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const res = await this.fetchImpl(this.origin + "/api/chat", {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", accept: "text/event-stream" }),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new DaemonHttpError(res.status, await errorText(res));
    if (!res.body) throw new DaemonHttpError(res.status, "The daemon returned an empty stream.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        const payloads = done ? parser.end() : parser.push(decoder.decode(value, { stream: true }));
        for (const payload of payloads) {
          if (payload === "[DONE]") return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue; // malformed frame: skip rather than trust it
          }
          const event = parseChatEvent(parsed);
          if (event) yield event;
        }
        if (done) return;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; detail?: unknown };
    const msg = typeof body.error === "string" ? body.error : typeof body.detail === "string" ? body.detail : "";
    if (msg) return msg;
  } catch {
    // not JSON
  }
  return `Daemon returned HTTP ${res.status}.`;
}
