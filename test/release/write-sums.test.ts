import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { parse } from "../../scripts/sums.ts";
import { subjectsIncludingManifest, writeSums } from "../../scripts/write-sums.ts";

describe("Phase 3 — portable SHA256SUMS writer", () => {
  test("writeSums hashes files, skips SHA256SUMS/.bundle/dirs, matches scripts/sums.parse", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-sums-"));
    try {
      writeFileSync(join(dir, "xr-linux-x64"), "binary-a");
      writeFileSync(join(dir, "sbom.cyclonedx.json"), "{\"bomFormat\":\"CycloneDX\"}");
      writeFileSync(join(dir, "skip.bundle"), "sig");
      mkdirSync(join(dir, "subdir"));
      writeFileSync(join(dir, "subdir", "nested"), "nope");
      const sums = writeSums(dir);
      expect(sums.has("xr-linux-x64")).toBe(true);
      expect(sums.has("sbom.cyclonedx.json")).toBe(true);
      expect(sums.has("skip.bundle")).toBe(false);
      expect(sums.has("SHA256SUMS")).toBe(false);
      expect(sums.has("nested")).toBe(false);
      const body = readFileSync(join(dir, "SHA256SUMS"), "utf8");
      const parsed = parse(body);
      expect(parsed.get("xr-linux-x64")).toBe(
        createHash("sha256").update("binary-a").digest("hex"),
      );
      expect(parsed.size).toBe(sums.size);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--print-with-manifest includes a hash of SHA256SUMS itself", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-sums-m-"));
    try {
      writeFileSync(join(dir, "a.bin"), "aaa");
      const printed = subjectsIncludingManifest(dir);
      expect(printed).toMatch(/[0-9a-f]{64}  a\.bin/);
      expect(printed).toMatch(/[0-9a-f]{64}  SHA256SUMS/);
      const disk = parse(readFileSync(join(dir, "SHA256SUMS"), "utf8"));
      expect(disk.has("SHA256SUMS")).toBe(false); // disk file does not self-hash
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
