/** XR Stage 4 — deterministic hardware/spec detection for local AI. */
import { arch, cpus, freemem, platform, release, totalmem } from "node:os";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { statfsSync } from "node:fs";

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

function gb(bytes: number): number {
  return Math.max(0, Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10);
}

function run(cmd: string, args: string[], timeout = 2500): string {
  const res = spawnSync(cmd, args, { encoding: "utf8", timeout, windowsHide: true });
  if (res.status !== 0) return "";
  return `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
}

function runShell(script: string): string {
  if (platform() === "win32") return run("powershell.exe", ["-NoProfile", "-Command", script], 4000);
  return run("sh", ["-lc", script], 4000);
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

function detectAppleGpu(): GpuInfo[] {
  if (platform() !== "darwin") return [];
  const cpu = cpus()[0]?.model ?? "";
  const isAppleSilicon = arch() === "arm64" || /Apple M\d/i.test(cpu);
  if (!isAppleSilicon) return [];
  return [{ vendor: "apple", name: cpu || "Apple Silicon GPU", vramGb: Math.max(4, Math.floor(gb(totalmem()) * 0.65)), acceleration: ["metal"] }];
}

function detectWindowsGpu(): GpuInfo[] {
  if (platform() !== "win32") return [];
  const out = runShell("Get-CimInstance Win32_VideoController | Select-Object -First 4 Name,AdapterRAM | ConvertTo-Json -Compress");
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

function detectLinuxIntegratedGpu(): GpuInfo[] {
  if (platform() !== "linux") return [];
  const out = runShell("command -v lspci >/dev/null 2>&1 && lspci | grep -Ei 'vga|3d|display' || true");
  if (!out) return [];
  return out.split("\n").slice(0, 4).map((line) => {
    const lower = line.toLowerCase();
    const vendor = lower.includes("nvidia") ? "nvidia" : lower.includes("amd") || lower.includes("radeon") ? "amd" : lower.includes("intel") ? "intel" : "unknown";
    const acceleration = vendor === "nvidia" ? ["cuda"] : vendor === "amd" ? ["rocm", "vulkan"] : vendor === "intel" ? ["vulkan"] : [];
    return { vendor, name: line.replace(/^.*?:\s*/, "").slice(0, 100), acceleration } as GpuInfo;
  });
}

function detectAcceleration(gpus: GpuInfo[]): string[] {
  const acc = new Set<string>();
  for (const g of gpus) for (const a of g.acceleration) acc.add(a);
  if (platform() === "darwin" && arch() === "arm64") acc.add("metal");
  if (run("nvidia-smi", ["--help"], 1000)) acc.add("cuda");
  if (platform() === "linux" && runShell("test -e /dev/kfd && echo rocm")) acc.add("rocm");
  return [...acc];
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

export function detectHardwareSpecs(): HardwareSpecs {
  const cpuList = cpus();
  const nvidia = detectNvidia();
  const apple = detectAppleGpu();
  const win = nvidia.length || apple.length ? [] : detectWindowsGpu();
  const linux = nvidia.length || apple.length || win.length ? [] : detectLinuxIntegratedGpu();
  const gpus = [...nvidia, ...apple, ...win, ...linux];
  const totalRamGb = gb(totalmem());
  const availableDiskGb = detectDiskGb();
  const suitability = classify(totalRamGb, availableDiskGb, gpus);
  const acceleration = detectAcceleration(gpus);

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
    acceleration,
    tier: suitability.tier,
    suitability: {
      lightweight: suitability.lightweight,
      medium: suitability.medium,
      heavy: suitability.heavy,
      reason: suitability.reason,
    },
  };
}

export function formatHardwareSummary(specs: HardwareSpecs): string {
  const gpu = specs.gpus.length
    ? specs.gpus.map((g) => `${g.name}${g.vramGb ? ` (${g.vramGb}GB VRAM)` : ""}`).join(", ")
    : "none detected";
  const acc = specs.acceleration.length ? specs.acceleration.join(", ") : "none detected";
  return `${specs.os}/${specs.arch}, ${specs.cpuCores} CPU cores, ${specs.totalRamGb}GB RAM (${specs.freeRamGb}GB free), ${specs.availableDiskGb}GB free disk, GPU: ${gpu}, acceleration: ${acc}, tier: ${specs.tier}`;
}
