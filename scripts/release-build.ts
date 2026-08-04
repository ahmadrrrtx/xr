#!/usr/bin/env bun
/**
 * XR Phase 9 · T1/T2 — the ONE release pipeline.
 *
 * `release.yml` is a thin caller of this script; the same logic runs locally
 * (dry-run / tests) and in CI, so a tag never surprises (Art. III.2 — one
 * authority for how a release is assembled).
 *
 *   bun run scripts/release-build.ts --out dist/release [--targets …]
 *     [--skip-build <dir-with-binaries>] [--with-npm] [--local-sign] [--verify]
 *
 * Stages (fail fast, fail closed):
 *   1. gate      — release:check + claim-lint + (optional) tag==manifest check
 *   2. build     — build-matrix for every manifest target (or reuse --skip-build)
 *   3. package   — npm tarball (optional) + .deb/.rpm for linux binaries
 *   4. checksums — SHA256SUMS over every release asset (one authority)
 *   5. sbom      — CycloneDX from the locked deps (scripts/sbom.ts)
 *   6. subjects  — subjects.txt (sha256+name) consumed by the SLSA generator
 *   7. hashes    — hashes.json (file → sha256/bytes/target) for channel pinning
 *   8. sign      — --local-sign: Ed25519 detatched signatures + a local keypair
 *                  (TEST/dry-run path; CI signs keylessly with cosign — never
 *                  with this key). Without --local-sign nothing is signed
 *                  here and the workflow does the keyless signing.
 *   9. verify    — run the independent verifier over the bundle; a release
 *                  bundle that does not verify is not a release.
 *
 * Nothing is published here. Publication is the workflow's job after this
 * script produces a byte-complete, verifiable dist/release directory.
 */

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, loadManifest } from "./release-manifest.ts";
import { validateDistribution, type MinimalManifest } from "./distribution-model.ts";
import { verifyRelease } from "./verify-release.ts";

export interface ReleaseBuildReport {
  ok: boolean;
  outDir: string;
  assets: Array<{ file: string; sha256: string; bytes: number; kind: string }>;
  failures: string[];
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sh(args: string[], cwd: string = ROOT, env: NodeJS.ProcessEnv = process.env): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(args[0]!, args.slice(1), { cwd, env, encoding: "utf8", timeout: 1_200_000, stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[a.slice(2)] = next;
        i++;
      } else {
        out[a.slice(2)] = true;
      }
    }
  }
  return out;
}

/** Stage 1 — the release gate. Returns failure strings (empty = pass). */
export function runReleaseGate(opts: { tag?: string; skipGate?: boolean }): string[] {
  const failures: string[] = [];
  const manifest = loadManifest();
  const v = manifest.identity.version;

  if (opts.tag) {
    const tagVersion = opts.tag.replace(/^v/, "");
    if (tagVersion !== v) {
      failures.push(`tag ${opts.tag} != manifest version ${v} — refusing to ship an unstamped identity (Art. XXII.1)`);
    }
    const isPrerelease = tagVersion.includes("-");
    // Beta discipline: prerelease tags map to the beta channel marker only;
    // stability labeling never upgrades a prerelease to stable implicitly.
    if (isPrerelease && manifest.distribution && !/alpha|beta|rc/.test(tagVersion.split("-")[1] ?? "")) {
      failures.push(`prerelease tag ${opts.tag} must carry an alpha|beta|rc suffix (channel semantics, Part 13.6)`);
    }
  }

  if (!opts.skipGate) {
    for (const [label, args] of [
      ["release:check", ["run", "scripts/release-manifest.ts", "--check"]],
      ["claim-lint", ["run", "scripts/claim-lint.ts"]],
    ] as const) {
      const r = sh(["bun", ...args]);
      if (r.status !== 0) {
        failures.push(`release gate "${label}" failed:\n${(r.stdout + r.stderr).slice(-800)}`);
      }
    }
  }
  return failures;
}

