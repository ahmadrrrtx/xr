/**
 * XR Phase 15 · Voice — offline model catalogue + downloader.
 *
 * Everything the offline voice stack needs is fetched from STABLE public
 * URLs with measured byte sizes (so the desktop never shows a made-up "≈80
 * MB"): the sherpa-onnx WebAssembly runtime from the npm registry, the
 * zipformer-small-en int8 recogniser and Piper voices from Hugging Face.
 *
 * Layout (all under voiceModelDir(), default `$XR_HOME/voice`):
 *   stt/<id>/…                 recogniser files
 *   tts/espeak-ng-data/…       English-only phoneme data shared by every voice
 *   tts/<voiceId>/…            one Piper voice
 * The wasm runtime is extracted to nativeModuleDir()/node_modules/sherpa-onnx
 * (default `~/.voice-native`) so `createRequire` finds it like an npm install.
 *
 * Downloads stream to `<file>.part`, resume with `Range` on retry, and are
 * cancellable. A finished file must match its catalogue size.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { XR_HOME } from "../config/config.ts";

export type VoiceComponent = "runtime" | "stt" | "tts";

export interface VoiceFile {
  readonly url: string;
  /** Path relative to the component root (modelDir or nativeDir). */
  readonly path: string;
  readonly bytes: number;
}

export interface VoiceModelEntry {
  readonly id: string;
  readonly component: VoiceComponent;
  readonly name: string;
  readonly detail: string;
  readonly dir: string;
  readonly files: readonly VoiceFile[];
  /** TTS voices only. */
  readonly label?: string;
  readonly gender?: "male" | "female";
  readonly accent?: string;
}

export function nativeModuleDir(): string {
  return process.env.XR_VOICE_NATIVE_DIR ?? join(homedir(), ".voice-native");
}

export function voiceModelDir(): string {
  return process.env.XR_VOICE_MODEL_DIR ?? join(XR_HOME, "voice");
}

const NPM = "https://registry.npmjs.org/sherpa-onnx/-/sherpa-onnx-1.13.8.tgz";
const HF = "https://huggingface.co";
const STT_REPO = `${HF}/csukuangfj/sherpa-onnx-zipformer-small-en-2023-06-26/resolve/main`;
const piperRepo = (v: string) => `${HF}/csukuangfj/vits-piper-${v}/resolve/main`;

export const RUNTIME_ENTRY: VoiceModelEntry = {
  id: "sherpa-onnx-wasm",
  component: "runtime",
  name: "sherpa-onnx 1.13.8 (WebAssembly runtime)",
  detail: "Runs the recogniser and the voices on this device. 15.4 MB unpacked.",
  dir: ".",
  files: [{ url: NPM, path: "sherpa-onnx-1.13.8.tgz", bytes: 4_320_484 }],
};

export const STT_ENTRIES: readonly VoiceModelEntry[] = [
  {
    id: "sherpa-small-en",
    component: "stt",
    name: "sherpa-onnx zipformer small · English",
    detail: "Offline, int8, ~1× realtime on a laptop CPU.",
    dir: "stt/sherpa-small-en",
    files: [
      { url: `${STT_REPO}/encoder-epoch-99-avg-1.int8.onnx`, path: "encoder-epoch-99-avg-1.int8.onnx", bytes: 26_015_366 },
      { url: `${STT_REPO}/decoder-epoch-99-avg-1.int8.onnx`, path: "decoder-epoch-99-avg-1.int8.onnx", bytes: 1_307_236 },
      { url: `${STT_REPO}/joiner-epoch-99-avg-1.int8.onnx`, path: "joiner-epoch-99-avg-1.int8.onnx", bytes: 259_335 },
      { url: `${STT_REPO}/tokens.txt`, path: "tokens.txt", bytes: 5_048 },
    ],
  },
];

/** English-only espeak-ng phoneme data (the full directory is 355 files / 18 MB). */
const ESPEAK_FILES: readonly [string, number][] = [
  ["phontab", 55_796], ["phonindex", 39_074], ["phondata", 550_424], ["intonations", 2_040], ["en_dict", 166_944],
  ["lang/gmw/en", 140], ["lang/gmw/en-US", 257], ["lang/gmw/en-GB-x-rp", 249], ["lang/gmw/en-GB-scotland", 295],
  ["lang/gmw/en-GB-x-gbclan", 238], ["lang/gmw/en-GB-x-gbcwmd", 188], ["lang/gmw/en-029", 335], ["lang/gmw/en-US-nyc", 271],
];
export const ESPEAK_ENTRY: VoiceModelEntry = {
  id: "espeak-ng-data",
  component: "tts",
  name: "espeak-ng phoneme data · English",
  detail: "Shared by every Piper voice.",
  dir: "tts/espeak-ng-data",
  files: ESPEAK_FILES.map(([p, bytes]) => ({ url: `${piperRepo("en_US-lessac-medium")}/espeak-ng-data/${p}`, path: p, bytes })),
};

