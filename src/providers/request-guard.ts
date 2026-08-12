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

/** Why a guarded request ended early. */
export type AbortKind = "cancelled" | "timeout";

/** Error thrown when a guarded provider request is aborted or times out. */
export class ProviderAbortError extends Error {
  readonly kind: AbortKind;
  readonly providerId: string;
  readonly timeoutMs?: number;

  constructor(kind: AbortKind, providerId: string, timeoutMs?: number) {
    super(
      kind === "timeout"
        ? `provider ${providerId} timed out after ${timeoutMs} ms`
        : `provider ${providerId} request cancelled`,
    );
    this.name = "ProviderAbortError";
    this.kind = kind;
    this.providerId = providerId;
    this.timeoutMs = timeoutMs;
  }
}

/** True when the error represents a user/caller cancellation. */
export function isCancellation(e: unknown): boolean {
  return e instanceof ProviderAbortError && e.kind === "cancelled";
}

/** True when the error represents a request timeout. */
export function isTimeout(e: unknown): boolean {
  return e instanceof ProviderAbortError && e.kind === "timeout";
}

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
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  // Node/Bun keep the process alive for pending timers; this one must not.
  (timer as unknown as { unref?: () => void }).unref?.();

  const onCallerAbort = () => timeoutController.abort();
  // Compose manually rather than via AbortSignal.any(): the manual path works
  // on every runtime XR supports and lets us keep the timeout/cancel
  // distinction, which AbortSignal.any() erases.
  caller?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    return await run(timeoutController.signal);
  } catch (e) {
    if (timeoutController.signal.aborted) {
      // Caller abort wins the attribution: if the user cancelled, that is the
      // truthful reason even when the deadline expired in the same tick.
      throw caller?.aborted
        ? new ProviderAbortError("cancelled", providerId)
        : new ProviderAbortError("timeout", providerId, timeoutMs);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", onCallerAbort);
  }
}
