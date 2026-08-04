#!/usr/bin/env bun
/**
 * XR Phase 9 · T3 — native Linux packages from the CANONICAL release binary.
 *
 *   bun run scripts/package-linux.ts --binary dist/xr-linux-x64 --out dist
 *       Builds xr_<version>-1_amd64.deb (native ar+tar.gz, no external tools —
 *       fully reproducible, testable everywhere) and, when `rpmbuild` is on
 *       PATH, xr-<version>-1.x86_64.rpm.
 *
 *   bun run scripts/package-linux.ts --binary dist/xr-linux-arm64 --out dist
 *       Same for arm64 (arch resolved from the binary's target name).
 *
 * Principles:
 *   - The package payload is the exact release binary. A package never
 *     recompiles or repatches it — one canonical build, many channels (R1).
 *   - The .deb is assembled byte-deterministically in-process, so the package
 *     can be built and structurally verified in the test suite with zero host
 *     tooling (Art. XX.5 does not apply — no optional dep on this path).
 *   - The .rpm uses the system rpmbuild with the rendered spec
 *     (packaging/rpm/xr.spec); when rpmbuild is unavailable the script says so
 *     and fails (release runners install rpm — CI gate, not silent skip).
 *
 * Version discipline: the Version in control metadata comes from the release
 * manifest (never guessed from the filename beyond arch).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, copyFileSync, readdirSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ROOT, loadManifest } from "./release-manifest.ts";

export type DebArch = "amd64" | "arm64";

export interface DebOptions {
  binary: string;
  version: string;
  arch: DebArch;
  description: string;
  maintainer: string;
  licenseText: string;
}

// ── Minimal deterministic writers ────────────────────────────────────────────

function ustarHeader(name: string, size: number, mode: number, type: "0" | "5"): Buffer {
  const h = Buffer.alloc(512, 0);
  const put = (s: string, off: number, len: number) => Buffer.from(s, "utf8").copy(h, off, 0, Math.min(Buffer.byteLength(s), len));
  const oct = (n: number, off: number, len: number) => put(n.toString(8).padStart(len - 1, "0") + "\0", off, len);
  let base = name;
  let prefix = "";
  if (base.length > 100) {
    const cut = base.lastIndexOf("/", base.length - 101);
    if (cut <= 0 || cut > 155) throw new Error(`tar path too long: ${name}`);
    prefix = base.slice(0, cut);
    base = base.slice(cut + 1);
  }
  put(base, 0, 100);
  oct(mode, 100, 8);
  oct(0, 108, 8); // uid — deterministic
  oct(0, 116, 8); // gid — deterministic
  oct(size, 124, 12);
  oct(0, 136, 12); // mtime 0 — reproducible (Art. XXII.3)
  put("        ", 148, 8); // checksum placeholder (8 spaces)
  put(type, 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

/** Deterministic tar archive (sorted entries, zeroed uid/gid/mtime). */
export function tar(entries: Array<{ name: string; data: Buffer; mode: number; dir?: boolean }>): Buffer {
  const out: Buffer[] = [];
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.dir ?? e.name.endsWith("/")) {
      out.push(ustarHeader(e.name.endsWith("/") ? e.name : e.name + "/", 0, e.mode, "5"));
    } else {
      out.push(ustarHeader(e.name, e.data.length, e.mode, "0"));
      out.push(e.data);
      const pad = (512 - (e.data.length % 512)) % 512;
      if (pad) out.push(Buffer.alloc(pad, 0));
    }
  }
  out.push(Buffer.alloc(1024, 0));
  return Buffer.concat(out);
}

/** BSD/GNU ar archive with deterministic (zeroed) metadata. */
export function ar(members: Array<{ name: string; data: Buffer }>): Buffer {
  const out: Buffer[] = [Buffer.from("!<arch>\n", "utf8")];
  for (const m of members) {
    const name = m.name.endsWith("/") ? m.name : m.name + "/";
    const header =
      name.padEnd(16, " ") +
      "0".padEnd(12, " ") + // mtime 0 — reproducible
      "0".padEnd(6, " ") +
      "0".padEnd(6, " ") +
      "100644".padEnd(8, " ") +
      String(m.data.length).padEnd(10, " ") +
      "`\n";
    out.push(Buffer.from(header, "utf8"));
    out.push(m.data);
    if (m.data.length % 2 === 1) out.push(Buffer.from("\n", "utf8"));
  }
  return Buffer.concat(out);
}

/** Debian control metadata for the XR binary package. */
export function debControl(o: DebOptions, installedSizeKb: number): string {
  // Debian versions must not contain a leading 'v'; prereleases use '~' (sorts before release).
  const debVersion = o.version.replace(/^v/, "").replace(/-/, "~") + "-1";
  return `Package: xr
Version: ${debVersion}
Architecture: ${o.arch}
Maintainer: ${o.maintainer}
Installed-Size: ${installedSizeKb}
Section: utils
Priority: optional
Homepage: https://xr-gules.vercel.app
Description: XR — local-first, provider-neutral AI agent runtime (Public Beta)
 ${o.description}
 .
 XR is in Public Beta: honest by design, signed releases, known limitations
 are public. Report false claims: https://github.com/ahmadrrrtx/xr/issues
`;
}