function piperVoice(id: string, model: string, label: string, gender: "male" | "female", accent: string, onnxBytes: number, tokensBytes: number, jsonBytes: number): VoiceModelEntry {
  const repo = piperRepo(model);
  return {
    id,
    component: "tts",
    name: `Piper ${model}`,
    detail: `${gender === "male" ? "Male" : "Female"} · ${accent} · 22.05 kHz · offline`,
    dir: `tts/${id}`,
    label,
    gender,
    accent,
    files: [
      { url: `${repo}/${model}.onnx`, path: `${model}.onnx`, bytes: onnxBytes },
      { url: `${repo}/tokens.txt`, path: "tokens.txt", bytes: tokensBytes },
      { url: `${repo}/${model}.onnx.json`, path: `${model}.onnx.json`, bytes: jsonBytes },
    ],
  };
}

/**
 * The four named voices. There is no Pakistani-English Piper voice; "Ahmad"
 * is the clearest neutral US-English voice available and is labelled so.
 */
export const TTS_VOICES: readonly VoiceModelEntry[] = [
  piperVoice("piper-lessac", "en_US-lessac-medium", "Ahmad", "male", "US English", 63_201_425, 921, 4_885),
  piperVoice("piper-amy", "en_US-amy-medium", "Nova", "female", "US English", 63_201_425, 921, 4_885),
  piperVoice("piper-alan", "en_GB-alan-medium", "Atlas", "male", "British English", 63_201_430, 921, 4_885),
  piperVoice("piper-jenny", "en_GB-jenny_dioco-medium", "Sage", "female", "British English", 63_201_430, 921, 4_885),
];
export const DEFAULT_STT_ID = "sherpa-small-en";
export const DEFAULT_TTS_VOICE = "piper-lessac";

export function entryBytes(e: VoiceModelEntry): number {
  return e.files.reduce((n, f) => n + f.bytes, 0);
}

export function findEntry(component: VoiceComponent, id: string): VoiceModelEntry | null {
  if (component === "runtime") return RUNTIME_ENTRY;
  if (component === "stt") return STT_ENTRIES.find((e) => e.id === id) ?? null;
  if (id === ESPEAK_ENTRY.id) return ESPEAK_ENTRY;
  return TTS_VOICES.find((e) => e.id === id) ?? null;
}

function rootFor(e: VoiceModelEntry): string {
  return e.component === "runtime" ? nativeModuleDir() : join(voiceModelDir(), e.dir);
}

/** Absolute path of a catalogue file (what native.ts opens). */
export function filePath(e: VoiceModelEntry, f: VoiceFile): string {
  return join(rootFor(e), f.path);
}

function fileComplete(e: VoiceModelEntry, f: VoiceFile): boolean {
  try {
    return statSync(filePath(e, f)).size === f.bytes;
  } catch {
    return false;
  }
}

/** The runtime is "installed" when the extracted package is present. */
export function runtimeInstalled(): boolean {
  return existsSync(join(nativeModuleDir(), "node_modules", "sherpa-onnx", "sherpa-onnx-wasm-nodejs.wasm"));
}

export function entryInstalled(e: VoiceModelEntry): boolean {
  if (e.component === "runtime") return runtimeInstalled();
  return e.files.every((f) => fileComplete(e, f));
}

export function missingFiles(e: VoiceModelEntry): string[] {
  if (e.component === "runtime") return runtimeInstalled() ? [] : ["sherpa-onnx"];
  return e.files.filter((f) => !fileComplete(e, f)).map((f) => f.path);
}

export interface DownloadProgress {
  component: VoiceComponent;
  id: string;
  status: "downloading" | "extracting" | "done" | "error" | "cancelled";
  received: number;
  total: number;
  percent: number;
  file?: string;
  detail?: string;
}

/** Everything a first run needs for the given voice, in install order. */
export function firstRunPlan(ttsVoice = DEFAULT_TTS_VOICE): VoiceModelEntry[] {
  const voice = findEntry("tts", ttsVoice) ?? TTS_VOICES[0];
  return [RUNTIME_ENTRY, STT_ENTRIES[0], ESPEAK_ENTRY, voice].filter((e) => !entryInstalled(e));
}

// ─── Downloader ────────────────────────────────────────────────────────────

export class VoiceDownloader {
  private controller: AbortController | null = null;
  private active: DownloadProgress | null = null;

  current(): DownloadProgress | null {
    return this.active;
  }

  cancel(): void {
    this.controller?.abort();
  }

