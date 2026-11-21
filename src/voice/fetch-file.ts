/**
 * B2/B3 — one catalogue file, fetched so it can neither hang nor lie: a stall
 * watchdog (no byte for `stallMs`, headers included), a hard per-file deadline
 * across attempts (15 min; XR_VOICE_FILE_DEADLINE_MS), bounded retries that
 * resume the `.part` with Range, and a streaming sha256 check against the pin
 * (a resumed prefix is hashed first). A terminal failure deletes the `.part`;
 * a user cancel keeps it for a later resume.
 */
import { createHash } from "node:crypto";
import { closeSync, createReadStream, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { dirname } from "node:path";

export interface DownloadPolicy { readonly stallMs: number; readonly deadlineMs: number; readonly retries: number; readonly backoffMs: number }
export interface VerifiedFile { readonly url: string; readonly path: string; readonly bytes: number; readonly sha256: string }

export function downloadPolicy(over: Partial<DownloadPolicy> = {}): DownloadPolicy {
  const env = Number(process.env.XR_VOICE_FILE_DEADLINE_MS);
  return { stallMs: 30_000, deadlineMs: env > 0 ? env : 15 * 60_000, retries: 3, backoffMs: 1_000, ...over };
}

/** A failed attempt; `retryable` says whether another attempt can help. */
class AttemptError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

/** writeSync may write fewer bytes than asked: loop until the chunk is on disk. */
export function writeFully(fd: number, buf: Uint8Array, write: (fd: number, b: Uint8Array) => number = writeSync): void {
  for (let off = 0; off < buf.length;) {
    const n = write(fd, buf.subarray(off));
    if (!(n > 0)) throw new Error("short write: no progress (disk full?)");
    off += n;
  }
}

/** Fetch `f` to `target` via `<target>.part`; `onDelta` gets signed progress deltas. Throws on terminal failure. */
export async function fetchVerified(f: VerifiedFile, target: string, signal: AbortSignal, fetchFn: typeof fetch, onDelta: (n: number) => void, policy: DownloadPolicy): Promise<void> {
  mkdirSync(dirname(target), { recursive: true });
  const part = `${target}.part`;
  const deadline = Date.now() + policy.deadlineMs;
  let counted = 0;
  const progress = (n: number) => { counted += n; onDelta(n); };
  for (let attempt = 0; ; attempt++) {
    try {
      await attemptOnce(f, part, signal, fetchFn, progress, () => counted, deadline, policy.stallMs);
      return renameSync(part, target);
    } catch (err) {
      if (signal.aborted) throw err;
      const left = deadline - Date.now();
      if ((err instanceof AttemptError && !err.retryable) || attempt >= policy.retries || left <= 0) {
        rmSync(part, { force: true });
        throw new Error(`${(err as Error)?.message ?? err}${attempt > 0 ? ` (gave up after ${attempt + 1} attempts)` : ""}`);
      }
      await delay(Math.min(policy.backoffMs * 2 ** attempt, left), undefined, { signal });
    }
  }
}

async function attemptOnce(f: VerifiedFile, part: string, outer: AbortSignal, fetchFn: typeof fetch, progress: (n: number) => void, counted: () => number, deadline: number, stallMs: number): Promise<void> {
  let have = 0;
  try { have = statSync(part).size; } catch { /* no partial yet */ }
  if (have >= f.bytes) { rmSync(part, { force: true }); have = 0; }
  const ac = new AbortController();
  let tripped = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    const left = deadline - Date.now();
    timer = setTimeout(() => { tripped = left <= stallMs ? "per-file deadline exceeded" : `stalled: no data for ${Math.round(stallMs / 1000)}s`; ac.abort(); }, Math.max(0, Math.min(stallMs, left)));
  };
  const onOuter = () => ac.abort();
  outer.addEventListener("abort", onOuter, { once: true });
  // Settles the moment we abort, even if a fetch implementation ignores its signal.
  const aborted = new Promise<never>((_, reject) => ac.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  aborted.catch(() => undefined);
  const race = <T>(p: Promise<T>) => Promise.race([p, aborted]);
  let release: () => unknown = () => undefined;
  let fd: number | null = null;
  try {
    arm();
    const res = await race(fetchFn(f.url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, signal: ac.signal, redirect: "follow" }));
    release = () => res.body?.cancel().catch(() => undefined);
    if (!res.ok && res.status !== 206) throw new AttemptError(`HTTP ${res.status} for ${f.path}`, res.status >= 500 || res.status === 408 || res.status === 429);
    const resumed = res.status === 206 && have > 0;
    if (!resumed) have = 0;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > 0 && declared !== f.bytes - have) throw new AttemptError(`unexpected size for ${f.path}: server ${declared + have} B, catalogue ${f.bytes} B`, false);
    if (!res.body) throw new AttemptError(`empty response body for ${f.path}`, true);
    const hash = createHash("sha256");
    if (have > 0) for await (const c of createReadStream(part, { end: have - 1 })) hash.update(c as Buffer);
    progress(have - counted());
    fd = openSync(part, resumed ? "a" : "w");
    const reader = res.body.getReader();
    release = () => reader.cancel().catch(() => undefined);
    let size = have;
    arm();
    for (;;) {
      const { done, value } = await race(reader.read());
      if (done) break;
      if (!value?.length) continue;
      arm();
      if ((size += value.length) > f.bytes) throw new AttemptError(`${f.path}: server sent more than the catalogue's ${f.bytes} B`, false);
      writeFully(fd, value);
      hash.update(value);
      progress(value.length);
    }
    closeSync(fd); // before any rmSync: Windows cannot unlink an open file
    fd = null;
    if (size !== f.bytes) throw new AttemptError(`${f.path}: connection closed at ${size} of ${f.bytes} B`, true);
    const digest = hash.digest("hex");
    if (digest !== f.sha256) {
      rmSync(part, { force: true });
      // A resumed prefix may be what was corrupt: one fresh retry is worth it; a fresh mismatch is final.
      throw new AttemptError(`integrity check failed for ${f.path}: sha256 ${digest.slice(0, 16)}… is not the pinned ${f.sha256.slice(0, 16)}…`, resumed);
    }
  } catch (err) {
    throw tripped && !outer.aborted ? new AttemptError(`${f.path}: ${tripped}`, true) : err;
  } finally {
    clearTimeout(timer);
    outer.removeEventListener("abort", onOuter);
    release();
    if (fd !== null) closeSync(fd);
  }
}
