// Locate the platform-specific Bun package without lifecycle scripts or downloads.
// Package managers may place an optional dependency beside XR or hoist it to
// an ancestor's node_modules. Do not search NODE_PATH or global module paths.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

// Keep the pre-existing standalone binary names and unsupported-target fallback.
export function compiledBinaryName(platform, arch) {
  const map = {
    "linux-x64": "xr-linux-x64", "linux-arm64": "xr-linux-arm64",
    "darwin-arm64": "xr-darwin-arm64", "darwin-x64": "xr-darwin-x64",
    "win32-x64": "xr-windows-x64.exe", "win32-arm64": "xr-windows-arm64.exe",
  };
  return map[`${platform}-${arch}`] ?? `xr-${platform}-${arch}`;
}

export function runtimePackage(platform, arch, libc) {
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x64" : null;
  if (!cpu) return null;
  if (platform === "darwin") return `@oven/bun-darwin-${cpu}`;
  if (platform === "win32") return `@oven/bun-windows-${cpu}`;
  if (platform === "linux" && (libc === "glibc" || libc === "musl")) {
    return `@oven/bun-linux-${cpu}${libc === "musl" ? "-musl" : ""}`;
  }
  return null;
}

export function linuxLibc(report, arch, exists = existsSync) {
  if (report?.header?.glibcVersionRuntime) return "glibc";
  if ((report?.sharedObjects ?? []).some((p) => /musl/i.test(p))) return "musl";
  const cpu = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : null;
  if (cpu && exists(`/lib/ld-musl-${cpu}.so.1`)) return "musl";
  return null;
}

function hostLibc() {
  if (process.platform !== "linux") return null;
  let report;
  try {
    if (process.report) {
      const original = process.report.excludeNetwork;
      try {
        process.report.excludeNetwork = true;
        report = process.report.getReport();
      } finally {
        process.report.excludeNetwork = original;
      }
    }
  } catch {
    // Fall through to the standard musl loader check; do not guess glibc.
  }
  return linuxLibc(report, process.arch);
}

function packageDirectory(root, name) {
  const parts = name.split("/");
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", ...parts);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
  }
}

// status is found, missing, unsupported, or invalid. A corrupt or mismatched
// installed package is an error, not permission to silently use ambient Bun.
export function locateBundledRuntime(root) {
  const libc = hostLibc();
  const name = runtimePackage(process.platform, process.arch, libc);
  if (!name) {
    const detail = process.platform === "linux" && !libc
      ? "Linux libc could not be identified as glibc or musl"
      : `unsupported runtime platform ${process.platform}-${process.arch}`;
    return { status: "unsupported", detail };
  }

  let expected;
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expected = manifest.optionalDependencies?.[name];
    if (typeof expected !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(expected)) {
      throw new Error(`expected an exact version pin for ${name}`);
    }
  } catch (error) {
    return { status: "invalid", detail: `XR package manifest: ${error.message}` };
  }

  const dir = packageDirectory(root, name);
  if (!dir) return { status: "missing", name, expected };
  try {
    const installed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (installed.name !== name || installed.version !== expected) {
      throw new Error(`${name} has version ${String(installed.version)}; XR requires ${expected}`);
    }
    const exe = join(dir, "bin", process.platform === "win32" ? "bun.exe" : "bun");
    if (!statSync(exe).isFile()) throw new Error(`runtime executable is not a file: ${exe}`);
    return { status: "found", exe, name, expected };
  } catch (error) {
    return { status: "invalid", detail: `${name}: ${error.message}` };
  }
}