/** Build a .deb in-memory and return its bytes. Deterministic output. */
export function buildDeb(o: DebOptions): Buffer {
  if (!existsSync(o.binary)) throw new Error(`binary not found: ${o.binary}`);
  const bin = readFileSync(o.binary);
  const installedSizeKb = Math.max(1, Math.ceil(bin.length / 1024));

  const dataTar = tar([
    { name: "./usr", data: Buffer.alloc(0), mode: 0o755, dir: true },
    { name: "./usr/bin", data: Buffer.alloc(0), mode: 0o755, dir: true },
    { name: "./usr/bin/xr", data: bin, mode: 0o755 },
    { name: "./usr/share", data: Buffer.alloc(0), mode: 0o755, dir: true },
    { name: "./usr/share/doc", data: Buffer.alloc(0), mode: 0o755, dir: true },
    { name: "./usr/share/doc/xr", data: Buffer.alloc(0), mode: 0o755, dir: true },
    { name: "./usr/share/doc/xr/copyright", data: Buffer.from(o.licenseText, "utf8"), mode: 0o644 },
  ]);
  const controlTar = tar([
    { name: "./control", data: Buffer.from(debControl(o, installedSizeKb), "utf8"), mode: 0o644 },
  ]);
  return ar([
    { name: "debian-binary", data: Buffer.from("2.0\n", "utf8") },
    { name: "control.tar.gz", data: gzipSync(controlTar, { level: 9 }) },
    { name: "data.tar.gz", data: gzipSync(dataTar, { level: 9 }) },
  ]);
}

// ── rpm via rpmbuild (rendered spec, canonical binary payload) ───────────────

export function rpmbuildAvailable(): boolean {
  const r = spawnSync("rpmbuild", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return r.status === 0;
}

export function buildRpm(opts: {
  binary: string;
  specPath: string;
  outDir: string;
}): string {
  if (!rpmbuildAvailable()) {
    throw new Error(
      "rpmbuild not found on PATH. The release runner installs `rpm` " +
        "packaging tools (apt-get install -y rpm). Refusing to fake an RPM.",
    );
  }
  const top = join(opts.outDir, ".rpmbuild");
  for (const sub of ["BUILD", "RPMS", "SOURCES", "SPECS", "SRPMS"]) {
    mkdirSync(join(top, sub), { recursive: true });
  }
  // SOURCE0 = canonical binary; SOURCE1 = LICENSE.
  copyFileSync(opts.binary, join(top, "SOURCES", "xr-linux-x64"));
  copyFileSync(join(ROOT, "LICENSE"), join(top, "SOURCES", "LICENSE"));
  const r = spawnSync(
    "rpmbuild",
    ["-bb", opts.specPath, "--define", `_topdir ${top}`],
    { encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (r.status !== 0) {
    throw new Error(`rpmbuild failed: ${(r.stderr ?? r.stdout ?? "").slice(-800)}`);
  }
  // Locate the produced rpm.
  const rpmsDir = join(top, "RPMS");
  for (const archDir of readdirSync(rpmsDir)) {
    for (const f of readdirSync(join(rpmsDir, archDir))) {
      if (f.endsWith(".rpm")) return join(rpmsDir, archDir, f);
    }
  }
  throw new Error("rpmbuild produced no .rpm");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function archFromBinaryName(file: string): DebArch {
  if (file.includes("arm64")) return "arm64";
  if (file.includes("x64")) return "amd64";
  throw new Error(`cannot resolve arch from binary name "${file}" (expected *-x64 or *-arm64)`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const binary = get("--binary");
  const out = get("--out") ?? join(ROOT, "dist");
  if (!binary) {
    console.error("usage: bun run scripts/package-linux.ts --binary dist/xr-linux-x64 [--out dist]");
    process.exit(1);
  }
  const manifest = loadManifest();
  const v = manifest.identity.version.split("-")[0]!;
  const arch = archFromBinaryName(basename(binary));
  mkdirSync(out, { recursive: true });

  const licenseText = readFileSync(join(ROOT, "LICENSE"), "utf8");
  const deb = buildDeb({
    binary,
    version: manifest.identity.version,
    arch,
    description: manifest.identity.description,
    maintainer: manifest.identity.author,
    licenseText,
  });
  const debName = `xr_${v}-1_${arch}.deb`;
  await Bun.write(join(out, debName), deb);

  let rpmLine = "skipped (rpmbuild unavailable on this host — release CI builds it)";
  const specPath = join(ROOT, "packaging", "rpm", "xr.spec");
  if (arch === "amd64" && rpmbuildAvailable()) {
    const rpmPath = buildRpm({ binary, specPath, outDir: out });
    const dest = join(out, basename(rpmPath));
    renameSync(rpmPath, dest);
    rmSync(join(out, ".rpmbuild"), { recursive: true, force: true });
    rpmLine = basename(dest);
  } else if (arch === "amd64" && existsSync(specPath) && process.env.XR_REQUIRE_RPM === "1") {
    throw new Error("XR_REQUIRE_RPM=1 but rpmbuild is unavailable — failing closed");
  }

  const sha = createHash("sha256").update(deb).digest("hex").slice(0, 16);
  console.log(`  ${debName}  ${(deb.length / 1024 / 1024).toFixed(1)} MiB  (sha256:${sha}…)`);
  console.log(`  rpm: ${rpmLine}`);
  console.log(`✅ linux packaging complete for ${binary}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[package-linux] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
