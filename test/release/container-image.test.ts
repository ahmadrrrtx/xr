/**
 * XR-LAUNCH-020 — the container image is glibc-based and CI proves its file tools.
 *
 * The filesystem authority (src/security/fs-native.ts) dlopens glibc's
 * libc.so.6; on Alpine/musl every read_file/write_file failed closed. Docker is
 * not available in every test environment, so this pins the invariants that
 * make the image work and runs the in-image probe on the host.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runContainerFileSmoke } from "../../scripts/container-file-smoke.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("XR-LAUNCH-020 · glibc container image", () => {
  const dockerfile = read("Dockerfile");

  test("the base is oven/bun:<.bun-version>-slim (Debian, glibc), never Alpine/musl", () => {
    const bun = read(".bun-version").trim();
    const from = dockerfile.split("\n").filter((l) => /^FROM\s/i.test(l));
    expect(from).toEqual([`FROM oven/bun:${bun}-slim AS base`]);
    expect(dockerfile).not.toMatch(/^FROM .*alpine/im);
    expect(dockerfile).not.toMatch(/^RUN apk /m);
    expect(dockerfile).toMatch(/apt-get upgrade -y/);
  });

  test("CI runs --version and the real file-tool smoke inside the built image (required Supply Chain gate)", () => {
    const wf = read(".github/workflows/supply-chain.yml");
    expect(wf).toContain("docker run --rm xr:scan --version");
    expect(wf).toContain("docker run --rm --entrypoint bun xr:scan run scripts/container-file-smoke.ts");
    const journey = read("scripts/journey/docker-journey.ts");
    expect(journey).toContain('"run", "scripts/container-file-smoke.ts"');
    expect(journey).not.toContain("alpine");
  });

  test("the image ships the probe (scripts/ is copied)", () => {
    expect(dockerfile).toContain("COPY scripts ./scripts");
  });

  test.skipIf(process.platform !== "linux")("the probe passes on a glibc host: write → read round-trip, `../` refused", async () => {
    const r = await runContainerFileSmoke();
    expect(r.backend).toBe("linux-openat2");
    expect(r.write.ok).toBe(true);
    expect(r.read.matches).toBe(true);
    expect(r.escape.refused).toBe(true);
    expect(r.pass).toBe(true);
  });
});