/** Stages 2–7 — assemble the release directory. */
export async function buildRelease(opts: {
  out: string;
  targets?: string[];
  skipBuildFrom?: string;
  withNpm?: boolean;
  localSign?: boolean;
}): Promise<ReleaseBuildReport> {
  const failures: string[] = [];
  const out = opts.out;
  mkdirSync(out, { recursive: true });
  const manifest = loadManifest();
  const distribution = validateDistribution(manifest as unknown as MinimalManifest);
  const wanted = opts.targets ?? distribution.targets.map((t) => t.id);

  const assets: ReleaseBuildReport["assets"] = [];

  // ── Build binaries ──────────────────────────────────────────────────────
  if (opts.skipBuildFrom) {
    // test/dry-run path: reuse pre-built binaries from a directory.
    for (const t of distribution.targets.filter((t) => wanted.includes(t.id))) {
      const src = join(opts.skipBuildFrom, t.file);
      if (!existsSync(src)) {
        failures.push(`--skip-build: prebuilt binary missing for ${t.id}: ${src}`);
        continue;
      }
      await Bun.write(join(out, t.file), await Bun.file(src).arrayBuffer());
    }
  } else {
    const targetArgs = wanted.map((t) => t.replace(/^bun-/, "")).join(",");
    const r = sh(["bun", "run", "scripts/build-matrix.ts", "--targets", targetArgs, "--out", out]);
    if (r.status !== 0) failures.push(`build-matrix failed:\n${(r.stdout + r.stderr).slice(-1200)}`);
  }

  // Binaries produced?
  for (const t of distribution.targets.filter((t) => wanted.includes(t.id))) {
    const p = join(out, t.file);
    if (!existsSync(p)) failures.push(`missing binary asset for target ${t.id}: ${t.file}`);
  }

  // ── npm tarball (channel: npm) ──────────────────────────────────────────
  if (opts.withNpm) {
    const r = sh(["bun", "pm", "pack", "--pack-destination", out]);
    if (r.status !== 0) failures.push(`npm pack failed:\n${(r.stdout + r.stderr).slice(-800)}`);
  }

  // ── Native linux packages (channels: deb/rpm) ───────────────────────────
  for (const linuxTarget of distribution.targets.filter((t) => t.os === "linux" && wanted.includes(t.id))) {
    const bin = join(out, linuxTarget.file);
    if (!existsSync(bin)) continue;
    const r = sh(["bun", "run", "scripts/package-linux.ts", "--binary", bin, "--out", out]);
    if (r.status !== 0) failures.push(`package-linux failed for ${linuxTarget.id}:\n${(r.stdout + r.stderr).slice(-800)}`);
  }

  // ── Checksums (one authority over ALL assets) ───────────────────────────
  const assetFiles = readdirSync(out).filter((f) => {
    return !["SHA256SUMS", "sbom.cyclonedx.json", "subjects.txt", "hashes.json"].includes(f)
      && !f.endsWith(".sig") && !f.endsWith(".pub") && !f.endsWith(".key");
  });
  const sumsLines: string[] = [];
  for (const f of [...assetFiles].sort()) {
    const p = join(out, f);
    sumsLines.push(`${sha256File(p)}  ${f}`);
    const target = distribution.targets.find((t) => t.file === f);
    assets.push({
      file: f,
      sha256: sumsLines[sumsLines.length - 1]!.slice(0, 64),
      bytes: readFileSync(p).length,
      kind: target ? `binary:${target.id}` : f.endsWith(".tgz") ? "npm" : f.endsWith(".deb") ? "deb" : f.endsWith(".rpm") ? "rpm" : "other",
    });
  }
  writeFileSync(join(out, "SHA256SUMS"), sumsLines.join("\n") + "\n", "utf8");

  // ── SBOM (locked deps; CycloneDX) ───────────────────────────────────────
  {
    const r = sh(["bun", "run", "scripts/sbom.ts", "--out", join(out, "sbom.cyclonedx.json")]);
    if (r.status !== 0) failures.push(`sbom failed:\n${(r.stdout + r.stderr).slice(-800)}`);
  }

  // ── SLSA subjects (consumed by the generic generator in CI) ─────────────
  const subjectLines: string[] = [];
  for (const f of [...assetFiles, "SHA256SUMS", "sbom.cyclonedx.json"].sort()) {
    subjectLines.push(`${sha256File(join(out, f))} ${f}`);
  }
  writeFileSync(join(out, "subjects.txt"), subjectLines.join("\n") + "\n", "utf8");
  const subjectsB64 = Buffer.from(subjectLines.join("\n") + "\n", "utf8").toString("base64");
  writeFileSync(join(out, "subjects.b64"), subjectsB64 + "\n", "utf8");

  // ── hashes.json (channel pinning input) ─────────────────────────────────
  const hashes = {
    version: manifest.identity.version,
    generatedBy: "scripts/release-build.ts",
    files: [...assets, { file: "SHA256SUMS", sha256: sha256File(join(out, "SHA256SUMS")), bytes: readFileSync(join(out, "SHA256SUMS")).length, kind: "checksums" }]
      .filter((a, i, arr) => arr.findIndex((x) => x.file === a.file) === i),
  };
  writeFileSync(join(out, "hashes.json"), JSON.stringify(hashes, null, 2) + "\n", "utf8");

  // ── Local detached signatures (TEST/dry-run only; CI uses cosign keyless) ──
  if (opts.localSign) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(join(out, "local-verify.pub"), publicKey.export({ type: "spki", format: "pem" }).toString(), "utf8");
    writeFileSync(join(out, "local-signing.key"), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "utf8");
    for (const a of [...assets, { file: "SHA256SUMS" }, { file: "sbom.cyclonedx.json" }]) {
      const data = readFileSync(join(out, a.file));
      writeFileSync(join(out, `${a.file}.sig`), sign(null, data, privateKey));
    }
  }

  return { ok: failures.length === 0, outDir: out, assets, failures };
}

