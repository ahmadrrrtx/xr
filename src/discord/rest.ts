/**
 * XR — Discord REST client (Phase 26).
 *
 * Plain fetch with the `Authorization: Bot <token>` header. Rate limiting:
 * a 429 response pauses ALL bot requests for `retry_after` (Discord can apply
 * the limit globally), then the request is retried a bounded number of times.
 * Nothing here logs the token or a request body.
 */
import { DISCORD_API_BASE } from "./types.ts";

export interface RestOptions {
  token: string;
  apiBase?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  /** Longest single wait honoured for a 429 (a longer one fails the request). */
  maxWaitMs?: number;
}

export interface RestResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class DiscordRest {
  private readonly apiBase: string;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private blockedUntil = 0;

  constructor(private readonly opts: RestOptions) {
    this.apiBase = opts.apiBase ?? DISCORD_API_BASE;
    this.f = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /**
   * `auth: false` is for interaction webhook routes, which authenticate by
   * the interaction token in the path.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts: { auth?: boolean } = {},
  ): Promise<RestResult<T>> {
    const maxRetries = this.opts.maxRetries ?? 3;
    const maxWaitMs = this.opts.maxWaitMs ?? 60_000;
    for (let attempt = 0; ; attempt += 1) {
      const wait = this.blockedUntil - Date.now();
      if (wait > 0) await this.sleep(wait);
      const headers: Record<string, string> = {};
      if (body !== undefined) headers["content-type"] = "application/json";
      if (opts.auth !== false) headers.authorization = `Bot ${this.opts.token}`;
      const res = await this.f(`${this.apiBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429) {
        const retryMs = await retryAfterMs(res);
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + retryMs);
        if (attempt < maxRetries && retryMs <= maxWaitMs) {
          await this.sleep(retryMs);
          continue;
        }
        return { ok: false, status: 429, data: null };
      }
      const data = (await res.json().catch(() => null)) as T | null;
      return { ok: res.ok, status: res.status, data };
    }
  }
}

async function retryAfterMs(res: Response): Promise<number> {
  const body = (await res.clone().json().catch(() => null)) as { retry_after?: number } | null;
  const seconds = typeof body?.retry_after === "number" ? body.retry_after : Number(res.headers.get("retry-after") ?? 1);
  return Math.max(0, Math.ceil((Number.isFinite(seconds) ? seconds : 1) * 1000));
}
