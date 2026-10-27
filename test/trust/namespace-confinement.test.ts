/**
 * XR-LAUNCH-004 — the Linux namespace sandbox must confine the filesystem.
 *
 * Re-runs the launch-audit probes (ledger §3.4 SH1/SH2/H1/H2/H3) directly
 * against the backend, once per mechanism available on this host:
 *   - a sibling file next to the workspace can be neither read nor written,
 *   - the caller's HOME, /home and /root are not visible,
 *   - writes inside the workspace reach the host; /tmp is private scratch,
 *   - a symlink in the workspace that points outside resolves to nothing,
 *   - network is none,
 *   - a setup step that cannot be completed refuses the command (fail closed).
 * Skipped (with a reason) on hosts without the mechanism.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  NamespaceSandboxBackend,
  SETUP_FAILED_MARKER,
  unshareRootScript,
} from "../../src/runtime/trust/environment/namespace.ts";

const linux = process.platform === "linux" && process.getuid?.() !== 0;
const bases: string[] = [];
afterAll(() => {
  for (const b of bases) rmSync(b, { recursive: true, force: true });
});

function grantFor(writable: string[], readOnly: string[] = []) {
  return {
    fs: { writableRoots: writable, readOnlyRoots: readOnly, blockedPaths: [] },
    net: { mode: "none", allowlist: [] },
  } as never;
}

async function sh(b: NamespaceSandboxBackend, cwd: string, cmd: string, writable = [cwd], readOnly: string[] = []) {
  return b.run(
    { argv: ["/bin/sh", "-c", cmd], cwd, env: {}, timeoutMs: 15_000, maxOutputBytes: 65_536 } as never,
    { grant: grantFor(writable, readOnly), envInject: {} } as never,
  );
}

/** Workspace + sibling secret under `parent` (a HOME-like or TMP-like tree). */
function layout(parent: string) {
  mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(join(parent, "xr-confine-"));
  bases.push(base);
  const ws = join(base, "ws");
  mkdirSync(ws);
  const sibling = join(base, "fake_dotfile");
  writeFileSync(sibling, "SECRET\n");
  return { base, ws, sibling };
}

