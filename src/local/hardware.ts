/** XR Stage 4 — deterministic hardware/spec detection for local AI. */
import { arch, cpus, freemem, platform, release, totalmem } from "node:os";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { statfsSync } from "node:fs";
import { runCommand } from "../util/process.ts";
import { TtlCache } from "../util/ttl-cache.ts";
import { xrMetrics } from "../observability/metrics.ts";

export type HardwareTier = "unsupported" | "lightweight" | "medium" | "heavy";

export interface GpuInfo {
  vendor: "nvidia" | "apple" | "amd" | "intel" | "unknown";
  name: string;
  vramGb?: number;
  acceleration: string[];
}

export interface HardwareSpecs {
  os: NodeJS.Platform;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalRamGb: number;
  freeRamGb: number;
  availableDiskGb: number;
  gpus: GpuInfo[];
  acceleration: string[];
  tier: HardwareTier;
  suitability: {
    lightweight: boolean;
    medium: boolean;
    heavy: boolean;
    reason: string;
  };
}

// ── Phase 01 · hardware detection performance ───────────────────────────────
//
// The previous implementation ran `nvidia-smi` / PowerShell / `lspci` with
// BLOCKING spawnSync on EVERY request (3.5 s+ wall per call on a machine with
// slow GPU tooling), so every `/api/models` request paid the full cost and the
// dashboard's first paint was blocked on it.
//
// Now: expensive process probes are ASYNC (Bun.spawn via util/process.ts,
// kill-on-timeout), results are CACHED (TTL 5 min, stale-while-revalidate 5
// min, deduped), and the daemon refreshes hardware in the BACKGROUND at
// startup + every TTL. `statfsSync` deliberately stays synchronous — it is a
// cheap <1 ms syscall (the spec's "fast + safe sync" carve-out). The sync
// `detectHardwareSpecs()` API is preserved for the CLI (user-invoked paths)
// and now serves from the shared cache when fresh.
//
// Rollback: XR_HARDWARE_CACHE=0|false disables the cache only.
// Tuning: XR_HARDWARE_CACHE_TTL_MS overrides the 5-minute TTL.

const HARDWARE_CACHE_TTL_MS =
  Number(process.env.XR_HARDWARE_CACHE_TTL_MS ?? 5 * 60_000) > 0
    ? Number(process.env.XR_HARDWARE_CACHE_TTL_MS ?? 5 * 60_000)
    : 5 * 60_000;
const HARDWARE_CACHE_SWR_MS = HARDWARE_CACHE_TTL_MS; // up to 2×TTL while refreshing

export function hardwareCacheEnabled(): boolean {
  const raw = process.env.XR_HARDWARE_CACHE;
  return raw === undefined || raw === "" || !/^(0|false|off|no)$/i.test(raw);
}

const hardwareCache = new TtlCache<HardwareSpecs>({
  ttlMs: HARDWARE_CACHE_TTL_MS,
  staleWhileRevalidateMs: HARDWARE_CACHE_SWR_MS,
  maxEntries: 2,
  onStats: (event) => {
    if (event === "hit") xrMetrics.hardwareCacheHits.inc();
    else if (event === "miss") xrMetrics.hardwareCacheMisses.inc();
    else if (event === "dedup") xrMetrics.deduplicatedRequests.inc({ resource: "hardware" });
    else xrMetrics.hardwareCacheRefreshes.inc();
  },
});

/** Test/ops hooks. */
export function hardwareCacheStats() {
  return { ...hardwareCache.stats(), enabled: hardwareCacheEnabled(), ttlMs: HARDWARE_CACHE_TTL_MS };
}
export function invalidateHardwareCache(): void {
  hardwareCache.clear();
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Stop the periodic background refresh (tests). */
export function stopHardwareBackgroundRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Daemon startup hook: probe hardware in the background (never blocks startup
 * or /api/health) and refresh periodically. Fire-and-forget — never throws.
 */
export function startHardwareBackgroundRefresh(): void {
  if (!hardwareCacheEnabled()) return;
  void getHardwareSpecs().catch(() => {
    /* background refresh failure is non-fatal; next access retries */
  });
  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      void getHardwareSpecs().catch(() => {});
    }, HARDWARE_CACHE_TTL_MS);
    (refreshTimer as unknown as { unref?: () => void }).unref?.();
  }
}

function gb(bytes: number): number {
  return Math.max(0, Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10);
}

// ── Sync probes (legacy CLI path; cheap reads only where noted) ─────────────

