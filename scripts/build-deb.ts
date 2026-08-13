#!/usr/bin/env bun
/**
 * XR Phase 9 · T3 — pure-.deb builder (Debian binary package, no dpkg tools).
 *
 * Produces a structurally valid Debian package from the canonical compiled
 * binary (one canonical build → channel derivation, Art. XXII):
 *
 *   <name>_<version>_amd64.deb  =  ar archive {
 *     debian-binary      "2.0\n"
 *     control.tar.gz     control, md5sums
 *     data.tar.gz        ./usr/bin/xr  (payload = the signed release binary)
 *   }
 *
 * Validated two ways (honesty discipline): parsed structurally by
 * test/release/channels.test.ts in pure TS, and installed by `dpkg-deb`/`dpkg`
 * in the cross-OS channel-install CI job.
 *
 *   bun run scripts/build-deb.ts --bin dist/xr-linux-x64 --out dist/xr_1.0.0_amd64.deb
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifest } from "./release-manifest.ts";

export interface DebInfo {
  package: string;
  version: string;
  architecture: "amd64" | "arm64";
  maintainer: string;
  description: string;
  homepage: string;
  section: string;
  priority: string;
  installedSizeKiB: number;
}

// ── tar (ustar) writer — enough for control/data archives ─────────────────

function tarHeader(name: string, size: number, mode: number, type: "0" | "5"): Buffer {
  if (name.length > 99) throw new Error(`tar entry name too long: ${name}`);
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, name.length, "utf8");
  h.write(mode.toString(8).padStart(7, "0") + "\0", 100, 8, "ascii");
  h.write("0000000\0", 108, 8, "ascii"); // uid root
  h.write("0000000\0", 116, 8, "ascii"); // gid root
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  h.write("00000000000\0", 136, 12, "ascii"); // fixed mtime 0 — reproducible
  h.write(type, 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  // checksum: sum with checksum field as spaces
  h.write("        ", 148, 8, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}

export function buildTar(entries: Array<{ name: string; data: Buffer | string; mode?: number }>): Buffer {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const mode = e.mode ?? 0o644;
    const dirs = e.name.split("/");
    // emit directory entries for nested paths
    let dirPath = "";
    for (const d of dirs.slice(0, -1)) {
      dirPath = dirPath ? `${dirPath}/${d}` : d;
      const dirName = `./${dirPath}`;
      parts.push(tarHeader(dirName, 0, 0o755, "5"));
    }
    parts.push(tarHeader(`./${e.name}`.replace(/^\.\/\./, "."), data.length, mode, "0"));
    parts.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0)); // end blocks
  return Buffer.concat(parts);
}

// ── ar writer (System V/GNU short names; entry data 2-byte aligned) ─────

function arMember(name: string, data: Buffer): Buffer {
  if (!name.endsWith("/") && name.length > 15) throw new Error(`ar member name too long: ${name}`);
  let h = name.padEnd(16, " ");
  h += "0".padEnd(12, " "); // mtime 0 — reproducible
  h += "0".padEnd(6, " ");
  h += "0".padEnd(6, " ");
  h += (0o100644).toString(8).padEnd(8, " ");
  h += data.length.toString().padEnd(10, " ");
  h += "`\n";
  const parts = [Buffer.from(h, "ascii"), data];
  if (data.length % 2 === 1) parts.push(Buffer.from("\n", "ascii"));
  return Buffer.concat(parts);
}

export function buildAr(members: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Uint8Array[] = [Buffer.from("!<arch>\n", "ascii")];
  for (const m of members) parts.push(arMember(m.name, m.data));
  return Buffer.concat(parts);
}

// ── deb assembly ──────────────────────────────────────────────────────────

export function buildDeb(options: { info: DebInfo; binaryPath: string; binaryName?: string }): Buffer {
  const { info } = options;
  const bin = readFileSync(options.binaryPath);
  const binaryName = options.binaryName ?? "xr";

  const control = [
    `Package: ${info.package}`,
    `Version: ${info.version}`,
    `Section: ${info.section}`,
    `Priority: ${info.priority}`,
    `Architecture: ${info.architecture}`,
    `Installed-Size: ${info.installedSizeKiB}`,
    `Maintainer: ${info.maintainer}`,
    `Description: ${info.description.split("\n")[0]}`,
    ` XR — local-first, provider-neutral AI agent runtime (compiled binary distribution).`,
    `Homepage: ${info.homepage}`,
    "",
  ].join("\n");

  const md5sums = `${createHash("md5").update(bin).digest("hex")}  usr/bin/${binaryName}\n`;

  const controlTar = gzipSync(
    buildTar([
      { name: "control", data: control },
      { name: "md5sums", data: md5sums },
    ]),
    { level: 9 },
  );

  const dataTar = gzipSync(
    buildTar([{ name: `usr/bin/${binaryName}`, data: bin, mode: 0o755 }]),
    { level: 9 },
  );

  return buildAr([
    { name: "debian-binary", data: Buffer.from("2.0\n", "utf8") },
    { name: "control.tar.gz", data: controlTar },
    { name: "data.tar.gz", data: dataTar },
  ]);
}

// ── CLI ───────────────────────────────────────────────────────────────────

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const manifest = loadManifest();
  const bin = arg("--bin");
  const out = arg("--out");
  if (!bin || !out) {
    console.error("usage: bun run scripts/build-deb.ts --bin <binary> --out <file.deb>");
    process.exit(2);
  }
  const size = await Bun.file(bin).size;
  const debName = `${manifest.identity.name.split("/").pop()!}_${manifest.identity.version}_amd64.deb`;
  const deb = buildDeb({
    info: {
      package: "xr",
      version: manifest.identity.version,
      architecture: "amd64",
      maintainer: `${manifest.identity.author} <https://github.com/ahmadrrrtx>`,
      description: manifest.identity.description,
      homepage: manifest.identity.repo,
      section: "utils",
      priority: "optional",
      installedSizeKiB: Math.ceil(size / 1024),
    },
    binaryPath: bin,
  });
  await Bun.write(join(out.endsWith(".deb") ? out : join(out, debName), "."), deb).catch(() => undefined);
  const dest = out.endsWith(".deb") ? out : join(out, debName);
  await Bun.write(dest, deb);
  console.log(JSON.stringify({ ok: true, deb: dest, bytes: deb.length }));
}
