/*
 * Phase 3 — hardware / runtime detection, typed + honest.
 *
 * Inside Tauri the commands run in Rust (sysinfo + ureq). GPU + mic are probed
 * with webview APIs in both hosts.
 *
 * THERE IS NO MOCK. XR-REL-01: this module used to fabricate a fixed machine
 * profile (a laptop the user does not own, with 36 GB of RAM) and an installed
 * Ollama whenever a probe failed — including
 * when the shell DENIED the IPC call, which is the likeliest failure in a
 * packaged build — and a hardcoded hardware profile was then used to recommend
 * (and download) a model. A detection that cannot run now returns `null` /
 * `unknown` and the caller must say so. A wrong number here is worse than no
 * number: the wizard would offer a 4.7 GB download tuned to hardware the user
 * does not have.
 */
import { isTauri } from '@/lib/tauri';

/**
 * Which detection could not run, and why. `cause` is for the console / the
 * "Copy diagnostics" path — never rendered as if it were a hardware fact.
 */
export class DetectionUnavailable extends Error {
  readonly probe: DetectionProbe;
  override readonly cause: unknown;

  constructor(probe: DetectionProbe, cause: unknown) {
    super(
      probe === 'system'
        ? 'The XR engine could not read this machine\u2019s hardware.'
        : probe === 'ollama'
          ? 'Could not check whether Ollama is running.'
          : 'GPU detection is unavailable in this build.'
    );
    this.name = 'DetectionUnavailable';
    this.probe = probe;
    this.cause = cause;
  }
}

export type DetectionProbe = 'system' | 'gpu' | 'ollama';

export interface SystemInfo {
  os: string;
  osVersion: string;
  arch: string;
  cpuBrand: string;
  cpuCores: number;
  totalMemoryGb: number;
}

export interface OllamaModel {
  name: string;
  sizeGb: number;
}

export interface OllamaInfo {
  installed: boolean;
  version?: string;
  models: OllamaModel[];
}

export interface GpuInfo {
  /** e.g. "NVIDIA GeForce RTX 4090"; null when unknown. */
  name: string | null;
  /** True when the only renderer is software (SwiftShader / llvmpipe). */
  software: boolean;
}

export interface MicInfo {
  devices: { id: string; label: string }[];
  permission: 'granted' | 'denied' | 'prompt';
}

/**
 * RAM-tier → recommended local model (docs/phases/03 plan §4).
 *
 * `ramGb` is REQUIRED and must be a measured value: there is deliberately no
 * default. `null` means "hardware not measured", which is not a RAM tier — the
 * old `recommendModel(ram ?? 0)` silently answered "0.5B" for an unknown
 * machine, so an unreadable system quietly got a model recommendation.
 */
export function recommendModel(ramGb: number): { model: string; label: string; sizeGb: number } {
  if (!Number.isFinite(ramGb) || ramGb <= 0)
    throw new RangeError('recommendModel requires a measured RAM value in GB');
  if (ramGb < 8) return { model: 'qwen2.5:0.5b', label: 'Qwen2.5 0.5B', sizeGb: 0.5 };
  if (ramGb < 16) return { model: 'qwen2.5:3b', label: 'Qwen2.5 3B', sizeGb: 2 };
  if (ramGb < 32) return { model: 'qwen2.5:7b', label: 'Qwen2.5 7B', sizeGb: 4.7 };
  return { model: 'qwen2.5-coder:7b', label: 'Qwen2.5 Coder 7B', sizeGb: 4.7 };
}

export async function detectSystem(): Promise<SystemInfo> {
  if (!isTauri())
    throw new DetectionUnavailable(
      'system',
      new Error('no native shell (browser / preview build)')
    );
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const info = await invoke<SystemInfo>('detect_system');
    // Validate before returning: a malformed/partial payload must not become
    // the table the wizard displays. `totalMemoryGb` drives a model download.
    if (!info || typeof info !== 'object')
      throw new Error('detect_system returned no payload');
    if (!Number.isFinite(info.totalMemoryGb) || info.totalMemoryGb <= 0)
      throw new Error('detect_system returned no usable totalMemoryGb');
    return info;
  } catch (cause) {
    throw new DetectionUnavailable('system', cause);
  }
}

