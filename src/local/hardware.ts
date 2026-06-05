/** XR v0.5 — deterministic hardware/spec detection for local model routing. */
import { arch, cpus, freemem, platform, totalmem } from "node:os";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { statfsSync } from "node:fs";

export interface GpuInfo {
  vendor: "nvidia" | "apple" | "amd" | "intel" | "unknown";
  name: string;
  vramGb?: number;
}

export interface HardwareSpecs {
  os: NodeJS.Platform;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalRamGb: number;
  freeRamGb: number;
  availableDiskGb: number;
  gpus: GpuInfo[];
}

function gb(bytes: number): number {
  return Math.max(0, Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10);
}

function run(cmd: string, args: string[]): string {
  const res = spawnSync(cmd, args, { encoding: "utf8", timeout: 2500, windowsHide: true });
  if (res.status !== 0) return "";
  return `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
}

function detectDiskGb(): number {
  try {
    const s = statfsSync(homedir());
    return gb(Number(s.bavail) * Number(s.bsize));
  } catch {
    return 0;
  }
}

function detectNvidia(): GpuInfo[] {
  const out = run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [name, mem] = line.split(",").map((s) => s.trim());
    return { vendor: "nvidia" as const, name: name || "NVIDIA GPU", vramGb: mem ? Math.round((Number(mem) / 1024) * 10) / 10 : undefined };
  });
}

function detectAppleGpu(): GpuInfo[] {
  if (platform() !== "darwin") return [];
  const cpu = cpus()[0]?.model ?? "";
  const isAppleSilicon = arch() === "arm64" || /Apple M\d/i.test(cpu);
  if (!isAppleSilicon) return [];
  // Apple Silicon uses unified memory. We expose it as GPU-usable memory but keep
  // recommendation conservative in the recommender.
  return [{ vendor: "apple", name: cpu || "Apple Silicon GPU", vramGb: gb(totalmem()) }];
}

function detectLinuxIntegratedGpu(): GpuInfo[] {
  if (platform() !== "linux") return [];
  const out = run("sh", ["-lc", "command -v lspci >/dev/null 2>&1 && lspci | grep -Ei 'vga|3d|display' || true"]);
  if (!out) return [];
  return out.split("\n").slice(0, 4).map((line) => {
    const lower = line.toLowerCase();
    const vendor = lower.includes("amd") ? "amd" : lower.includes("intel") ? "intel" : "unknown";
    return { vendor, name: line.replace(/^.*?:\s*/, "").slice(0, 100) } as GpuInfo;
  });
}

export function detectHardwareSpecs(): HardwareSpecs {
  const cpuList = cpus();
  const nvidia = detectNvidia();
  const apple = detectAppleGpu();
  const integrated = nvidia.length || apple.length ? [] : detectLinuxIntegratedGpu();

  return {
    os: platform(),
    arch: arch(),
    cpuModel: cpuList[0]?.model ?? "unknown CPU",
    cpuCores: cpuList.length || 1,
    totalRamGb: gb(totalmem()),
    freeRamGb: gb(freemem()),
    availableDiskGb: detectDiskGb(),
    gpus: [...nvidia, ...apple, ...integrated],
  };
}

export function formatHardwareSummary(specs: HardwareSpecs): string {
  const gpu = specs.gpus.length
    ? specs.gpus.map((g) => `${g.name}${g.vramGb ? ` (${g.vramGb}GB VRAM)` : ""}`).join(", ")
    : "none detected";
  return `${specs.os}/${specs.arch}, ${specs.cpuCores} CPU cores, ${specs.totalRamGb}GB RAM, ${specs.availableDiskGb}GB free disk, GPU: ${gpu}`;
}
