import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyUpdaterConfig } from "../../scripts/generate-updater-keys";

// NEW-24: the desktop shell locked zip 4.6.1, which six advisories cover, all fixed by 9.0.5:
//   GHSA-m665-v7pm-7grj (CRITICAL, "Zip Cloaking", <= 9.0.4), RUSTSEC-2026-0367 / 0368 / 0369 (< 9.0.0),
//   GHSA-8hxf-qr8p-62x4 (>= 0.6.0, < 9.0.0) and GHSA-q7v9-x93c-xqv3 (>= 1.3.0, < 9.0.0).
// The shell now locks zip 9.x, and tauri-plugin-updater is built without its `zip` feature: through 2.14.0
// that feature pinned zip ^4, and it only unpacks Tauri v1-style wrapped payloads, which XR never publishes.
const tauri = resolve(import.meta.dir, "../../desktop/src-tauri");
const read = (rel: string) => readFileSync(resolve(tauri, rel), "utf8");
const FIXED = [9, 0, 5] as const;
const ADVISORIES = [
  "GHSA-m665-v7pm-7grj",
  "RUSTSEC-2026-0367",
  "RUSTSEC-2026-0368",
  "RUSTSEC-2026-0369",
  "GHSA-8hxf-qr8p-62x4",
  "GHSA-q7v9-x93c-xqv3",
];

const triple = (v: string) => v.split(/[-+]/)[0]!.split(".").map(Number);
const below = (a: readonly number[], b: readonly number[]) =>
  a[0]! < b[0]! || (a[0] === b[0] && (a[1]! < b[1]! || (a[1] === b[1] && a[2]! < b[2]!)));

type Pkg = { name: string; version: string; deps: string[] };
const lockPackages = (): Pkg[] =>
  read("Cargo.lock")
    .split(/\n\n(?=\[\[package\]\]\n)/)
    .flatMap(block => {
      const name = /^name = "(.+)"$/m.exec(block)?.[1];
      const version = /^version = "(.+)"$/m.exec(block)?.[1];
      if (!name || !version) return [];
      const list = /^dependencies = \[\n([\s\S]*?)\n\]/m.exec(block)?.[1] ?? "";
      const deps = [...list.matchAll(/^ "([^" ]+)/gm)].map(m => m[1]!);
      return [{ name, version, deps }];
    });

type Dep = string | { version?: string; "default-features"?: boolean; features?: string[] };
const manifest = () => Bun.TOML.parse(read("Cargo.toml")) as { dependencies: Record<string, Dep> };

test("the version bound matches the advisories' first fixed release", () => {
  expect(below(triple("4.6.1"), FIXED)).toBe(true);
  expect(below(triple("9.0.4"), FIXED)).toBe(true);
  expect(below(triple("9.0.5"), FIXED)).toBe(false);
  expect(below(triple("9.8.2"), FIXED)).toBe(false);
});

test("every zip in the desktop lock is 9.0.5 or later", () => {
  const zips = lockPackages().filter(p => p.name === "zip");
  expect(zips.length).toBeGreaterThan(0);
  for (const z of zips) expect({ zip: z.version, vulnerable: below(triple(z.version), FIXED) }).toEqual({ zip: z.version, vulnerable: false });
});

test("the shell's own zip requirement cannot resolve below 9.0.5", () => {
  const zip = manifest().dependencies.zip;
  const req = typeof zip === "string" ? zip : zip?.version;
  expect(req).toMatch(/^\^?\d+(\.\d+){0,2}$/);
  const floor = triple(req!.replace(/^\^/, "").padEnd(5, ".0").split(".").slice(0, 3).join("."));
  expect(floor[0]).toBe(9);
  expect(below(floor, FIXED)).toBe(false);
});

test("tauri-plugin-updater is built without its zip feature, so only the shell depends on zip", () => {
  const updater = manifest().dependencies["tauri-plugin-updater"];
  expect(typeof updater).toBe("object");
  const spec = updater as Exclude<Dep, string>;
  expect(spec["default-features"]).toBe(false);
  expect(spec.features ?? []).not.toContain("zip");
  // The two other defaults stay on: TLS for the download and the system proxy.
  expect(spec.features).toEqual(expect.arrayContaining(["rustls-tls", "system-proxy"]));
  const dependents = lockPackages().filter(p => p.deps.includes("zip")).map(p => p.name);
  expect(dependents).toEqual(["xr-desktop"]);
});

test("XR's updater payloads stay Tauri v2 shaped, which the updater installs without unpacking", () => {
  const conf = applyUpdaterConfig({}, "pubkey") as { bundle: { createUpdaterArtifacts: unknown } };
  expect(conf.bundle.createUpdaterArtifacts).toBe(true);
  const shipped = JSON.parse(read("tauri.conf.json")) as { bundle?: { createUpdaterArtifacts?: unknown } };
  expect(shipped.bundle?.createUpdaterArtifacts).not.toBe("v1Compatible");
});

test("the settings import enforces local/central header consistency on every entry", () => {
  const src = read("src/data_safety.rs");
  const stage = src.slice(src.indexOf("fn stage_into("), src.indexOf("pub fn has_pending_import("));
  expect(stage).toContain("enforce_header_consistency(true)");
  expect(stage).toContain(".by_index_with_options(i, strict)");
  expect(stage).not.toContain(".by_index(i)");
  expect(src).toContain("fn a_cloaked_archive_whose_local_header_names_another_file_is_refused()");
});

test("the OSV policy no longer ignores any zip advisory", () => {
  const policy = Bun.TOML.parse(read("osv-scanner.toml")) as { IgnoredVulns?: { id: string; reason?: string }[] };
  const entries = policy.IgnoredVulns ?? [];
  for (const id of ADVISORIES) expect(entries.map(e => e.id)).not.toContain(id);
  expect(entries.filter(e => /\bzip \d/.test(e.reason ?? "")).map(e => e.id)).toEqual([]);
});
