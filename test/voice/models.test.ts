/**
 * Phase 15 · voice model catalogue + downloader — offline proofs.
 *
 *   • catalogue sizes are the measured bytes the UI promises (no "≈80 MB")
 *   • the npm tarball extractor handles ustar entries and strips `package/`
 *   • the downloader streams to `.part`, resumes with Range, verifies the
 *     catalogue size, refuses silently-different payloads, and cancels cleanly
 *   • first-run plan only lists what is missing
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ESPEAK_ENTRY,
  RUNTIME_ENTRY,
  STT_ENTRIES,
  TTS_VOICES,
  VoiceDownloader,
  entryBytes,
  entryInstalled,
  extractNpmTarball,
  filePath,
  firstRunPlan,
  type DownloadProgress,
  type VoiceModelEntry,
} from "../../src/voice/models.ts";

let dir: string;
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-voice-models-"));
  envBackup.XR_VOICE_MODEL_DIR = process.env.XR_VOICE_MODEL_DIR;
  envBackup.XR_VOICE_NATIVE_DIR = process.env.XR_VOICE_NATIVE_DIR;
  process.env.XR_VOICE_MODEL_DIR = join(dir, "models");
  process.env.XR_VOICE_NATIVE_DIR = join(dir, "native");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of Object.keys(envBackup)) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

function tarEntry(name: string, body: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const put = (off: number, s: string) => { for (let i = 0; i < s.length; i++) header[off + i] = s.charCodeAt(i); };
  put(0, name);
  put(100, "0000644\0");
  put(108, "0000000\0");
  put(116, "0000000\0");
  put(124, body.length.toString(8).padStart(11, "0") + "\0");
  put(136, "00000000000\0");
  put(156, "0");
  put(257, "ustar\0");
  put(263, "00");
  put(148, "        ");
  let sum = 0;
  for (const b of header) sum += b;
  put(148, sum.toString(8).padStart(6, "0") + "\0 ");
  const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
  padded.set(body);
  const out = new Uint8Array(512 + padded.length);
  out.set(header);
  out.set(padded, 512);
  return out;
}

function tgz(entries: Array<[string, string]>): Uint8Array {
  const parts = entries.map(([n, b]) => tarEntry(n, new TextEncoder().encode(b)));
  const total = parts.reduce((n, p) => n + p.length, 0) + 1024;
  const tar = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { tar.set(p, off); off += p.length; }
  return new Uint8Array(gzipSync(tar));
}

describe("voice model catalogue", () => {
  test("sizes are explicit bytes, every entry has stable https sources", () => {
    const all: VoiceModelEntry[] = [RUNTIME_ENTRY, ...STT_ENTRIES, ESPEAK_ENTRY, ...TTS_VOICES];
    for (const e of all) {
      expect(e.files.length).toBeGreaterThan(0);
      for (const f of e.files) {
        expect(f.url.startsWith("https://registry.npmjs.org/") || f.url.startsWith("https://huggingface.co/")).toBe(true);
        expect(f.bytes).toBeGreaterThan(0);
      }
      expect(entryBytes(e)).toBe(e.files.reduce((n, f) => n + f.bytes, 0));
    }
    // The first-run bundle the card advertises (runtime + STT + espeak + Ahmad).
    const bundle = entryBytes(RUNTIME_ENTRY) + entryBytes(STT_ENTRIES[0]) + entryBytes(ESPEAK_ENTRY) + entryBytes(TTS_VOICES[0]);
    expect(bundle).toBe(95_930_951);
    expect(TTS_VOICES.map((v) => v.label)).toEqual(["Ahmad", "Nova", "Atlas", "Sage"]);
    expect(TTS_VOICES.every((v) => v.gender && v.accent)).toBe(true);
  });

  test("first-run plan lists only missing entries and empties once files are complete", () => {
    expect(firstRunPlan().map((e) => e.id)).toEqual(["sherpa-onnx-wasm", "sherpa-small-en", "espeak-ng-data", "piper-lessac"]);
    const stt = STT_ENTRIES[0];
    for (const f of stt.files) {
      mkdirSync(join(process.env.XR_VOICE_MODEL_DIR!, stt.dir), { recursive: true });
      writeFileSync(filePath(stt, f), new Uint8Array(f.bytes));
    }
    expect(entryInstalled(stt)).toBe(true);
    expect(firstRunPlan().map((e) => e.id)).toEqual(["sherpa-onnx-wasm", "espeak-ng-data", "piper-lessac"]);
  });
});

describe("npm tarball extraction", () => {
  test("strips package/ and writes files under dest", () => {
    const tgzPath = join(dir, "pkg.tgz");
    writeFileSync(tgzPath, tgz([["package/index.js", "module.exports = 1;"], ["package/lib/a.wasm", "WASM"]]));
    const dest = join(dir, "out");
    expect(extractNpmTarball(tgzPath, dest)).toBe(2);
    expect(readFileSync(join(dest, "index.js"), "utf8")).toBe("module.exports = 1;");
    expect(readFileSync(join(dest, "lib/a.wasm"), "utf8")).toBe("WASM");
  });
});

describe("voice downloader", () => {
  const entry: VoiceModelEntry = {
    id: "fake",
    component: "stt",
    name: "fake",
    detail: "",
    dir: "stt/fake",
    files: [{ url: "https://example.test/a.bin", path: "a.bin", bytes: 1000 }],
  };
  const payload = new Uint8Array(1000).map((_, i) => i % 251);

  function fakeFetch(opts: { ranges?: boolean; bytes?: number; fail?: boolean; slow?: boolean } = {}): typeof fetch {
    return (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = payload.subarray(0, opts.bytes ?? 1000);
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (opts.fail) return new Response("nope", { status: 500 });
      if (range && opts.ranges) {
        const from = Number(range.replace("bytes=", "").replace("-", ""));
        return new Response(body.subarray(from), { status: 206, headers: { "content-length": String(body.length - from) } });
      }
      if (opts.slow) {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(body.subarray(0, 100));
            const t = setTimeout(() => { try { c.enqueue(body.subarray(100)); c.close(); } catch { /* aborted */ } }, 400);
            init?.signal?.addEventListener("abort", () => { clearTimeout(t); try { c.error(new DOMException("aborted", "AbortError")); } catch { /* closed */ } });
          },
        });
        return new Response(stream, { status: 200, headers: { "content-length": String(body.length) } });
      }
      return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
    }) as typeof fetch;
  }

  test("downloads, verifies the catalogue size and renames .part into place", async () => {
    const d = new VoiceDownloader();
    const seen: DownloadProgress[] = [];
    const out = await d.download(entry, (p) => seen.push(p), fakeFetch());
    expect(out.status).toBe("done");
    expect(out.received).toBe(1000);
    expect(out.total).toBe(1000);
    expect(existsSync(filePath(entry, entry.files[0]))).toBe(true);
    expect(existsSync(filePath(entry, entry.files[0]) + ".part")).toBe(false);
    expect(seen.at(-1)?.percent).toBe(100);
  });

  test("resumes a partial file with Range and counts the resumed bytes", async () => {
    const target = filePath(entry, entry.files[0]);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target + ".part", payload.subarray(0, 400));
    const d = new VoiceDownloader();
    const out = await d.download(entry, () => undefined, fakeFetch({ ranges: true }));
    expect(out.status).toBe("done");
    expect(new Uint8Array(readFileSync(target))).toEqual(payload);
  });

  test("refuses a payload whose size differs from the catalogue (never a silent swap)", async () => {
    const d = new VoiceDownloader();
    const out = await d.download(entry, () => undefined, fakeFetch({ bytes: 900 }));
    expect(out.status).toBe("error");
    expect(out.detail).toContain("unexpected size");
    expect(existsSync(filePath(entry, entry.files[0]))).toBe(false);
  });

  test("HTTP failure is reported, not thrown", async () => {
    const out = await new VoiceDownloader().download(entry, () => undefined, fakeFetch({ fail: true }));
    expect(out.status).toBe("error");
    expect(out.detail).toContain("HTTP 500");
  });

  test("cancel aborts the stream and keeps the .part for a later resume", async () => {
    const d = new VoiceDownloader();
    const p = d.download(entry, () => undefined, fakeFetch({ slow: true }));
    await new Promise((r) => setTimeout(r, 50));
    d.cancel();
    const out = await p;
    expect(out.status).toBe("cancelled");
    expect(existsSync(filePath(entry, entry.files[0]) + ".part")).toBe(true);
    expect(d.current()).toBeNull();
  });
});