function runSync(cmd: string, args: string[], timeout = 2500): string {
  const res = spawnSync(cmd, args, { encoding: "utf8", timeout, windowsHide: true });
  if (res.status !== 0) return "";
  return `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
}

function runShellSync(script: string): string {
  if (platform() === "win32") return runSync("powershell.exe", ["-NoProfile", "-Command", script], 4000);
  return runSync("sh", ["-lc", script], 4000);
}

// ── Async probes (daemon request path; never block) ─────────────────────────

async function runAsync(cmd: string, args: string[], timeout = 2500): Promise<string> {
  const r = await runCommand(cmd, args, { timeoutMs: timeout, windowsHide: true });
  if (!r.ok) return "";
  return `${r.stdout}${r.stderr}`.trim();
}

async function runShellAsync(script: string): Promise<string> {
  if (platform() === "win32") return runAsync("powershell.exe", ["-NoProfile", "-Command", script], 4000);
  return runAsync("sh", ["-lc", script], 4000);
}

function detectDiskGb(): number {
  try {
    const s = statfsSync(homedir());
    return gb(Number(s.bavail) * Number(s.bsize));
  } catch {
    return 0;
  }
}

function parseNvidia(out: string): GpuInfo[] {
  if (!out) return [];
  return out.split("\n").filter(Boolean).map((line) => {
    const [name, mem] = line.split(",").map((s) => s.trim());
    return {
      vendor: "nvidia" as const,
      name: name || "NVIDIA GPU",
      vramGb: mem ? Math.round((Number(mem) / 1024) * 10) / 10 : undefined,
      acceleration: ["cuda"],
    };
  });
}

/** Exported for cross-platform unit testing of the Windows parsing logic. */
export function parseWindowsGpu(out: string): GpuInfo[] {
  if (!out) return [];
  try {
    const parsed = JSON.parse(out);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((r: any) => {
      const name = String(r.Name ?? "GPU");
      const lower = name.toLowerCase();
      const vendor = lower.includes("nvidia") ? "nvidia" : lower.includes("amd") || lower.includes("radeon") ? "amd" : lower.includes("intel") ? "intel" : "unknown";
      const ram = Number(r.AdapterRAM ?? 0);
      const acceleration = vendor === "nvidia" ? ["cuda"] : vendor === "amd" ? ["directml", "vulkan"] : vendor === "intel" ? ["directml", "vulkan"] : [];
      return { vendor, name, vramGb: ram > 0 ? gb(ram) : undefined, acceleration } as GpuInfo;
    });
  } catch {
    return [];
  }
}

function parseLinuxGpu(out: string): GpuInfo[] {
  if (!out) return [];
  return out.split("\n").slice(0, 4).map((line) => {
    const lower = line.toLowerCase();
    const vendor = lower.includes("nvidia") ? "nvidia" : lower.includes("amd") || lower.includes("radeon") ? "amd" : lower.includes("intel") ? "intel" : "unknown";
    const acceleration = vendor === "nvidia" ? ["cuda"] : vendor === "amd" ? ["rocm", "vulkan"] : vendor === "intel" ? ["vulkan"] : [];
    return { vendor, name: line.replace(/^.*?:\s*/, "").slice(0, 100), acceleration } as GpuInfo;
  });
}

function detectAppleGpu(): GpuInfo[] {
  if (platform() !== "darwin") return [];
  const cpu = cpus()[0]?.model ?? "";
  const isAppleSilicon = arch() === "arm64" || /Apple M\d/i.test(cpu);
  if (!isAppleSilicon) return [];
  return [{ vendor: "apple", name: cpu || "Apple Silicon GPU", vramGb: Math.max(4, Math.floor(gb(totalmem()) * 0.65)), acceleration: ["metal"] }];
}

function classify(totalRamGb: number, diskGb: number, gpus: GpuInfo[]): HardwareSpecs["suitability"] & { tier: HardwareTier } {
  const maxVram = Math.max(0, ...gpus.map((g) => g.vramGb ?? 0));
  const hasApple = gpus.some((g) => g.vendor === "apple");
  const hasGpu = maxVram >= 6 || hasApple;
  const diskOk = diskGb === 0 || diskGb >= 6;
  const lightweight = totalRamGb >= 4 && diskOk;
  const medium = totalRamGb >= 8 && (diskGb === 0 || diskGb >= 10);
  const heavy = totalRamGb >= 32 && (diskGb === 0 || diskGb >= 24) && (hasGpu || totalRamGb >= 48);
  let tier: HardwareTier = "unsupported";
  if (heavy) tier = "heavy";
  else if (medium) tier = "medium";
  else if (lightweight) tier = "lightweight";
  const reason = !lightweight
    ? `Local AI is constrained: ${totalRamGb}GB RAM and ${diskGb || "unknown"}GB free disk detected.`
    : heavy
      ? "High-memory machine; larger local models are practical."
      : medium
        ? "Good local AI machine; 7B/8B models are practical."
        : "Low-end local AI machine; XR should use small CPU-friendly models.";
  return { tier, lightweight, medium, heavy, reason };
}

function assemble(cpuList: ReturnType<typeof cpus>, gpus: GpuInfo[], totalRamGb: number, availableDiskGb: number): HardwareSpecs {
  const suitability = classify(totalRamGb, availableDiskGb, gpus);
  return {
    os: platform(),
    osRelease: release(),
    arch: arch(),
    cpuModel: cpuList[0]?.model ?? "unknown CPU",
    cpuCores: cpuList.length || 1,
    totalRamGb,
    freeRamGb: gb(freemem()),
    availableDiskGb,
    gpus,
    acceleration: [...new Set(gpus.flatMap((g) => g.acceleration))],
    tier: suitability.tier,
    suitability: {
      lightweight: suitability.lightweight,
      medium: suitability.medium,
      heavy: suitability.heavy,
      reason: suitability.reason,
    },
  };
}

function detectGpuProbesSync(): GpuInfo[] {
  const nvidia = parseNvidia(runSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]));
  const apple = detectAppleGpu();
  const win = nvidia.length || apple.length
    ? []
    : platform() === "win32"
      ? parseWindowsGpu(runShellSync("Get-CimInstance Win32_VideoController | Select-Object -First 4 Name,AdapterRAM | ConvertTo-Json -Compress"))
      : [];
  const linux = nvidia.length || apple.length || win.length
    ? []
    : platform() === "linux"
      ? parseLinuxGpu(runShellSync("command -v lspci >/dev/null 2>&1 && lspci | grep -Ei 'vga|3d|display' || true"))
      : [];
  return [...nvidia, ...apple, ...win, ...linux];
}

async function detectGpuProbesAsync(): Promise<GpuInfo[]> {
  const nvidia = parseNvidia(await runAsync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]));
  const apple = detectAppleGpu();
  const win = nvidia.length || apple.length
    ? []
    : platform() === "win32"
      ? parseWindowsGpu(await runShellAsync("Get-CimInstance Win32_VideoController | Select-Object -First 4 Name,AdapterRAM | ConvertTo-Json -Compress"))
      : [];
  const linux = nvidia.length || apple.length || win.length
    ? []
    : platform() === "linux"
      ? parseLinuxGpu(await runShellAsync("command -v lspci >/dev/null 2>&1 && lspci | grep -Ei 'vga|3d|display' || true"))
      : [];
  return [...nvidia, ...apple, ...win, ...linux];
}

async function detectAccelerationAsync(gpus: GpuInfo[]): Promise<string[]> {
  const acc = new Set<string>();
  for (const g of gpus) for (const a of g.acceleration) acc.add(a);
  if (platform() === "darwin" && arch() === "arm64") acc.add("metal");
  if (await runAsync("nvidia-smi", ["--help"], 1000)) acc.add("cuda");
  if (platform() === "linux" && (await runShellAsync("test -e /dev/kfd && echo rocm"))) acc.add("rocm");
  return [...acc];
}

/** Full async hardware detection — never blocks the event loop. */
export async function detectHardwareSpecsAsync(): Promise<HardwareSpecs> {
  const started = Date.now();
  try {
    const cpuList = cpus();
    const gpus = await detectGpuProbesAsync();
    const totalRamGb = gb(totalmem());
    const availableDiskGb = detectDiskGb();
    const acceleration = await detectAccelerationAsync(gpus);
    const specs = assemble(cpuList, gpus, totalRamGb, availableDiskGb);
    specs.acceleration = acceleration;
    return specs;
  } finally {
    xrMetrics.hardwareDetectionDuration.observe({}, Date.now() - started);
  }
}

/**
 * Async cached accessor for the daemon request path. Fresh cache → immediate;
 * stale → served while a single background refresh runs; cold → bounded
 * async detection (deduped across concurrent callers).
 */
export async function getHardwareSpecs(): Promise<HardwareSpecs> {
  if (!hardwareCacheEnabled()) return detectHardwareSpecsAsync();
  const result = await hardwareCache.getOrStart("default", detectHardwareSpecsAsync);
  return result.value;
}

/**
 * Legacy SYNC detection — preserved for CLI paths (user-invoked commands).
 * Serves from the shared cache when fresh; otherwise runs the (blocking)
 * sync probes exactly as before and stores the result for async callers.
 */
export function detectHardwareSpecs(): HardwareSpecs {
  if (hardwareCacheEnabled()) {
    const hit = hardwareCache.get("default");
    if (hit && !hit.stale) return hit.value;
  }
  const cpuList = cpus();
  const gpus = detectGpuProbesSync();
  const totalRamGb = gb(totalmem());
  const availableDiskGb = detectDiskGb();
  const specs = assemble(cpuList, gpus, totalRamGb, availableDiskGb);
  const acc = new Set<string>(specs.acceleration);
  if (platform() === "darwin" && arch() === "arm64") acc.add("metal");
  if (runSync("nvidia-smi", ["--help"], 1000)) acc.add("cuda");
  if (platform() === "linux" && runShellSync("test -e /dev/kfd && echo rocm")) acc.add("rocm");
  specs.acceleration = [...acc];
  if (hardwareCacheEnabled()) hardwareCache.set("default", specs);
  return specs;
}

export function formatHardwareSummary(specs: HardwareSpecs): string {
  const gpu = specs.gpus.length
    ? specs.gpus.map((g) => `${g.name}${g.vramGb ? ` (${g.vramGb}GB VRAM)` : ""}`).join(", ")
    : "none detected";
  const acc = specs.acceleration.length ? specs.acceleration.join(", ") : "none detected";
  return `${specs.os}/${specs.arch}, ${specs.cpuCores} CPU cores, ${specs.totalRamGb}GB RAM (${specs.freeRamGb}GB free), ${specs.availableDiskGb}GB free disk, GPU: ${gpu}, acceleration: ${acc}, tier: ${specs.tier}`;
}
