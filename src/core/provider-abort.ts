/** Shared abort contract: no provider IO or higher-layer dependency. */
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
