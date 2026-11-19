/**
 * B1 / B15 / B19 / B20 — the voice download crash chain (audit 2026-11-19).
 *
 * The engine died when a POST /api/voice/download completion chain rejected:
 * the probe's catch did `(e as Error).message.slice()` on a NON-Error throw,
 * VoiceSession.emit() let one throwing subscriber abort the fan-out, the
 * fire-and-forget `.finally()` had no `.catch`, and Bun exits on an unhandled
 * rejection. Every proof below asserts an observable effect: a returned
 * probe, a delivered event, an audit record, a freed wasm handle, a child
 * process that stayed alive.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describeThrown } from "../../src/util/thrown.ts";
import { loadNativeVoice, resetNativeVoice, type NativeVoiceProbe } from "../../src/voice/native.ts";
import { STT_ENTRIES, entryBytes, type DownloadProgress, type VoiceModelEntry } from "../../src/voice/models.ts";
import { VoiceDownloads } from "../../src/voice/downloads.ts";
import { TextToSpeech } from "../../src/voice/tts.ts";
import { VoiceSession, type VoiceEvent } from "../../src/daemon/voice-session.ts";
import { defaultVoiceSettings } from "../../src/voice/types.ts";
import { recordUnhandledRejection } from "../../src/daemon/process-guards.ts";

const REPO = join(import.meta.dir, "..", "..");
let dir: string;
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-voice-crash-"));
  for (const k of ["XR_VOICE_MODEL_DIR", "XR_VOICE_NATIVE_DIR"]) envBackup[k] = process.env[k];
  process.env.XR_VOICE_MODEL_DIR = join(dir, "models");
  process.env.XR_VOICE_NATIVE_DIR = join(dir, "native");
  resetNativeVoice();
});
afterEach(() => {
  resetNativeVoice();
  rmSync(dir, { recursive: true, force: true });
  for (const k of Object.keys(envBackup)) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

/** A fake `sherpa-onnx` package where `createRequire` will find it. */
function fakeSherpa(body: string): void {
  const pkg = join(dir, "native", "node_modules", "sherpa-onnx");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "sherpa-onnx", version: "0.0.0-fixture", main: "index.js" }));
  writeFileSync(join(pkg, "index.js"), body);
}

/** Sparse files with the catalogue sizes, so the STT model counts as installed. */
function installSttModels(): void {
  const stt = STT_ENTRIES[0]!;
  for (const f of stt.files) {
    const p = join(dir, "models", stt.dir, f.path);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, "");
    truncateSync(p, f.bytes);
  }
}

const stubStore = (records: Array<{ action: string; details: Record<string, unknown> }> = []) =>
  ({ audit: (action: string, details: Record<string, unknown>) => { records.push({ action, details }); }, workspaceId: "test" }) as never;

describe("B1 — thrown values of any shape are describable without throwing", () => {
  test("strings, numbers, null, prototype-less and hostile objects", () => {
    const hostile = { toString() { throw new Error("no"); } };
    const getterError = Object.defineProperty(new Error("x"), "message", { get() { throw new Error("getter"); } });
    expect(describeThrown("wasm init failed")).toBe("wasm init failed");
    expect(describeThrown(42)).toBe("42");
    expect(describeThrown(null)).toBe("null");
    expect(describeThrown(undefined)).toBe("undefined");
    expect(describeThrown(Object.create(null))).toBe("unprintable thrown value");
    expect(describeThrown(hostile)).toBe("unprintable thrown value");
    expect(describeThrown(getterError)).toBe("unprintable thrown value");
    expect(describeThrown(new TypeError("boom"))).toBe("boom");
    expect(describeThrown("x".repeat(500), 80)).toHaveLength(80);
  });
});

describe("B1 — native probe survives a non-Error throw from the binding", () => {
  test("a sherpa module that throws a STRING reports unavailable instead of throwing", () => {
    fakeSherpa(`throw "wasm instantiate failed: out of memory";`);
    let probe: NativeVoiceProbe | undefined;
    expect(() => { probe = loadNativeVoice(true); }).not.toThrow();
    expect(probe?.ok).toBe(false);
    expect(probe?.missing.runtime).toEqual(["sherpa-onnx"]);
    expect(probe?.detail).toContain("wasm instantiate failed");
  });

  test("a sherpa module that throws a NUMBER reports unavailable instead of throwing", () => {
    fakeSherpa(`throw 7;`);
    const probe = loadNativeVoice(true);
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain("(7)");
  });
});