for (const mechanism of ["unshare", "bwrap"] as const) {
  // Finish real probes before registering tests; async describe callbacks can
  // otherwise overlap unrelated tests that deliberately replace spawn/env.
  const backend = new NamespaceSandboxBackend({ only: mechanism, bwrapPath: process.env.XR_TEST_BWRAP_PATH });
  const available = linux && (await backend.detect());
  if (linux && mechanism === "bwrap" && process.env.XR_TEST_BWRAP_PATH && !available) throw new Error("Explicit test bwrap failed the real confinement self-check; do not hide it as a skip");
  describe(`namespace sandbox (${mechanism}) confines the filesystem`, () => {
    const t = available ? test : test.skip;
    if (!available) test.skip(`${mechanism} unavailable on this host — nothing to verify`, () => {});

    for (const [label, parent] of [
      ["workspace under HOME (H1/H2)", join(homedir(), ".cache", "xr-confine-tests")],
      ["workspace under TMPDIR (SH1/SH2)", tmpdir()],
    ] as const) {
      t(`${label}: sibling unreadable and unwritable; host file unchanged`, async () => {
        const { ws, sibling } = layout(parent);
        const read = await sh(backend, ws, `cat ${JSON.stringify(sibling)}`);
        expect(read.ok).toBe(false);
        expect(read.stdout).not.toContain("SECRET");
        const write = await sh(backend, ws, `echo INJECTED >> ${JSON.stringify(sibling)}`);
        // A /tmp sibling path may resolve to private scratch. Return status
        // is not the security property: the protected HOST bytes stay intact.
        if (!sibling.startsWith("/tmp/")) expect(write.ok).toBe(false);
        expect(readFileSync(sibling, "utf8")).toBe("SECRET\n");
      });
    }

    t("HOME, /root and other /home entries are absent", async () => {
      const { ws } = layout(tmpdir());
      const home = homedir();
      const r = await sh(backend, ws, `[ -e ${JSON.stringify(home)} ] && echo HOME_VISIBLE; [ -e /root ] && [ -n "$(ls -A /root 2>/dev/null)" ] && echo ROOT_VISIBLE; ls -A /home 2>/dev/null; echo done`);
      expect(r.ok).toBe(true);
      if (!(ws === home || ws.startsWith(home + "/"))) expect(r.stdout).not.toContain("HOME_VISIBLE");
      expect(r.stdout).not.toContain("ROOT_VISIBLE");
      const homeEntries = r.stdout.split("\n").filter((l) => l && l !== "done" && !l.endsWith("_VISIBLE"));
      for (const e of homeEntries) expect(ws.startsWith(`/home/${e}`)).toBe(true); // only the workspace's own ancestor
    });

    t("in-workspace writes reach the host; /tmp is private scratch", async () => {
      const { ws } = layout(tmpdir());
      const marker = `xr-scratch-${process.pid}-${Date.now()}`;
      const r = await sh(backend, ws, `echo hi > out.txt && cat out.txt && echo x > /tmp/${marker} && git --version >/dev/null && echo ok`);
      expect(r.ok).toBe(true);
      expect(r.stdout).toContain("hi");
      expect(readFileSync(join(ws, "out.txt"), "utf8")).toBe("hi\n");
      expect(existsSync(join("/tmp", marker))).toBe(false);
    });

    t("a symlink in the workspace pointing outside resolves to nothing", async () => {
      const { ws, sibling } = layout(join(homedir(), ".cache", "xr-confine-tests"));
      symlinkSync(sibling, join(ws, "link"));
      const r = await sh(backend, ws, "cat link");
      expect(r.ok).toBe(false);
      expect(r.stdout).not.toContain("SECRET");
    });

    t("readonly grant cannot be remounted writable; mapped-root cannot regain capabilities", async () => {
      const { ws, base } = layout(tmpdir());
      const ro = join(base, "ro"); mkdirSync(ro); writeFileSync(join(ro, "canary"), "ORIGINAL");
      const r = await sh(backend, ws, `mount -o remount,bind,rw ${JSON.stringify(ro)} && printf CHANGED > ${JSON.stringify(join(ro, "canary"))}`, [ws], [ro]);
      expect(r.ok).toBe(false);
      expect(readFileSync(join(ro, "canary"), "utf8")).toBe("ORIGINAL");
      const caps = await sh(backend, ws, "grep -E '^(Cap(Eff|Prm|Bnd|Amb)|NoNewPrivs):' /proc/self/status");
      expect(caps.ok).toBe(true);
      for (const kind of ["Eff", "Prm", "Bnd", "Amb"]) expect(caps.stdout).toMatch(new RegExp(`Cap${kind}:\\s+0+`));
      expect(caps.stdout).toMatch(/NoNewPrivs:\s+1/);
    });

    t("invalid limits and a blocked subtree never execute a host marker", async () => {
      const { ws } = layout(tmpdir());
      const exec = { argv: ["sh", "-c", "echo BAD > marker"], cwd: ws, env: {}, timeoutMs: 1000, maxOutputBytes: 4096, memoryBytes: NaN };
      const r = await backend.run(exec, { grant: grantFor([ws]), envInject: {} });
      expect(r.ok).toBe(false); expect(existsSync(join(ws, "marker"))).toBe(false);
      const blocked = { ...grantFor([ws]) as object, fs: { writableRoots: [ws], readOnlyRoots: [], blockedPaths: [join(ws, "private")] } } as never;
      const denied = await backend.run({ ...exec, memoryBytes: undefined }, { grant: blocked, envInject: {} });
      expect(denied.ok).toBe(false); expect(existsSync(join(ws, "marker"))).toBe(false);
    });

    t("hard CPU/address-space/process limits are applied and cannot be raised", async () => {
      const { ws } = layout(tmpdir());
      const r = await backend.run({ argv: ["/bin/sh", "-c", "cat /proc/self/limits; ulimit -v 131072 && echo RAISED"], cwd: ws, env: {}, timeoutMs: 2000, maxOutputBytes: 8192, cpuSeconds: 2, memoryBytes: 64 * 1024 * 1024, maxProcesses: 256 }, { grant: grantFor([ws]), envInject: {} });
      expect(r.ok).toBe(false); expect(r.stdout).not.toContain("RAISED");
      expect(r.stdout).toMatch(/Max cpu time\s+2\s+2/);
      expect(r.stdout).toMatch(/Max address space\s+67108864\s+67108864/);
      expect(r.stdout).toMatch(/Max processes\s+256\s+256/);
    });

    t("CPU, address-space, process and scratch ceilings reject real bounded attempts", async () => {
      const { ws } = layout(tmpdir());
      const exec = { argv: ["/bin/sh", "-c", "while :; do :; done"], cwd: ws, env: {}, timeoutMs: 4000, maxOutputBytes: 4096, cpuSeconds: 1 };
      const ctx = { grant: grantFor([ws]), envInject: {} };
      const cpu = await backend.run(exec, ctx);
      expect(cpu.ok).toBe(false); expect(cpu.timedOut).toBe(false); // RLIMIT_CPU, not the wall-clock timer
      const memory = await backend.run({ ...exec, argv: ["/usr/bin/python3", "-c", "bytearray(64*1024*1024)"], memoryBytes: 32 * 1024 * 1024 }, ctx);
      expect(memory.ok).toBe(false); expect(memory.stderr).toContain("MemoryError");
      const proc = await backend.run({ ...exec, argv: ["/bin/sh", "-c", "sleep 0.01 & wait"], maxProcesses: 1 }, ctx);
      expect(proc.ok).toBe(false); expect(proc.stderr).toMatch(/fork|Resource temporarily unavailable/i);
      const temp = await backend.run({ ...exec, argv: ["/bin/sh", "-c", "dd if=/dev/zero of=/tmp/fill bs=4096 count=8"], maxTempBytes: 8192 }, ctx);
      expect(temp.ok).toBe(false); expect(temp.stderr).toContain("No space left");
    });

    t("aborting an isolated action kills its delayed descendant, with no later host effect", async () => {
      const { ws } = layout(tmpdir()); const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 80);
      const r = await backend.run({ argv: ["/bin/sh", "-c", "(sleep 0.4; echo BAD > survived) & wait"], cwd: ws, env: {}, timeoutMs: 3000, maxOutputBytes: 4096, signal: c.signal }, { grant: grantFor([ws]), envInject: {} });
      clearTimeout(timer); expect(r.ok).toBe(false); expect(r.cancelled).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(existsSync(join(ws, "survived"))).toBe(false);
    });

    t("network is none", async () => {
      const { ws } = layout(tmpdir());
      const r = await sh(backend, ws, "cat /sys/class/net/*/operstate 2>/dev/null | grep -c up || true; ls /sys/class/net 2>/dev/null | grep -v '^lo$' || echo no-external-interfaces");
      expect(r.stdout).toContain("no-external-interfaces");
    });
  });
}

