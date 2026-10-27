/**
 * XR — provider request guard (audit GAP-001 · P0).
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * Every provider's `chat()` called `fetch()` with no `signal` and no timeout:
 *
 *     const res = await fetch(`${this.baseUrl}/chat/completions`, {
 *       method: "POST", headers: this.headers(), body: JSON.stringify(body),
 *     });                                    // ← unbounded, uninterruptible
 *
 * A provider that accepted the connection and then stalled hung XR forever.
 * The agent loop's cancellation is cooperative — it checks between steps — so a
 * stall *inside* the turn was unreachable by Ctrl+C. Reproduced live during the
 * red-team audit: SIGINT printed "stopping at the next step" and the process
 * still had to be killed (exit 124).
 *
 * Notably `health()` in the same file already used `AbortSignal.timeout(8000)`.
 * The pattern was known; it had simply never been applied to the hot path.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 *
 * One helper, used by every adapter, that:
 *   1. bounds every model call with a timeout (never unbounded),
 *   2. propagates the caller's AbortSignal so Ctrl+C reaches the socket,
 *   3. reports the two outcomes HONESTLY and distinguishably — a user-cancelled
 *      call is not a timeout, and neither is a generic network error.
 *
 * Failing to distinguish them is what makes a runtime lie about why it stopped.
 */

import { ProviderAbortError, isCancellation, isTimeout, type AbortKind } from "../core/provider-abort.ts";
export { ProviderAbortError, isCancellation, isTimeout, type AbortKind } from "../core/provider-abort.ts";

/**
 * Default per-request ceiling. Deliberately generous: local models on modest
 * hardware legitimately take a long time to produce a first token, and a
 * too-eager default would break working setups. It is a liveness backstop,
 * not a latency budget.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/** Options every provider `chat()` accepts. Optional — older call sites are unchanged. */
export interface ChatOptions {
  /** Caller cancellation (agent loop / execution envelope / Ctrl+C). */
  signal?: AbortSignal;
  /** Per-request ceiling in ms. Falls back to config, then the default. */
  timeoutMs?: number;
}

/**
 * Configured default, published by the provider factory when it builds an
 * adapter from config. Held as a module-level value rather than imported from
 * the config module so the guard adds nothing to the hot path's import graph
 * (hot-path-lint forbids synchronous FS/process I/O here).
 */
let configuredTimeoutMs: number | undefined;

/** Publish the config-derived request ceiling. Ignores non-positive values. */
export function setConfiguredRequestTimeout(ms: number | undefined): void {
  configuredTimeoutMs =
    typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function resolveConfiguredTimeout(): number | undefined {
  // Precedence: env override (operators can react without editing config),
  // then the configured value, then the built-in default.
  const raw = process.env.XR_PROVIDER_TIMEOUT_MS;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return configuredTimeoutMs;
}

/** Resolve the effective timeout: explicit → env → default. Never unbounded. */
export function resolveTimeoutMs(explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  return resolveConfiguredTimeout() ?? DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * Run a provider HTTP request under a timeout + caller cancellation.
 *
 * `run` receives the composed signal and MUST pass it to `fetch`. On abort we
 * translate the runtime's generic AbortError into a `ProviderAbortError` that
 * names the real cause, so callers can tell "the user stopped this" apart from
 * "the provider went silent".
 */
export async function guardedRequest<T>(
  providerId: string,
  opts: ChatOptions | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = resolveTimeoutMs(opts?.timeoutMs);
  const caller = opts?.signal;

  // Fail fast: a signal already aborted before we start must not open a socket.
  if (caller?.aborted) throw new ProviderAbortError("cancelled", providerId);

  const timeoutController = new AbortController();
  const reason = () => caller?.aborted ? new ProviderAbortError("cancelled", providerId) : new ProviderAbortError("timeout", providerId, timeoutMs);
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  const onCallerAbort = () => timeoutController.abort();
  caller?.addEventListener("abort", onCallerAbort, { once: true });
  let removeBodyListener = () => {};
  let rejectOnAbort: (() => void) | undefined;
  const cleanup = () => {
    clearTimeout(timer); caller?.removeEventListener("abort", onCallerAbort);
    if (rejectOnAbort) timeoutController.signal.removeEventListener("abort", rejectOnAbort);
    removeBodyListener();
  };
  let delegated = false;
  try {
    const aborted = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(reason());
      timeoutController.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
    if (caller?.aborted) timeoutController.abort();
    if (timeoutController.signal.aborted) throw reason();
    const value = await Promise.race([run(timeoutController.signal), aborted]);
    if (!(value instanceof Response) || !value.body || value.bodyUsed) return value;

    // A fetch promise resolves at HEADERS, not EOF. Keep the same deadline
    // and cancellation active through JSON/text/SSE consumption, with bounded
    // bytes and backpressure. Never buffer an unbounded stream into memory.
    const reader = value.body.getReader();
    let controller: ReadableStreamDefaultController<Uint8Array>, ended = false, bytes = 0;
    const end = (error?: unknown) => {
      if (ended) return; ended = true; cleanup();
      if (error !== undefined) controller.error(error); else controller.close();
      void reader.cancel(error).catch(() => {});
    };
    const abortBody = () => end(reason());
    const body = new ReadableStream<Uint8Array>({
      start(c) { controller = c; },
      async pull(c) {
        try {
          const chunk = await reader.read();
          if (ended) return;
          if (chunk.done) { end(); return; }
          bytes += chunk.value.byteLength;
          if (bytes > MAX_PROVIDER_RESPONSE_BYTES) { end(new Error(`provider ${providerId} response exceeded ${MAX_PROVIDER_RESPONSE_BYTES} bytes`)); return; }
          c.enqueue(chunk.value);
        } catch (e) { end(timeoutController.signal.aborted ? reason() : e); }
      },
      cancel() { if (!ended) { ended = true; cleanup(); void reader.cancel().catch(() => {}); } },
    });
    timeoutController.signal.addEventListener("abort", abortBody, { once: true });
    removeBodyListener = () => timeoutController.signal.removeEventListener("abort", abortBody);
    const wrapped = new Response(body, { status: value.status, statusText: value.statusText, headers: value.headers });
    Object.defineProperty(wrapped, "url", { value: value.url });
    delegated = true;
    if (timeoutController.signal.aborted) abortBody();
    return wrapped as unknown as T;
  } catch (e) {
    cleanup();
    if (timeoutController.signal.aborted) throw reason();
    throw e;
  } finally {
    if (!delegated) cleanup();
  }
}

/** Across buffered and streamed adapters; this is bytes, not model tokens. */
export const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024;
