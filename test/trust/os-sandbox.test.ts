/**
 * XR-LAUNCH-003 (decision D3) — macOS Seatbelt / Windows AppContainer.
 *
 * Unit part (every OS): opt-in default, per-OS remediation text, SBPL profile
 * shape, Windows argument quoting.
 * Smoke part (only on darwin/win32 with XR_OS_SANDBOX=experimental, run by
 * .github/workflows/os-sandbox.yml): echo, git status and an in-workspace write
 * succeed; a write beside the workspace and a read of a sibling secret fail;
 * network is denied.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tier2Remediation } from "../../src/runtime/trust/policy.ts";
import { NamespaceSandboxBackend, nativeSelfCheckDiagnostic, osSandboxOptIn } from "../../src/runtime/trust/environment/namespace.ts";
import { seatbeltArgv, seatbeltProfile } from "../../src/runtime/trust/environment/seatbelt.ts";
import { quoteWindowsArg } from "../../src/runtime/trust/environment/appcontainer.ts";

describe("XR-LAUNCH-003 · native sandboxes are opt-in and remediation fits the OS", () => {
  test("opt-in is off unless XR_OS_SANDBOX=experimental", () => {
    expect(osSandboxOptIn({})).toBe(false);
    expect(osSandboxOptIn({ XR_OS_SANDBOX: "1" })).toBe(false);
    expect(osSandboxOptIn({ XR_OS_SANDBOX: "experimental" })).toBe(true);
  });

  test("macOS/Windows remediation never says to install bubblewrap", () => {
    for (const p of ["darwin", "win32"] as const) {
      const text = tier2Remediation(p);
      expect(text.toLowerCase()).not.toContain("bubblewrap");
      expect(text).toContain("XR_OS_SANDBOX=experimental");
      expect(text).toContain("will not run in-process");
    }
    expect(tier2Remediation("linux")).toContain("bubblewrap");
  });
});

describe("Seatbelt profile", () => {
  const profile = seatbeltProfile(1, 1);
  test("deny-by-default, no network rule, paths only as parameters", () => {
    expect(profile.split("\n")[1]).toBe("(deny default)");
    expect(profile).not.toMatch(/\(allow network/);
    expect(profile).not.toMatch(/\(allow file-read\*\)/); // never unfiltered
    expect(profile).not.toMatch(/\(allow file-write\*\)/);
    expect(profile).not.toContain("/Users");
    expect(profile).toContain('(subpath (param "W0"))');
    expect(profile).toContain('(subpath (param "R0"))');
    // read-only roots are not writable
    const writeRule = profile.split("\n").find((l) => l.startsWith("(allow file-write*"))!;
    expect(writeRule).not.toContain('(param "R0")');
  });

  test("argv passes realpath'd roots via -D", () => {
    const d = mkdtempSync(join(tmpdir(), "xr-sb-unit-"));
    try {
      const argv = seatbeltArgv([d], [], d, ["/bin/echo", "hi"]);
      expect(argv[0]).toBe("/usr/bin/sandbox-exec");
      expect(argv).toContain(`W0=${require("node:fs").realpathSync(d)}`);
      expect(argv.slice(-2)).toEqual(["/bin/echo", "hi"]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("Windows argument quoting (MSVCRT rules)", () => {
  test.each([
    ["plain", "plain"],
    ["with space", '"with space"'],
    ['say "hi"', '"say \\"hi\\""'],
    ["C:\\dir with space\\", '"C:\\dir with space\\\\"'],
    ["", '""'],
  ])("%p → %p", (input, expected) => {
    expect(quoteWindowsArg(input)).toBe(expected);
  });
});

// ── Hardware/CI smoke (darwin, win32 with the opt-in) ─────────────────────
//
// `detect()` is resolved ONCE, here: the smoke below may only claim the
// containment results for a mechanism the product actually offers on this
// host. `namespace.ts` refuses the AppContainer mechanism outright until its
// per-run SID/ACL lifecycle is verified (a shared SID accumulates workspace ACL
// grants across runs), so on Windows the honest smoke is "the mechanism is
// unavailable and every Tier-2 run is refused" — not a pretend pass and not a
// red lane for a deliberate product decision. A SELF-CHECK FAILURE (a mechanism
// that should work but does not) still fails: only the documented policy reason
// is treated as an expected skip.
const nativeHost = process.platform === "darwin" || process.platform === "win32";
const optIn = osSandboxOptIn();
const backend = new NamespaceSandboxBackend();
const detected = nativeHost && optIn ? await backend.detect() : false;
const detectionReason = nativeHost && optIn && !detected ? nativeSelfCheckDiagnostic() : "";
const policyDisabled = detectionReason.includes(
  "pending per-execution SID/ACL lifecycle verification",
);
const smoke = nativeHost && optIn && detected;
describe.if(nativeHost && optIn)(`native sandbox smoke (${process.platform})`, () => {
  let base = "", ws = "", secret = "";
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "xr-os-smoke-"));
    ws = join(base, "ws");
    mkdirSync(ws);
    secret = join(base, "secret.txt");
    writeFileSync(secret, "XR-SMOKE-SECRET");
    spawnSync("git", ["init", "-q", ws]);
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const win = process.platform === "win32";
  const run = (argv: string[]) =>
    backend.run(
      { argv, cwd: ws, env: {}, timeoutMs: 20_000, maxOutputBytes: 65_536 } as never,
      { grant: { fs: { writableRoots: [ws], readOnlyRoots: [], blockedPaths: [] }, net: { mode: "none", allowlist: [] } }, envInject: {} } as never,
    );
  const shell = (cmd: string) => run(win ? ["cmd.exe", "/d", "/c", cmd] : ["/bin/sh", "-c", cmd]);
  // Print a failing run BEFORE asserting (a thrown expect hides everything else).
  const shown = async (label: string, p: Promise<{ ok: boolean }>) => {
    const r = await p;
    if (!r.ok) console.error(`[os-sandbox] ${label} failed: ${JSON.stringify(r).slice(0, 2000)}`);
    return r as Awaited<ReturnType<typeof run>>;
  };

  if (!smoke) {
    // Either the mechanism failed its own self-check, or the product refuses it
    // by policy. Both are "no native boundary on this host" and both must mean
    // fail closed at the ONE place that matters: the run itself.
    test("a Tier-2 run is REFUSED when no native mechanism is available", async () => {
      const r = await shell("echo refused");
      expect(r.ok).toBe(false);
      // Fail closed at the boundary: a refusal, not a silent unsandboxed run.
      expect(String(r.stderr)).toContain("namespace sandbox refused");
      expect(String(r.stdout)).toBe("");
      expect((r as { exitCode?: number | null }).exitCode ?? null).toBeNull();
      console.error(`[os-sandbox] ${process.platform}: no native mechanism — ${detectionReason || "self-check failed"}`);
    });
    if (policyDisabled) {
      test.skip(
        `native ${win ? "AppContainer" : "Seatbelt"} policy-disabled: ${detectionReason}`,
        () => {},
      );
    } else {
      // A mechanism that SHOULD exist on this host but fails its self-check is a
      // defect: never a skip. Name what the product reported.
      test("the mechanism self-check FAILED (not a policy disable)", () => {
        expect({ detected, reason: detectionReason }).toEqual({
          detected: true,
          reason: "",
        });
      });
    }
    return;
  }

  test("the mechanism is detected (self-check passed)", async () => {
    expect(detected).toBe(true);
    expect(backend.activeMechanism).toBe(win ? "appcontainer" : "seatbelt");
  });
  test("echo works", async () => {
    const r = await shown("echo", shell("echo hello"));
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain("hello");
  });
  test("git status works in the workspace", async () => {
    const r = await shown("git status", run(["git", "status", "--porcelain"]));
    // Windows Server images deny AppContainers the NUL device, which Git for Windows opens at startup
    // (landstrip#204, agent-bridle#408). Disclosed limitation; any other failure still fails the test.
    if (win && !r.ok && /could not open '\/dev\/null'.*Permission denied/.test(r.stderr)) return;
    expect(r.ok).toBe(true);
  });
  test("in-workspace write succeeds", async () => {
    const r = await shown("in-workspace write", shell(win ? "echo inside> inside.txt" : "echo inside > inside.txt"));
    expect(r.ok).toBe(true);
    expect(readFileSync(join(ws, "inside.txt"), "utf8")).toContain("inside");
  });
  test("write beside the workspace is denied", async () => {
    const target = join(base, "outside.txt");
    await shell(win ? `echo x> "${target}"` : `echo x > '${target}'`);
    expect(existsSync(target)).toBe(false);
  });
  test("reading a sibling secret is denied", async () => {
    const r = await shell(win ? `type "${secret}"` : `cat '${secret}'`);
    expect(r.stdout).not.toContain("XR-SMOKE-SECRET");
  });
  test("network is denied", async () => {
    const r = win
      ? await run(["powershell.exe", "-NoProfile", "-Command", "try { (New-Object Net.Sockets.TcpClient).Connect('1.1.1.1', 443); 'CONNECTED' } catch { 'blocked' }"])
      : await shell("/usr/bin/nc -z -G 3 1.1.1.1 443 && echo CONNECTED || echo blocked");
    expect(r.stdout).not.toContain("CONNECTED");
  }, 30_000); // above the run's own 20 s limit: a cold PowerShell start plus a blocked connect exceeded 5 s on windows-latest
});