describe("B19 — the wasm recognizer stream is freed on every path", () => {
  const sherpaWith = (decode: string, wave: string) => `
    globalThis.__xrFreed = 0;
    module.exports = {
      version: "fixture",
      readWaveFromBinaryData: () => ${wave},
      createOfflineRecognizer: () => ({
        createStream: () => ({ acceptWaveform() {}, free() { globalThis.__xrFreed++; } }),
        decode: () => { ${decode} },
        getResult: () => ({ text: " hello " }),
      }),
    };`;
  const freed = () => (globalThis as { __xrFreed?: number }).__xrFreed;

  test("decode throwing still frees the stream (and the error still surfaces)", () => {
    installSttModels();
    fakeSherpa(sherpaWith(`throw new Error("decode failed");`, `({ sampleRate: 16000, samples: new Float32Array(16) })`));
    const probe = loadNativeVoice(true);
    expect(probe.ok).toBe(true);
    expect(() => probe.handles!.recognize(new Uint8Array(64))).toThrow("decode failed");
    expect(freed()).toBe(1);
  });

  test("an unreadable wav frees the stream", () => {
    installSttModels();
    fakeSherpa(sherpaWith(``, `null`));
    const probe = loadNativeVoice(true);
    expect(probe.handles!.recognize(new Uint8Array(4))).toEqual({ text: "", detail: "unreadable wav" });
    expect(freed()).toBe(1);
  });

  test("the success path frees exactly once and returns the transcript", () => {
    installSttModels();
    fakeSherpa(sherpaWith(``, `({ sampleRate: 16000, samples: new Float32Array(16) })`));
    const probe = loadNativeVoice(true);
    expect(probe.handles!.recognize(new Uint8Array(64))).toEqual({ text: "hello" });
    expect(freed()).toBe(1);
  });
});

describe("B20 — auto TTS selection probes the native binding once, for the selected voice", () => {
  test("one loader call; the detail belongs to the selected voice", async () => {
    const calls: Array<string | undefined> = [];
    const loader = ((_force?: boolean, voice?: string) => {
      calls.push(voice);
      return { ok: true, detail: "fixture", missing: { runtime: [], stt: [], tts: [] }, handles: { ttsDetail: `sherpa-onnx piper ${voice ?? "DEFAULT"} (offline)`, sttDetail: "", ttsVoice: voice ?? "", recognize: () => ({ text: "" }), speak: () => null } };
    }) as typeof loadNativeVoice;
    const tts = new TextToSpeech({ engine: "auto", voice: "piper-amy", nativeLoader: loader });
    const selected = await tts.describeAsync();
    expect(calls).toEqual(["piper-amy"]);
    expect(selected).toEqual({ engine: "sherpa", available: true, detail: "sherpa-onnx piper piper-amy (offline)" });
  });
});

describe("B1 — VoiceSession.emit isolates subscribers", () => {
  test("a throwing subscriber is audited once and never blocks the others", () => {
    const records: Array<{ action: string; details: Record<string, unknown> }> = [];
    const s = new VoiceSession(stubStore(records), defaultVoiceSettings());
    const seen: VoiceEvent[] = [];
    s.subscribe(() => { throw "subscriber exploded"; }); // throws on the initial state event too
    s.subscribe((e) => seen.push(e));
    expect(() => s.emit({ type: "status", text: "one" })).not.toThrow();
    expect(() => s.emit({ type: "status", text: "two" })).not.toThrow();
    expect(seen.filter((e) => e.type === "status").map((e) => e.text)).toEqual(["one", "two"]);
    const faults = records.filter((r) => r.action === "voice.subscriber.error");
    expect(faults).toHaveLength(1);
    expect(faults[0]!.details.error).toBe("subscriber exploded");
  });
});

const entry = (id: string): VoiceModelEntry => ({ id, component: "stt", name: id, dir: id, detail: "", files: [{ path: "model", url: "https://fixture.invalid/model", bytes: 10, sha256: "f".repeat(64) }] }); // injected downloader: hash unchecked
const doneP = (id: string): DownloadProgress => ({ id, component: "stt", received: 10, total: 10, percent: 100, status: "done" });

describe("B15 — concurrent download starts get a typed busy result", () => {
  test("the second start is refused without throwing; the first completes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const d = new VoiceDownloads(() => {}, { cancel() {}, download: async (e, emit) => { await gate; const out = doneP(e.id); emit(out); return out; } });
    const first = d.start([entry("one")]);
    expect(first.started).toBe(true);
    let second: ReturnType<VoiceDownloads["start"]> | undefined;
    expect(() => { second = d.start([entry("two")]); }).not.toThrow();
    expect(second).toMatchObject({ started: false, reason: "busy" });
    expect(second && !second.started ? second.current?.id : null).toBe("one");
    release();
    if (first.started) await first.done;
    expect(d.busy()).toBe(false);
    expect(d.current()?.status).toBe("done");
  });
});

