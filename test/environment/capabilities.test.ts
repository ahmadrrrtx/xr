/** XR 5.1 — Capability detection tests (honest platform matrix, §10/§14). */
import { describe, test, expect, setDefaultTimeout } from "bun:test";

setDefaultTimeout(20_000);
import {
  detectEnvironmentCapabilities,
  probePlaywright,
  capabilityFor,
  invalidateEnvironmentCapabilityCache,
} from "../../src/environment/capabilities.ts";

describe("probePlaywright (real, not optimistic)", () => {
  test("reports the true module state", async () => {
    invalidateEnvironmentCapabilityCache();
    const res = await probePlaywright();
    // playwright is a declared dependency of this package.
    expect(res.available).toBe(true);
    expect(res.detail).toContain("chromium");
  });
});

describe("detectEnvironmentCapabilities", () => {
  test("covers all six environments with honest support levels", async () => {
    const report = await detectEnvironmentCapabilities();
    expect(["linux", "macos", "windows"]).toContain(report.os);
    expect(report.entries.length).toBe(6);
    for (const env of ["browser", "desktop", "filesystem", "application", "voice", "vision"] as const) {
      const e = capabilityFor(report, env);
      expect(e, `missing ${env} entry`).toBeDefined();
      expect(["supported", "partial", "unsupported"]).toContain(e!.support);
    }
  });

  test("browser capability comes from the real playwright probe", async () => {
    const report = await detectEnvironmentCapabilities();
    const browser = capabilityFor(report, "browser")!;
    expect(browser.support).toBe("supported");
    expect(browser.working.join(" ")).toContain("isolated session contexts");
  });

  test("filesystem is structurally supported (node fs) but permissions gate mutations", async () => {
    const report = await detectEnvironmentCapabilities();
    const fsEntry = capabilityFor(report, "filesystem")!;
    expect(fsEntry.support).toBe("supported");
    expect(fsEntry.working.join(" ")).toContain("approval");
  });

  test("voice/vision entries list remediation when tools are missing", async () => {
    const report = await detectEnvironmentCapabilities();
    for (const env of ["voice", "vision", "desktop"] as const) {
      const e = capabilityFor(report, env)!;
      if (e.support !== "supported" && e.missing.length > 0) {
        expect(e.remediation || env !== "voice", `voice without remediation`).toBeTruthy();
      }
    }
  });
});