  /**
   * Download one catalogue entry (plus the shared espeak data for a voice).
   * Resolves with the final progress; never throws — errors are reported
   * through the progress callback and the return value.
   */
  async download(e: VoiceModelEntry, onProgress: (p: DownloadProgress) => void, fetchFn: typeof fetch = fetch): Promise<DownloadProgress> {
    if (this.controller) return { component: e.component, id: e.id, status: "error", received: 0, total: 0, percent: 0, detail: "another download is running" };
    const entries = e.component === "tts" && e.id !== ESPEAK_ENTRY.id && !entryInstalled(ESPEAK_ENTRY) ? [ESPEAK_ENTRY, e] : [e];
    const total = entries.reduce((n, x) => n + entryBytes(x), 0);
    this.controller = new AbortController();
    const signal = this.controller.signal;
    let received = 0;
    let lastEmit = 0;
    const emit = (p: Partial<DownloadProgress> & { status: DownloadProgress["status"] }, force = false) => {
      const now = Date.now();
      if (!force && p.status === "downloading" && now - lastEmit < 150) return;
      lastEmit = now;
      this.active = {
        component: e.component,
        id: e.id,
        received,
        total,
        percent: total > 0 ? Math.min(100, Math.round((received / total) * 1000) / 10) : 0,
        ...p,
      };
      onProgress(this.active);
    };
    try {
      for (const entry of entries) {
        for (const f of entry.files) {
          const target = filePath(entry, f);
          if (fileComplete(entry, f)) {
            received += f.bytes;
            emit({ status: "downloading", file: f.path });
            continue;
          }
          await this.fetchFile(f, target, signal, fetchFn, (delta) => {
            received += delta;
            emit({ status: "downloading", file: f.path });
          });
        }
        if (entry.component === "runtime") {
          emit({ status: "extracting", file: "sherpa-onnx" }, true);
          extractNpmTarball(filePath(entry, entry.files[0]), join(nativeModuleDir(), "node_modules", "sherpa-onnx"));
          if (!runtimeInstalled()) throw new Error("runtime extracted but sherpa-onnx-wasm-nodejs.wasm is missing");
        }
      }
      emit({ status: "done" }, true);
    } catch (err) {
      const aborted = signal.aborted || (err as Error)?.name === "AbortError";
      emit({ status: aborted ? "cancelled" : "error", detail: aborted ? "cancelled" : String((err as Error)?.message ?? err).slice(0, 200) }, true);
    } finally {
      this.controller = null;
    }
    const out = this.active!;
    this.active = null;
    return out;
  }

  /** Stream one file to `<target>.part` (resuming with Range), verify the size, rename into place. */
  private async fetchFile(f: VoiceFile, target: string, signal: AbortSignal, fetchFn: typeof fetch, onDelta: (n: number) => void): Promise<void> {
    mkdirSync(dirname(target), { recursive: true });
    const part = `${target}.part`;
    let have = 0;
    try {
      have = statSync(part).size;
    } catch {
      have = 0;
    }
    if (have >= f.bytes) {
      rmSync(part, { force: true });
      have = 0;
    }
    const res = await fetchFn(f.url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, signal, redirect: "follow" });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${f.path}`);
    const resumed = res.status === 206 && have > 0;
    if (!resumed) have = 0;
    const declared = Number(res.headers.get("content-length") ?? 0);
    // The catalogue size is what the UI promised; refuse a silently different payload.
    if (declared > 0 && declared !== f.bytes - have) {
      throw new Error(`unexpected size for ${f.path}: server ${declared + have} B, catalogue ${f.bytes} B`);
    }
    if (have > 0) onDelta(have);
    const fd = openSync(part, resumed ? "a" : "w");
    try {
      if (!res.body) throw new Error("empty response body");
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) {
          writeSync(fd, value);
          onDelta(value.length);
        }
      }
    } finally {
      closeSync(fd);
    }
    const size = statSync(part).size;
    if (size !== f.bytes) throw new Error(`${f.path}: got ${size} B, expected ${f.bytes} B`);
    renameSync(part, target);
  }
}

// ─── npm tarball extraction (gzip + ustar, no dependencies) ────────────────

/** Extract `package/*` from an npm tgz into `dest` (strips the first segment). */
export function extractNpmTarball(tgzPath: string, dest: string): number {
  const tar = gunzipSync(readFileSync(tgzPath));
  let off = 0;
  let written = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = cstr(header, 0, 100);
    const prefix = cstr(header, 345, 155);
    const size = parseInt(cstr(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 48);
    off += 512;
    const full = prefix ? `${prefix}/${name}` : name;
    const rel = full.split("/").slice(1).join("/");
    if ((type === "0" || type === "\0") && rel && !rel.includes("..")) {
      const out = join(dest, rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, tar.subarray(off, off + size));
      written++;
    }
    off += Math.ceil(size / 512) * 512;
  }
  return written;
}

function cstr(buf: Uint8Array, start: number, len: number): string {
  let end = start;
  while (end < start + len && buf[end] !== 0) end++;
  return Buffer.from(buf.subarray(start, end)).toString("utf8");
}

/** Remove every downloaded model and the extracted runtime. */
export function clearVoiceModels(): { removed: string[] } {
  const removed: string[] = [];
  for (const p of [join(voiceModelDir(), "stt"), join(voiceModelDir(), "tts"), join(nativeModuleDir(), "node_modules", "sherpa-onnx"), join(nativeModuleDir(), RUNTIME_ENTRY.files[0].path)]) {
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      removed.push(p);
    }
  }
  return { removed };
}
