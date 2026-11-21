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
 * Every URL is an immutable revision with a pinned sha256, verified while the
 * file streams to `<file>.part` with stall/deadline-bounded Range-resume
 * retries (fetch-file.ts, B2/B3); `bytes` is the progress total the UI shows.
 */
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { XR_HOME } from "../config/config.ts";
import { downloadPolicy, fetchVerified, type DownloadPolicy } from "./fetch-file.ts";
import { extractNpmTarball } from "./tar.ts";
import { describeThrown } from "../util/thrown.ts";
export { extractNpmTarball };

export type VoiceComponent = "runtime" | "stt" | "tts";

export interface VoiceFile {
  readonly url: string;
  /** Path relative to the component root (modelDir or nativeDir). */
  readonly path: string;
  /** Exact size: the progress total, and a cheap early refusal of a different payload. */
  readonly bytes: number;
  /** Lowercase hex SHA-256 of the exact file — the integrity proof. */
  readonly sha256: string;
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
// B3: Hugging Face revisions are commit SHAs (pinned 2026-11-19), never `main`. sha256: the LFS oid
// from /api/models/<repo>/tree/<sha>; small non-LFS files hashed from bytes whose git blob id matches
// that tree; the npm tarball checked against the registry sha512. See HARDENING_LOG.md (Phase 2).
const STT_REPO = `${HF}/csukuangfj/sherpa-onnx-zipformer-small-en-2023-06-26/resolve/e8add5377a6cb7b629b5a0e08d6afe7a73442814`;
const piperRepo = (v: string, rev: string) => `${HF}/csukuangfj/vits-piper-${v}/resolve/${rev}`;
const LESSAC_REV = "83f7470750b36549037551ef7007fa3b4b8697e0";
type Pinned = readonly [bytes: number, sha256: string];

export const RUNTIME_ENTRY: VoiceModelEntry = {
  id: "sherpa-onnx-wasm",
  component: "runtime",
  name: "sherpa-onnx 1.13.8 (WebAssembly runtime)",
  detail: "Runs the recogniser and the voices on this device. 15.4 MB unpacked.",
  dir: ".",
  files: [{ url: NPM, path: "sherpa-onnx-1.13.8.tgz", bytes: 4_320_484, sha256: "15dc53065cc6bbc73ddbb1b216bccb5660233b7626460d7c62baf78e7f3c3f43" }],
};

export const STT_ENTRIES: readonly VoiceModelEntry[] = [
  {
    id: "sherpa-small-en",
    component: "stt",
    name: "sherpa-onnx zipformer small · English",
    detail: "Offline, int8, ~1× realtime on a laptop CPU.",
    dir: "stt/sherpa-small-en",
    files: [
      { url: `${STT_REPO}/encoder-epoch-99-avg-1.int8.onnx`, path: "encoder-epoch-99-avg-1.int8.onnx", bytes: 26_015_366, sha256: "3a6ac78a31cc2c60ca8c1e2e2f43c878fbbcaf051ada4900e0a42ef8ba53d375" },
      { url: `${STT_REPO}/decoder-epoch-99-avg-1.int8.onnx`, path: "decoder-epoch-99-avg-1.int8.onnx", bytes: 1_307_236, sha256: "f462ab9189ba6f9b2658774e6bf3d651913de54a3833655dc5e093e2f5e4c2b6" },
      { url: `${STT_REPO}/joiner-epoch-99-avg-1.int8.onnx`, path: "joiner-epoch-99-avg-1.int8.onnx", bytes: 259_335, sha256: "6b183b6ec656e4d3ca6b86d0aeca992dac14df80aae6b416d7c068d0ff2bd4d7" },
      { url: `${STT_REPO}/tokens.txt`, path: "tokens.txt", bytes: 5_048, sha256: "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb" },
    ],
  },
];

/** English-only espeak-ng phoneme data (the full directory is 355 files / 18 MB). */
const ESPEAK_FILES: readonly [string, number, string][] = [
  ["phontab", 55_796, "886f3fa402cb0ba73d483aa8ad000af47a6b7cc06293c75a97913fba68a530f6"], ["phonindex", 39_074, "3ca7b8fa3b42624e4b0f152707e7a39245fce569aa99ea47c055d9e622fcf0c4"],
  ["phondata", 550_424, "4e0288957874029a8c3c9f41a8f517ad4bf18127046decbdd4b9d1d6807ce3a3"], ["intonations", 2_040, "3f8af65fd3eda9759a10f021d61361c120871f463515229c925995c7f90918cc"],
  ["en_dict", 166_944, "71bd330ba8a2e3e8076e631508208ef49449d6147c17b7bd2b4b1e1468292e35"], ["lang/gmw/en", 140, "4605d5330801de3641c6e366d15f129ea1f5ffbce8722642aba01ace07ab9c83"],
  ["lang/gmw/en-US", 257, "41534c2a22df5dd4f1052ff9e1a33a3ea7bff5a26b5c02bdad5ba8ddb7524704"], ["lang/gmw/en-GB-x-rp", 249, "d0625af7f58561b1b8cf96fd7f93eee6553bcb3eadb9020ae0757bf96e5115e5"],
  ["lang/gmw/en-GB-scotland", 295, "1ce4282c1f4385dbaf0035e799b2ab1ee9e9a3ab4829100594a3047727b52353"], ["lang/gmw/en-GB-x-gbclan", 238, "2040e176f1f7f27bdce81c32d7e2b1662449d54d264afd3c0ed871b8e42b6e46"],
  ["lang/gmw/en-GB-x-gbcwmd", 188, "927a5ab891c65b30b4426b151d1623a01024f6b773a38497ba1c90cd77a95747"], ["lang/gmw/en-029", 335, "faeb8cb201056775f733acbd908c66555fe57bf01cb063920f178f389cbf85d3"],
  ["lang/gmw/en-US-nyc", 271, "e8ee9168376d1f7d9e7dcda7c4644c36c529a8bea816e6380895364db46ea2e3"],
];
export const ESPEAK_ENTRY: VoiceModelEntry = {
  id: "espeak-ng-data",
  component: "tts",
  name: "espeak-ng phoneme data · English",
  detail: "Shared by every Piper voice.",
  dir: "tts/espeak-ng-data",
  files: ESPEAK_FILES.map(([p, bytes, sha256]) => ({ url: `${piperRepo("en_US-lessac-medium", LESSAC_REV)}/espeak-ng-data/${p}`, path: p, bytes, sha256 })),
};

function piperVoice(id: string, model: string, rev: string, label: string, gender: "male" | "female", accent: string, onnx: Pinned, tokens: Pinned, json: Pinned): VoiceModelEntry {
  const repo = piperRepo(model, rev);
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
      { url: `${repo}/${model}.onnx`, path: `${model}.onnx`, bytes: onnx[0], sha256: onnx[1] },
      { url: `${repo}/tokens.txt`, path: "tokens.txt", bytes: tokens[0], sha256: tokens[1] },
      { url: `${repo}/${model}.onnx.json`, path: `${model}.onnx.json`, bytes: json[0], sha256: json[1] },
    ],
  };
}

