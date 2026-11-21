/**
 * B2 / B3 — download resilience and integrity against a LOCAL HTTP fixture
 * server (Bun.serve on 127.0.0.1; no network, no model weights).
 *
 *   • a stalled connection is aborted by the watchdog, retried, and resumed
 *     with Range from the .part — it no longer hangs the downloader busy;
 *   • the per-file deadline bounds a connection that trickles forever;
 *   • retries are bounded and only for transient failures;
 *   • integrity is the pinned sha256: same-size corrupt bytes are refused
 *     and leave nothing behind; a corrupt resumed prefix restarts once;
 *   • short writes are looped.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VoiceDownloader, filePath, type DownloadProgress, type VoiceModelEntry } from "../../src/voice/models.ts";
import { writeFully } from "../../src/voice/fetch-file.ts";

let dir: string;
const envBackup: Record<string, string | undefined> = {};
const servers: Array<{ stop: (force?: boolean) => void }> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-voice-resilience-"));
  for (const k of ["XR_VOICE_MODEL_DIR", "XR_VOICE_NATIVE_DIR"]) envBackup[k] = process.env[k];
  process.env.XR_VOICE_MODEL_DIR = join(dir, "models");
  process.env.XR_VOICE_NATIVE_DIR = join(dir, "native");
});
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
  rmSync(dir, { recursive: true, force: true });
  for (const k of Object.keys(envBackup)) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

const SIZE = 64 * 1024;
const payload = new Uint8Array(SIZE).map((_, i) => (i * 7 + 3) % 251);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

type Plan = (req: Request) => Response;
/** A local HTTP fixture: request i is answered by plans[min(i, last)]. */
function fixture(plans: Plan[]) {
  const ranges: Array<string | null> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const i = ranges.length;
      ranges.push(req.headers.get("range"));
      return plans[Math.min(i, plans.length - 1)]!(req);
    },
  });
  servers.push(server);
  const entry: VoiceModelEntry = { id: "fixture", component: "stt", name: "fixture", detail: "", dir: "stt/fixture", files: [{ url: `http://127.0.0.1:${server.port}/model.bin`, path: "model.bin", bytes: SIZE, sha256: sha(payload) }] };
  return { entry, ranges, target: () => filePath(entry, entry.files[0]!) };
}

const rangeStart = (req: Request) => Number(/bytes=(\d+)-/.exec(req.headers.get("range") ?? "")?.[1] ?? 0);
/** Honest server: full body, or a 206 slice for a Range request. */
const honest: Plan = (req) => {
  const from = rangeStart(req);
  const body = payload.subarray(from);
  return new Response(body, { status: from > 0 ? 206 : 200, headers: { "content-length": String(body.length) } });
};
/** Sends the first `n` bytes (of the requested range) and then stalls forever. */
const stallAfter = (n: number): Plan => (req) => {
  const from = rangeStart(req);
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(payload.slice(from, from + n)); } });
  return new Response(stream, { status: from > 0 ? 206 : 200, headers: { "content-length": String(SIZE - from) } });
};
/** Never stalls (a byte every 25 ms) but would take ~27 minutes to finish. */
const trickle: Plan = () => {
  let i = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { timer = setInterval(() => { try { c.enqueue(payload.slice(i, i + 1)); i++; } catch { clearInterval(timer); } }, 25); },
    cancel() { clearInterval(timer); },
  });
  return new Response(stream, { status: 200, headers: { "content-length": String(SIZE) } });
};
const status = (code: number): Plan => () => new Response("nope", { status: code });

const fast = { stallMs: 200, backoffMs: 5, retries: 3, deadlineMs: 10_000 };

