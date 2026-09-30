/*
 * Phase 3 — hardware / runtime detection, typed + graceful.
 *
 * Inside Tauri the commands run in Rust (sysinfo + ureq). In a plain browser
 * (bun dev / Playwright) everything falls back to a deterministic mock so the
 * whole onboarding flow is testable without the native shell. GPU + mic are
 * probed with webview APIs in both hosts.
 */
import { isTauri } from '@/lib/tauri';

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
  /** e.g. "Apple M3 Pro" or "NVIDIA GeForce RTX 4090"; null when unknown. */
  name: string | null;
  /** True when the only renderer is software (SwiftShader / llvmpipe). */
  software: boolean;
}

export interface MicInfo {
  devices: { id: string; label: string }[];
  permission: 'granted' | 'denied' | 'prompt';
}

/** RAM-tier → recommended local model (docs/phases/03 plan §4). */
export function recommendModel(ramGb: number): { model: string; label: string; sizeGb: number } {
  if (ramGb < 8) return { model: 'qwen2.5:0.5b', label: 'Qwen2.5 0.5B', sizeGb: 0.5 };
  if (ramGb < 16) return { model: 'qwen2.5:3b', label: 'Qwen2.5 3B', sizeGb: 2 };
  if (ramGb < 32) return { model: 'qwen2.5:7b', label: 'Qwen2.5 7B', sizeGb: 4.7 };
  return { model: 'qwen2.5-coder:7b', label: 'Qwen2.5 Coder 7B', sizeGb: 4.7 };
}

export async function detectSystem(): Promise<SystemInfo> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<SystemInfo>('detect_system');
    } catch {
      /* fall through to mock */
    }
  }
  // Browser dev: deterministic "great machine" mock.
  return {
    os: 'macOS',
    osVersion: '15 (browser dev)',
    arch: 'arm64',
    cpuBrand: 'Apple M3 Pro',
    cpuCores: 11,
    totalMemoryGb: 36,
  };
}

export async function detectOllama(): Promise<OllamaInfo> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<OllamaInfo>('detect_ollama');
    } catch {
      /* fall through to mock */
    }
  }
  return {
    installed: true,
    version: '0.5.7 (mock)',
    models: [{ name: 'qwen2.5:3b', sizeGb: 1.9 }],
  };
}

export async function detectGpu(): Promise<GpuInfo> {
  // WebGPU adapter info (Chrome/Edge/Safari 17+), then WebGL renderer string.
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
