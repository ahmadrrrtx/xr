import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