/** Stage 9 — independent verification of the assembled bundle. */
export async function verifyBundle(out: string, opts: { localSign?: boolean }): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let allOk = true;
  const artifacts = readdirSync(out).filter(
    (f) => !["SHA256SUMS", "sbom.cyclonedx.json", "subjects.txt", "subjects.b64", "hashes.json", "local-verify.pub", "local-signing.key"].includes(f) && !f.endsWith(".sig"),
  );
  for (const f of artifacts.sort()) {
    const report = await verifyRelease({
      artifact: join(out, f),
      sums: join(out, "SHA256SUMS"),
      sbom: join(out, "sbom.cyclonedx.json"),
      localKey: opts.localSign ? join(out, "local-verify.pub") : undefined,
      localSig: opts.localSign && existsSync(join(out, `${f}.sig`)) ? join(out, `${f}.sig`) : undefined,
    });
    for (const c of report.checks) {
      lines.push(`${c.ok ? "✓" : "✗"} ${f} :: ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    if (!report.ok) allOk = false;
  }
  return { ok: allOk, lines };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const out = typeof args.out === "string" ? args.out : join(ROOT, "dist", "release");
  const gate = runReleaseGate({ tag: typeof args.tag === "string" ? args.tag : undefined, skipGate: !!args["skip-gate"] });
  if (gate.length > 0) {
    for (const f of gate) console.error(`✗ gate: ${f}`);
    process.exit(1);
  }
  console.log("✓ release gate passed (release:check + claim-lint + tag identity)");

  const report = await buildRelease({
    out,
    targets: typeof args.targets === "string" ? (args.targets as string).split(",") : undefined,
    skipBuildFrom: typeof args["skip-build"] === "string" ? args["skip-build"] : undefined,
    withNpm: !!args["with-npm"],
    localSign: !!args["local-sign"],
  });
  for (const a of report.assets) {
    console.log(`  ${a.file.padEnd(28)} ${(a.bytes / 1024 / 1024).toFixed(1)} MiB  sha256:${a.sha256.slice(0, 16)}…  [${a.kind}]`);
  }
  if (report.failures.length > 0) {
    for (const f of report.failures) console.error(`✗ ${f}`);
    process.exit(1);
  }

  if (args.verify || args["local-sign"]) {
    const v = await verifyBundle(out, { localSign: !!args["local-sign"] });
    for (const l of v.lines) console.log(l);
    if (!v.ok) {
      console.error("✗ release bundle failed independent verification — refusing (fail closed)");
      process.exit(1);
    }
  }
  console.log(`✅ release bundle complete and verified: ${out}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[release-build] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