describe("unshare setup fails closed", () => {
  test("no staging mountpoint → the script refuses before mounting anything", () => {
    const script = unshareRootScript(["/"], []);
    expect(script).toContain(`${SETUP_FAILED_MARKER}: $1`);
    expect(script).toContain("fail no-staging-mountpoint");
    expect(script).not.toContain("pivot_root");
  });

  // The unshare script is Linux-only. Windows has none of the POSIX staging
  // mountpoints (/mnt, /srv, …), so the generator correctly refuses there
  // (the test above) and there are no mount steps to inspect.
  test.if(process.platform !== "win32")("every mount step is checked (no '|| true' on a confinement step)", () => {
    const script = unshareRootScript(["/srv/ws-does-not-matter"], ["/usr/share"]);
    for (const line of script.split("\n").filter((l) => /\bmount\b/.test(l) && !l.startsWith("fail()"))) {
      expect(line).toMatch(/\|\| fail [a-z-]+/);
    }
    expect(script).toContain("readonly-still-writable");
    expect(script).toContain("mount -o remount,bind,ro / || fail root-readonly");
  });

  const backend = new NamespaceSandboxBackend({ only: "unshare" });
  test.if(linux)("a setup failure is reported as a refusal and the command never runs", async () => {
    if (!(await backend.detect())) return; // nothing to verify on this host
    const marker = join(tmpdir(), `xr-ran-${process.pid}-${Date.now()}`);
    // A writable root of "/" leaves no staging mountpoint → setup fails.
    const r = await sh(backend, "/", `touch ${JSON.stringify(marker)}`, ["/"]);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/reserved mount root|filesystem confinement could not be established/);
    expect(existsSync(marker)).toBe(false);
  });
});