describe("B1 — a bundle's completion promise never rejects", () => {
  test("an inner downloader throw becomes a terminal error record", async () => {
    const d = new VoiceDownloads(() => {}, { cancel() {}, download: async () => { throw "socket hang up"; } });
    const run = d.start([entry("one")]);
    if (!run.started) throw new Error("expected admission");
    await expect(run.done).resolves.toBeUndefined();
    expect(d.busy()).toBe(false);
    expect(d.current()).toMatchObject({ status: "error", detail: "Voice download failed: socket hang up" });
  });

  test("a throwing progress subscriber does not fail the download", async () => {
    const d = new VoiceDownloads(() => { throw new Error("subscriber gone"); }, { cancel() {}, download: async (e, emit) => { const out = doneP(e.id); emit(out); return out; } });
    const run = d.start([entry("one")]);
    if (!run.started) throw new Error("expected admission");
    await run.done;
    expect(d.current()?.status).toBe("done");
  });

  test("VoiceSession.startDownload audits a failed bundle and keeps serving", async () => {
    const records: Array<{ action: string; details: Record<string, unknown> }> = [];
    const s = new VoiceSession(stubStore(records), defaultVoiceSettings());
    (s.downloader as unknown as { downloader: unknown }).downloader = { cancel() {}, download: async () => { throw 503; } };
    const events: VoiceEvent[] = [];
    s.subscribe((e) => events.push(e));
    s.subscribe(() => { throw new Error("closed SSE controller"); });
    const run = s.startDownload([entry("one")]);
    expect(run.started).toBe(true);
    if (run.started) await run.done;
    await new Promise((r) => setTimeout(r, 0)); // let the detached settle chain run
    expect(events.some((e) => e.type === "download" && e.status === "error")).toBe(true);
    const failed = records.find((r) => r.action === "voice.download.failed");
    expect(failed?.details.detail).toBe("Voice download failed: 503");
    expect(s.startDownload([entry("two")]).started).toBe(true); // not wedged busy
  });
});

describe("B1 — process-level guard", () => {
  test("recordUnhandledRejection is total for any rejected value", () => {
    const records: Array<{ action: string; details: Record<string, unknown> }> = [];
    const sink = { audit: (action: string, details: Record<string, unknown>) => { records.push({ action, details }); } };
    expect(() => recordUnhandledRejection("plain string", sink)).not.toThrow();
    expect(() => recordUnhandledRejection(Object.create(null), sink)).not.toThrow();
    expect(() => recordUnhandledRejection(new Error("e"), { audit: () => { throw new Error("store closed"); } })).not.toThrow();
    expect(records.map((r) => r.details.reason)).toEqual(["plain string", "unprintable thrown value"]);
  });

  async function runChild(guarded: boolean): Promise<{ code: number; out: string }> {
    const script = join(dir, `child-${guarded ? "guarded" : "bare"}.ts`);
    writeFileSync(script, `
      import { installProcessGuards } from ${JSON.stringify(join(REPO, "src/daemon/process-guards.ts"))};
      const audits: string[] = [];
      ${guarded ? `installProcessGuards({ audit: (a, d) => { audits.push(a + ":" + String(d.reason)); } });` : ""}
      void Promise.resolve().then(() => { throw "detached chain rejected"; });
      setTimeout(() => { console.log("ALIVE " + JSON.stringify(audits)); process.exit(0); }, 100);
    `);
    const proc = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe", env: { ...process.env, XR_HOME: join(dir, "home") } });
    const out = await new Response(proc.stdout).text();
    return { code: await proc.exited, out };
  }

  test("while guarded, a detached rejection is audited and the process stays alive", async () => {
    const guarded = await runChild(true);
    expect(guarded.code).toBe(0);
    expect(guarded.out).toContain(`ALIVE ["daemon.unhandled_rejection:detached chain rejected"]`);
  }, 20_000);

  test("control: without the guard the same rejection kills the process (the original crash)", async () => {
    const bare = await runChild(false);
    expect(bare.code).not.toBe(0);
    expect(bare.out).not.toContain("ALIVE");
  }, 20_000);
});

describe("B15 — POST /api/voice/download admission over HTTP", () => {
  test("two concurrent POSTs: one 200, one typed 409; the chain settles without a rejection", async () => {
    const { makeHandler } = await import("../../src/daemon/server.ts");
    const { Store } = await import("../../src/state/workspace-store.ts");
    const { voiceSessionFor } = await import("../../src/daemon/voice-session.ts");
    const store = new Store(join(dir, "state.db"));
    try {
      const s = voiceSessionFor(store);
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      // No network in tests: the bundle's per-entry downloader is a gated fixture.
      (s.downloader as unknown as { downloader: unknown }).downloader = { cancel() {}, download: async (e: VoiceModelEntry, emit: (p: DownloadProgress) => void) => { await gate; const out = { ...doneP(e.id), component: e.component, received: entryBytes(e), total: entryBytes(e) }; emit(out); return out; } };
      const handler = makeHandler(store, "voice-crash-fixture");
      const post = () => handler(new Request("http://127.0.0.1/api/v1/voice/download", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer voice-crash-fixture" },
        body: JSON.stringify({ component: "stt", id: "sherpa-small-en" }),
      }));
      const [a, b] = await Promise.all([post(), post()]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const busy = (await (a.status === 409 ? a : b).json()) as { error: string };
      expect(busy.error).toBe("download-busy");
      release();
      for (let i = 0; i < 50 && s.downloader.busy(); i++) await new Promise((r) => setTimeout(r, 10));
      expect(s.downloader.busy()).toBe(false);
      expect(s.downloader.current()?.status).toBe("done");
    } finally {
      store.close();
    }
  });
});
