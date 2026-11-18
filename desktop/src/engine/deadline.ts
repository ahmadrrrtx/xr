/** Cancellation utilities shared by header-only streams and finite JSON calls. */
export class RequestDeadlineExpired extends Error {
  constructor() { super('Engine request deadline expired'); this.name = 'TimeoutError'; }
}

/** Keep the caller wired for the ENTIRE fetch body, not only until headers.
 * Native composition permits GC without accumulating listeners on a shared
 * session signal. The fallback supports older webviews and cleans on abort. */
export function requestSignal(controller: AbortController, caller?: AbortSignal | null): AbortSignal {
  if (!caller) return controller.signal;
  if (caller.aborted) return caller;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([caller, controller.signal]);
  const forward = () => controller.abort(caller.reason);
  caller.addEventListener('abort', forward, { once: true });
  controller.signal.addEventListener('abort', () => caller.removeEventListener('abort', forward), { once: true });
  return controller.signal;
}

/** Bound a FINITE operation, including a stalled body/IPC implementation that
 * ignores AbortSignal. Do not use around an SSE response returned to a reader. */
export async function withinDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, caller?: AbortSignal | null,
): Promise<T> {
  if (caller?.aborted) throw caller.reason;
  const controller = new AbortController();
  const signal = requestSignal(controller, caller);
  let onAbort!: () => void;
  const aborted = new Promise<never>((_r, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  const timer = setTimeout(() => controller.abort(new RequestDeadlineExpired()), timeoutMs);
  try {
    if (signal.aborted) throw signal.reason;
    return await Promise.race([Promise.resolve().then(() => operation(signal)), aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    controller.abort(); // release a fallback bridge after finite body consumption
  }
}
