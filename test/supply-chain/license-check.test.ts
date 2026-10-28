import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLicenseCheck } from "../../scripts/license-check.ts";

const dirs: string[] = [];
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function fixture(installed: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "xr-license-platform-")); dirs.push(root);
  const glibc = "@oven/bun-linux-x64", musl = "@oven/bun-linux-x64-musl", mac = "@oven/bun-darwin-aarch64";
  writeFileSync(join(root, "bun.lock"), JSON.stringify({
    workspaces: { "": { optionalDependencies: { [glibc]: "1.4.2", [musl]: "1.4.2", [mac]: "1.4.2" } } },
    packages: {
      [glibc]: [`${glibc}@1.4.2`, "", { os: "linux", cpu: "x64" }],
      [musl]: [`${musl}@1.4.2`, "", { os: "linux", cpu: "x64" }],
      [mac]: [`${mac}@1.4.2`, "", { os: "darwin", cpu: "arm64" }],
      "ordinary-dependency": ["ordinary-dependency@1.0.0", "", {}],
    },
  }));
  for (const [name, license] of Object.entries(installed)) {
    const dir = join(root, "node_modules", ...name.split("/")); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: name.startsWith("@oven/") ? "1.4.2" : "1.0.0", license }));
  }
  return { root, glibc, musl, mac, target: { platform: "linux", arch: "x64", libc: "glibc" as const } };
}

describe("license check for optional native runtimes", () => {
  test("missing incompatible optional platforms are not treated as missing required packages", () => {
    const f = fixture({ "@oven/bun-linux-x64": "MIT", "ordinary-dependency": "MIT" });
    const result = runLicenseCheck({ root: f.root, target: f.target });
    expect(result.results.find((r) => r.name === f.glibc)?.status).toBe("ok");
    expect(result.results.find((r) => r.name === f.musl)?.status).toBe("not-applicable");
    expect(result.results.find((r) => r.name === f.mac)?.status).toBe("not-applicable");
  });

  test("missing applicable runtime and ordinary dependencies still fail", () => {
    const f = fixture({});
    const result = runLicenseCheck({ root: f.root, target: f.target });
    expect(result.results.find((r) => r.name === f.glibc)?.status).toBe("missing");
    expect(result.results.find((r) => r.name === "ordinary-dependency")?.status).toBe("missing");
    expect(result.ok).toBe(false);
  });

  test("an installed incompatible package is still inspected, not waived", () => {
    const f = fixture({ "@oven/bun-linux-x64": "MIT", "@oven/bun-darwin-aarch64": "GPL-3.0", "ordinary-dependency": "MIT" });
    const result = runLicenseCheck({ root: f.root, target: f.target });
    expect(result.results.find((r) => r.name === f.mac)?.status).toBe("forbidden");
    expect(result.ok).toBe(false);
  });

  test("Bun's MIT package metadata cannot hide its embedded LGPL components", () => {
    const f = fixture({ "@oven/bun-linux-x64": "MIT", "ordinary-dependency": "MIT" });
    const result = runLicenseCheck({ root: f.root, target: f.target });
    const embedded = result.results.find((r) => r.name === "Bun embedded components");
    expect(embedded?.status).toBe("review-required");
    expect(embedded?.license).toContain("LGPL");
    expect(result.ok).toBe(false);
  });

  test("a version-matched owner ack turns the embedded-components row ok", () => {
    const f = fixture({ "@oven/bun-linux-x64": "MIT", "ordinary-dependency": "MIT" });
    mkdirSync(join(f.root, "licenses"), { recursive: true });
    writeFileSync(join(f.root, "licenses", "bun-v1.4.2-REVIEW-ACK.json"), JSON.stringify({
      version: "1.4.2", decision: "acknowledged-for-redistribution",
      decidedBy: "owner", decidedAt: "2026-10-28",
    }));
    const result = runLicenseCheck({ root: f.root, target: f.target });
    const embedded = result.results.find((r) => r.name === "Bun embedded components");
    expect(embedded?.status).toBe("ok");
    expect(embedded?.license).toContain("acknowledged 2026-10-28 by owner");
    expect(result.ok).toBe(true);
  });

  test("the ack is version-pinned: a mismatched or malformed ack fails closed", () => {
    const f = fixture({ "@oven/bun-linux-x64": "MIT", "ordinary-dependency": "MIT" });
    mkdirSync(join(f.root, "licenses"), { recursive: true });
    // Ack names a different version than the locked runtime → fresh review.
    writeFileSync(join(f.root, "licenses", "bun-v1.4.2-REVIEW-ACK.json"), JSON.stringify({
      version: "1.5.0", decision: "acknowledged-for-redistribution",
      decidedBy: "owner", decidedAt: "2026-10-28",
    }));
    expect(runLicenseCheck({ root: f.root, target: f.target }).results.find((r) => r.name === "Bun embedded components")?.status).toBe("review-required");
    // Malformed JSON → fail closed, never a crash-based pass.
    writeFileSync(join(f.root, "licenses", "bun-v1.4.2-REVIEW-ACK.json"), "{not json");
    expect(runLicenseCheck({ root: f.root, target: f.target }).results.find((r) => r.name === "Bun embedded components")?.status).toBe("review-required");
    // A decision value that is not the explicit acknowledgement → fail closed.
    writeFileSync(join(f.root, "licenses", "bun-v1.4.2-REVIEW-ACK.json"), JSON.stringify({
      version: "1.4.2", decision: "maybe", decidedBy: "", decidedAt: "",
    }));
    expect(runLicenseCheck({ root: f.root, target: f.target }).results.find((r) => r.name === "Bun embedded components")?.status).toBe("review-required");
  });
});
