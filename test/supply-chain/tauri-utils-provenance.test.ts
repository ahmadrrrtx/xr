import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const vendor = resolve(import.meta.dir, "../../desktop/src-tauri/vendor/tauri-utils");
const read = (path: string) => readFileSync(resolve(vendor, path));

test("the vendored Tauri package changes only serde_with's two feature settings", () => {
  const provenance = JSON.parse(read("XR-PROVENANCE.json").toString()) as {
    version: string; crateSha256: string; files: Record<string, string>;
  };
  expect(provenance.version).toBe("2.10.0");
  expect(provenance.crateSha256).toBe("4dd257082deff79550de3409ed146104aeaf86fe38649615b04a304144939677");
  const upstream = read("Cargo.toml.upstream").toString();
  const before = '[dependencies.serde_with]\nversion = "3"\n';
  expect(upstream.split(before)).toHaveLength(2);
  expect(read("Cargo.toml").toString()).toBe(upstream.replace(before,
    `${before}default-features = false\nfeatures = ["macros"]\n`));
  for (const [path, hash] of Object.entries(provenance.files)) {
    const actual = read(path === "Cargo.toml" ? "Cargo.toml.upstream" : path);
    expect(createHash("sha256").update(actual).digest("hex")).toBe(hash);
  }
  const files: string[] = [];
  function walk(path = "") {
    for (const entry of readdirSync(resolve(vendor, path), { withFileTypes: true })) {
      const relative = path ? `${path}/${entry.name}` : entry.name;
      expect(entry.isSymbolicLink()).toBe(false);
      if (entry.isDirectory()) walk(relative);
      else files.push(relative);
    }
  }
  walk();
  expect(files.sort()).toEqual([...Object.keys(provenance.files),
    "Cargo.toml.upstream", "XR-PROVENANCE.json", "XR-PATCH.md"].sort());
  expect(Object.keys(provenance.files)).toContain("LICENSE-APACHE-2.0");
  expect(Object.keys(provenance.files)).toContain("LICENSE-MIT");
});

test("every upstream provenance file is tracked, not supplied by an ignored local copy", () => {
  const provenance = JSON.parse(read("XR-PROVENANCE.json").toString()) as {
    files: Record<string, string>;
  };
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--",
    ...Object.keys(provenance.files).map(path => `desktop/src-tauri/vendor/tauri-utils/${path}`),
  ], { cwd: resolve(import.meta.dir, "../.."), encoding: "utf8" });
  expect(tracked.error).toBeUndefined();
  expect(tracked.stderr).toBe("");
  expect(tracked.status).toBe(0);
});

test("the public-checksum Gitleaks exceptions pin only the two immutable introduction findings", () => {
  const path = "desktop/src-tauri/vendor/tauri-utils/XR-PROVENANCE.json";
  const ignore = readFileSync(resolve(import.meta.dir, "../../.gitleaksignore"), "utf8")
    .split(/\r?\n/).filter(line => line.trim() && !line.startsWith("#"));
  expect(ignore.filter(line => line.includes("vendor/tauri-utils"))).toEqual([
    `c27aee16b4eda489a510f340f41c6aa93776c6a2:${path}:generic-api-key:44`,
    `af6eda0fa78e3e2555f36adb0a477d09858bfba6:${path}:generic-api-key:44`,
  ]);
});