export async function detectOllama(): Promise<OllamaInfo> {
  if (!isTauri())
    throw new DetectionUnavailable(
      'ollama',
      new Error('no native shell (browser / preview build)')
    );
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const info = await invoke<OllamaInfo>('detect_ollama');
    if (!info || typeof info.installed !== 'boolean')
      throw new Error('detect_ollama returned no usable payload');
    return { ...info, models: Array.isArray(info.models) ? info.models : [] };
  } catch (cause) {
    throw new DetectionUnavailable('ollama', cause);
  }
}

export async function detectGpu(): Promise<GpuInfo> {
  // WebGPU adapter info (Chrome/Edge/Safari 17+), then WebGL renderer string.
  // Unlike hardware/RAM, these are pure webview probes with no IPC and no
  // capability gate, so a failure here is genuinely "no GPU", not "unknown".
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<null | { info?: { vendor?: string; architecture?: string; device?: string; description?: string } }> } }).gpu;
    if (gpu) {
      const adapter = await gpu.requestAdapter();
      if (adapter?.info) {
        const i = adapter.info;
        const name = i.description || [i.vendor, i.device || i.architecture].filter(Boolean).join(' ') || null;
        if (name) {
          return { name, software: /swiftshader|software|llvmpipe/i.test(name) };
        }
      }
    }
  } catch {
    /* try WebGL */
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const raw = dbg
        ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string)
        : gl.getParameter(gl.VERSION);
      if (raw) {
        return { name: raw, software: /swiftshader|software|llvmpipe/i.test(raw) };
      }
    }
  } catch {
    /* no GL */
  }
  return { name: null, software: false };
}


export async function detectMics(requestPermission: boolean): Promise<MicInfo> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    return { devices: [], permission: 'prompt' };
  }
  let permission: MicInfo['permission'] = 'prompt';
  if (requestPermission) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      permission = 'granted';
    } catch (err) {
      permission = err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'prompt';
    }
  } else {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      permission = status.state as MicInfo['permission'];
    } catch {
      /* permissions API unsupported — assume prompt */
    }
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      devices: devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ id: d.deviceId, label: d.label || 'Microphone' })),
      permission,
    };
  } catch {
    return { devices: [], permission };
  }
}

export interface PullProgressEvent {
  id: number;
  status: 'pulling' | 'verifying' | 'success' | 'error';
  completed?: number;
  total?: number;
  detail?: string;
}

/** Start a pull; returns the event id + a subscribe fn. Mocks in browser. */
export async function startOllamaPull(
  model: string,
  onProgress: (e: PullProgressEvent) => void,
): Promise<{ id: number; unsubscribe: () => void }> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<PullProgressEvent>('ollama://pull-progress', (e) => onProgress(e.payload));
    const id = await invoke<number>('ollama_pull', { model });
    return { id, unsubscribe: () => void unlisten() };
  }
  // Browser dev: simulated pull over ~6s with realistic layer phases.
  const id = Math.floor(Math.random() * 1e6);
  let cancelled = false;
  const total = 2_100_000_000;
  const started = Date.now();
  const tick = window.setInterval(() => {
    if (cancelled) return;
    const elapsed = Date.now() - started;
    if (elapsed > 6200) {
      window.clearInterval(tick);
      onProgress({ id, status: 'success' });
      return;
    }
    const frac = Math.min(0.97, elapsed / 6000);
    onProgress({
      id,
      status: elapsed > 5600 ? 'verifying' : 'pulling',
      completed: Math.round(total * frac),
      total,
      detail: 'pulling a6e87b2a...',
    });
  }, 250);
  return {
    id,
    unsubscribe: () => {
      cancelled = true;
      window.clearInterval(tick);
    },
  };
}

/** Open a URL in the system browser (Ollama download page). */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, '_blank', 'noopener');
}

/**
 * XR-REL-01 — resolve a detection to `value | null`, recording WHY it failed.
 *
 * Every onboarding caller uses this so "unknown" is a first-class outcome with
 * a reason attached, instead of a fabricated value or a silent `null`. The
 * reason is a short operator-facing line; the raw cause is logged once.
 */
export async function probeDetection<T>(
  probe: DetectionProbe,
  run: () => Promise<T>
): Promise<{ value: T; failure: null } | { value: null; failure: string }> {
  try {
    return { value: await run(), failure: null };
  } catch (error) {
    const message =
      error instanceof DetectionUnavailable
        ? error.message
        : 'The probe failed for an unexpected reason.';
    if (!(error instanceof DetectionUnavailable)) {
      console.warn(`[xr] ${probe} probe failed`, error);
    }
    return { value: null, failure: message };
  }
}
