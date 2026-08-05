/**
 * XR Phase 9 · T6 — Beta install survey effect tests.
 * The metric must be REAL: a fake-but-executable binary in a local canonical
 * asset set surveys to 100%; corruption (missing/mismatched sums) → the gate
 * fails. Disproving the metric is part of proving it.
 * POSIX-only (spawns shell-script binaries); skipped elsewhere by design.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const POSIX = process.platform !== "win32";
const SURVEY = join(import.meta.dir, "..", "..", "scripts", "beta-install-survey.ts");
const FILE_NAME = process.platform === "darwin" ? "xr-darwin-arm64" : `xr-${process.platform}-${process.arch}`;

function makeReleaseDir(withIntegrityFailure = false): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-survey-release-"));
  const bin = join(dir, FILE_NAME);
  const body = withIntegrityFailure
    ? "#!/usr/bin/env bash\nexit 42\n"
    : '#!/usr/bin/env bash\ncase "$1" in doctor) echo "{}";; *) echo "7.1.0 (Truth)";; esac\nexit 0\n';
  const bytes = withIntegrityFailure
    ? "#!/usr/bin/env bash\necho PRETEND-OK\n"
    : body;
  writeFileSync(bin, bytes);
  chmodSync(bin, 0o755);
  const sha = createHash("sha256").update(Buffer.from(body)).digest("hex"); // hash of the GOOD body — mismatch when tampered
  writeFileSync(join(dir, "SHA256SUMS"), `${sha}  ${FILE_NAME}\n`);
  return dir;
}

function runSurvey(dir: string, runs = 2): { status: number | null; report: { ok: boolean; rate: number; failures: unknown[] } } {
  const res = spawnSync("bun", ["run", SURVEY, `--release-dir=${dir}`, `--runs=${runs}`, "--target=0.99"], {
    encoding: "utf8",
    timeout: 240_000,
    env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
  });
  const line = (res.stdout ?? "").trim().split("\n").pop() ?? "{}";
  return { status: res.status, report: JSON.parse(line) as { ok: boolean; rate: number; failures: unknown[] } };
}

describe("Phase 9 · T6 — Beta install survey measures install success", () => {
  test.skipIf(!POSIX)("a healthy canonical asset set installs at 100% (gate passes)", () => {
    const dir = makeReleaseDir();
    try {
      const { status, report } = runSurvey(dir, 2);
      expect(status).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.rate).toBe(1);
      expect(report.failures).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(!POSIX)("a tampered artifact fails the gate (integrity step names the failure)", () => {
    const dir = makeReleaseDir(true);
    try {
      const { status, report } = runSurvey(dir, 2);
      expect(status).toBe(1);
      expect(report.ok).toBe(false);
      expect(report.rate).toBe(0);
      expect((report.failures as Array<{ step: string }>).some((f) => f.step === "integrity" || f.step === "smoke-version")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