describe("B2 — stall watchdog, bounded retries, Range resume", () => {
  test("a stalled connection is aborted, retried and resumed from the .part", async () => {
    const fx = fixture([stallAfter(SIZE / 4), honest]);
    const seen: DownloadProgress[] = [];
    const started = Date.now();
    const out = await new VoiceDownloader(fast).download(fx.entry, (p) => seen.push(p), fetch);
    expect(out.status).toBe("done");
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(fx.ranges).toEqual([null, `bytes=${SIZE / 4}-`]);
    expect(new Uint8Array(readFileSync(fx.target()))).toEqual(payload);
    expect(existsSync(fx.target() + ".part")).toBe(false);
    expect(out.received).toBe(SIZE);
    expect(out.percent).toBe(100);
  });

  test("the per-file deadline ends a connection that never stalls but never finishes", async () => {
    const fx = fixture([trickle]);
    const started = Date.now();
    const out = await new VoiceDownloader({ ...fast, stallMs: 300, deadlineMs: 600 }).download(fx.entry, () => undefined, fetch);
    expect(out.status).toBe("error");
    expect(out.detail).toContain("deadline");
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(existsSync(fx.target() + ".part")).toBe(false); // terminal failure strands nothing
    expect(existsSync(fx.target())).toBe(false);
  });

  test("transient HTTP failures are retried a bounded number of times, then reported", async () => {
    const fx = fixture([status(503)]);
    const out = await new VoiceDownloader(fast).download(fx.entry, () => undefined, fetch);
    expect(out.status).toBe("error");
    expect(out.detail).toContain("HTTP 503");
    expect(out.detail).toContain("gave up after 4 attempts");
    expect(fx.ranges).toHaveLength(4);
  });

  test("a permanent HTTP failure is not retried", async () => {
    const fx = fixture([status(404)]);
    const out = await new VoiceDownloader(fast).download(fx.entry, () => undefined, fetch);
    expect(out.status).toBe("error");
    expect(out.detail).toContain("HTTP 404");
    expect(fx.ranges).toHaveLength(1);
  });

  test("a transient failure followed by success completes in one call", async () => {
    const fx = fixture([status(502), honest]);
    const out = await new VoiceDownloader(fast).download(fx.entry, () => undefined, fetch);
    expect(out.status).toBe("done");
    expect(fx.ranges).toHaveLength(2);
  });

  test("cancel during a stall keeps the .part for a later resume", async () => {
    const fx = fixture([stallAfter(SIZE / 2)]);
    const d = new VoiceDownloader({ ...fast, stallMs: 5_000 });
    const p = d.download(fx.entry, () => undefined, fetch);
    for (let i = 0; i < 100 && !existsSync(fx.target() + ".part"); i++) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 50));
    d.cancel();
    const out = await p;
    expect(out.status).toBe("cancelled");
    expect(existsSync(fx.target() + ".part")).toBe(true);
  });
});

describe("B3 — integrity is the pinned sha256", () => {
  test("same-size corrupt bytes are refused, nothing is installed or stranded, no retry storm", async () => {
    const corrupt = payload.slice();
    corrupt[SIZE - 1] ^= 0xff;
    const fx = fixture([() => new Response(corrupt, { status: 200, headers: { "content-length": String(SIZE) } })]);
    const out = await new VoiceDownloader(fast).download(fx.entry, () => undefined, fetch);
    expect(out.status).toBe("error");
    expect(out.detail).toContain("integrity check failed");
    expect(existsSync(fx.target())).toBe(false);
    expect(existsSync(fx.target() + ".part")).toBe(false);
    expect(fx.ranges).toHaveLength(1);
  });

  test("a corrupt resumed prefix is discarded and the file restarts once from zero", async () => {
    const fx = fixture([honest]);
    const target = fx.target();
    mkdirSync(join(target, ".."), { recursive: true });
    const badPrefix = payload.slice(0, SIZE / 2);
    badPrefix[0] ^= 0xff;
    writeFileSync(target + ".part", badPrefix);
    const out = await new VoiceDownloader(fast).download(fx.entry, () => undefined, fetch);
    expect(out.status).toBe("done");
    expect(fx.ranges).toEqual([`bytes=${SIZE / 2}-`, null]);
    expect(new Uint8Array(readFileSync(target))).toEqual(payload);
  });
});

describe("B12 — short writes are looped", () => {
  test("writeFully keeps writing until the whole chunk is on disk", () => {
    const got: number[] = [];
    const short = (_fd: number, b: Uint8Array) => { const n = Math.min(3, b.length); got.push(...b.subarray(0, n)); return n; };
    writeFully(0, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), short);
    expect(got).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("a write that makes no progress throws instead of spinning", () => {
    expect(() => writeFully(0, new Uint8Array([1]), () => 0)).toThrow("short write");
  });
});