/**
 * The four named voices (2026-11-01 revision). The previous set labelled the
 * Piper `lessac` voice "Ahmad · male", but lessac is a FEMALE voice — the
 * owner rightly rejected it. The replacements were chosen per label:
 *
 *   Ahmad  en_US-kusal   — a younger, lighter MALE Piper voice; the default.
 *                          There is no Pakistani-English Piper voice.
 *   Nova   en_US-kristin — bright, clear female.
 *   Atlas  en_US-ryan    — the deep, measured male.
 *   Sage   en_US-amy     — calm, considered female.
 *
 * Sizes and sha256 per file at the pinned revision (kusal/ryan/amy share one
 * tokens.txt); re-pinning a voice means updating its revision, sizes and hashes together.
 */
const PIPER_TOKENS: Pinned = [921, "87c8ef66eae5473ed0cc0366b3964c736ca6c5f676c979522ea31234e47430b9"];
export const TTS_VOICES: readonly VoiceModelEntry[] = [
  piperVoice("piper-kusal", "en_US-kusal-medium", "54090df5c0e0dfa85b00953aeaadad7dd1aec948", "Ahmad", "male", "US English",
    [63_201_425, "d7b0e39e4e73fecff92e53221a63008f28e44d98993a94e549470130eae2ccee"], PIPER_TOKENS, [4_884, "ddd3c4dfd8b4f568150c934fb94912dd788d44db87f4f0a328c469d7a6761f41"]),
  piperVoice("piper-kristin", "en_US-kristin-medium", "6fdc68249ba2b1b41c1c42ec74341d1599e2c96e", "Nova", "female", "US English",
    [63_531_507, "f9a5c375c70ddc33ccdb3969c76a4d7cc5255ac08119a312b0034a1d07041be6"], [940, "ef3a7e4a8d1af0c9d4dc45aaae1a6242ebe24a7ed6f3d025a49eb29682784c6d"], [4_968, "5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c"]),
  piperVoice("piper-ryan", "en_US-ryan-medium", "2784cf0f7510312ed567a5d227bcbec28dcd661e", "Atlas", "male", "US English",
    [63_201_425, "8a4063318faeda9bf67f89d25b29cc4bd5fde8832422aa451a5d5d2647553081"], PIPER_TOKENS, [4_883, "44034c056cb15681b2ad494307c7f3f2e4499d1253c700c711fa0a4607ffe78d"]),
  piperVoice("piper-amy", "en_US-amy-medium", "79936839cc9409b1a752a45c629fe21639e1c1b2", "Sage", "female", "US English",
    [63_201_425, "fbaa8e36d8f26fe6f3ebb65cab461e629d8b37a5b7c5fb78fb64317db73e1c25"], PIPER_TOKENS, [4_882, "95a23eb4d42909d38df73bb9ac7f45f597dbfcde2d1bf9526fdeaf5466977d77"]),
];
export const DEFAULT_STT_ID = "sherpa-small-en";
export const DEFAULT_TTS_VOICE = "piper-kusal";

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
  private readonly policy: DownloadPolicy;

  constructor(policy: Partial<DownloadPolicy> = {}) {
    this.policy = downloadPolicy(policy);
  }

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
          await fetchVerified(f, target, signal, fetchFn, (delta) => {
            received += delta;
            emit({ status: "downloading", file: f.path });
          }, this.policy);
        }
        if (entry.component === "runtime") {
          emit({ status: "extracting", file: "sherpa-onnx" }, true);
          await extractNpmTarball(filePath(entry, entry.files[0]), join(nativeModuleDir(), "node_modules", "sherpa-onnx"));
          if (!runtimeInstalled()) throw new Error("runtime extracted but sherpa-onnx-wasm-nodejs.wasm is missing");
        }
      }
      emit({ status: "done" }, true);
    } catch (err) {
      const aborted = signal.aborted || (err as Error)?.name === "AbortError";
      emit({ status: aborted ? "cancelled" : "error", detail: aborted ? "cancelled" : describeThrown(err, 200) }, true);
    } finally {
      this.controller = null;
    }
    const out = this.active!;
    this.active = null;
    return out;
  }
}

/** Remove every downloaded model and the extracted runtime. */
export function clearVoiceModels(): { removed: string[] } {
  const removed: string[] = [];
  for (const p of [join(voiceModelDir(), "stt"), join(voiceModelDir(), "tts"), join(nativeModuleDir(), "node_modules", "sherpa-onnx"), join(nativeModuleDir(), RUNTIME_ENTRY.files[0].path), join(nativeModuleDir(), `${RUNTIME_ENTRY.files[0].path}.part`)]) {
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      removed.push(p);
    }
  }
  return { removed };
}
