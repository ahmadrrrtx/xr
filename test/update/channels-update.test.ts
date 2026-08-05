/**
 * XR Phase 9 · T5 — per-channel atomic update/rollback/uninstall tests.
 * Every test asserts an EFFECT: which command would run, that a forced
 * canary failure dispatches the rollback to the previous version, and that
 * the binary download path fails closed without valid checksums (Part 20).
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  detectChannel,
  createChannelUpdatePlan,
  downloadVerified,
  parseSums,
  type ChannelInfo,
} from "../../src/update/channels.ts";
import { applyUpdate } from "../../src/update/selfheal.ts";

function channel(partial: Partial<ChannelInfo>): ChannelInfo {
  return {
    channel: "homebrew",
    detail: "test channel",
    managed: true,
    upgrade: ["brew", "upgrade", "xr"],
    rollback: (v: string) => ["brew", "install", `xr@${v}`],
    rollbackNote: "note",
    uninstall: ["brew", "uninstall", "xr"],
    ...partial,
  };
}

describe("Phase 9 · T5 — channel detection", () => {
  test("Homebrew Cellar binary resolves to the brew channel with real commands", () => {
    const info = detectChannel({
      platform: "darwin",
      exePath: "/opt/homebrew/Cellar/xr/7.1.0/bin/xr",
      isBrewInstalled: () => true,
    });
    expect(info.channel).toBe("homebrew");
    expect(info.managed).toBe(true);
    expect(info.upgrade).toEqual(["brew", "upgrade", "xr"]);
    expect(info.rollback!("7.0.1")).toEqual(["brew", "install", "xr@7.0.1"]);
  });

  test("Scoop layout detects on Windows with per-version rollback", () => {
    const info = detectChannel({
      platform: "win32",
      exePath: "C:\\Users\\u\\scoop\\apps\\xr\\current\\xr.exe",
      home: "C:\\Users\\u",
    });
    expect(info.channel).toBe("scoop");
    expect(info.upgrade).toEqual(["scoop", "update", "xr"]);
    expect(info.rollback!("7.0.1")).toEqual(["scoop", "install", "xr@7.0.1"]);
  });

  test("WinGet portable layout detects on Windows", () => {
    const info = detectChannel({
      platform: "win32",
      exePath: "C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Packages\\ahmadrrrtx.XR_Microsoft\\xr.exe",
      home: "C:\\Users\\u",
    });
    expect(info.channel).toBe("winget");
    expect(info.managed).toBe(true);
  });

  test("dpkg-owned /usr/bin/xr resolves to apt with pinned downgrade", () => {
    const info = detectChannel({ platform: "linux", exePath: "/usr/bin/xr" });
    expect(info.channel).toBe("apt");
    expect(info.rollback!("7.0.1")).toEqual(["apt-get", "install", "-y", "--allow-downgrades", "xr=7.0.1"]);
  });

  test("unknown layout stays unknown (fail closed, never guess)", () => {
    const info = detectChannel({ platform: "linux", exePath: "/home/u/.bun/bin/bun" });
    expect(info.channel).toBe("unknown");
    expect(info.managed).toBe(false);
  });
});

describe("Phase 9 · T5 — atomic update + forced-failure rollback per channel", () => {
  test("healthy upgrade: manager command runs, canary passes, update activates", async () => {
    const commands: string[][] = [];
    const plan = createChannelUpdatePlan({
      info: channel({}),
      currentVersion: "7.0.1",
      targetVersion: "7.1.0",
      run: (cmd) => {
        commands.push(cmd);
        return { ok: true };
      },
      canary: () => ({ healthy: true }),
    });
    const result = await applyUpdate(plan);
    expect(result.ok).toBe(true);
    expect(commands).toEqual([["brew", "upgrade", "xr"]]);
    expect(JSON.stringify(commands)).not.toContain("xr@7.0.1"); // no rollback dispatched
  });

  test("forced canary failure: rollback to the PREVIOUS version is dispatched (Art. XXIII)", async () => {
    const commands: string[][] = [];
    let canaryCalls = 0;
    const plan = createChannelUpdatePlan({
      info: channel({}),
      currentVersion: "7.0.1",
      run: (cmd) => {
        commands.push(cmd);
        return { ok: true };
      },
      canary: () => {
        canaryCalls++;
        return { healthy: false, reason: "forced failure" };
      },
    });
    const result = await applyUpdate(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("self-test failed");
      expect(result.keptCurrent).toBe("7.0.1");
    }
    expect(commands).toContainEqual(["brew", "install", "xr@7.0.1"]);
    expect(canaryCalls).toBeGreaterThan(0);
  });

  test("upgrade command failure: nothing rolled back, current kept with the reason", async () => {
    const commands: string[][] = [];
    const plan = createChannelUpdatePlan({
      info: channel({}),
      currentVersion: "7.0.1",
      run: (cmd) => {
        commands.push(cmd);
        return { ok: false, error: "network down" };
      },
      canary: () => ({ healthy: true }),
    });
    const result = await applyUpdate(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("network down");
    expect(commands).toEqual([["brew", "upgrade", "xr"]]);
  });

  test("scoop rollback pins a version (update + rollback green per channel family)", async () => {
    const commands: string[][] = [];
    const plan = createChannelUpdatePlan({
      info: channel({
        channel: "scoop",
        upgrade: ["scoop", "update", "xr"],
        rollback: (v) => ["scoop", "install", `xr@${v}`],
      }),
      currentVersion: "7.0.1",
      run: (cmd) => {
        commands.push(cmd);
        return { ok: true };
      },
      canary: () => ({ healthy: false }),
    });
    await applyUpdate(plan);
    expect(commands).toContainEqual(["scoop", "install", "xr@7.0.1"]);
  });
});

describe("Phase 9 · Part 20 — verified-only binary downloads", () => {
  const binary = new TextEncoder().encode("fake canonical binary bytes");
  const sha = createHash("sha256").update(binary).digest("hex");
  const sums = `${sha}  xr-linux-x64\n`;

  function fetchFor(map: Record<string, { status: number; body: Uint8Array | string }>): typeof fetch {
    return (async (url: unknown) => {
      const u = String(url);
      const hit = map[u];
      if (!hit) return new Response("not found", { status: 404 });
      return new Response(hit.body, { status: hit.status });
    }) as unknown as typeof fetch;
  }

  test("valid sums + matching artifact: installs the verified bytes", async () => {
    let written: Uint8Array | null = null;
    const result = await downloadVerified(
      {
        url: "https://example.test/v7.1.0/xr-linux-x64",
        sumsUrl: "https://example.test/v7.1.0/SHA256SUMS",
        expectedFile: "xr-linux-x64",
        fetchImpl: fetchFor({
          "https://example.test/v7.1.0/SHA256SUMS": { status: 200, body: sums },
          "https://example.test/v7.1.0/xr-linux-x64": { status: 200, body: binary },
        }),
      },
      async (b) => {
        written = b;
      },
    );
    expect(result.sha256).toBe(sha);
    expect(Buffer.from(written!).toString()).toBe(Buffer.from(binary).toString());
  });

  test("checksum mismatch refuses to write anything (fail closed)", async () => {
    let written = false;
    await expect(
      downloadVerified(
        {
          url: "u",
          sumsUrl: "s",
          expectedFile: "xr-linux-x64",
          fetchImpl: fetchFor({
            s: { status: 200, body: sums },
            u: { status: 200, body: new TextEncoder().encode("tampered bytes") },
          }),
        },
        async () => {
          written = true;
        },
      ),
    ).rejects.toThrow(/Integrity check failed/);
    expect(written).toBe(false);
  });

  test("missing sums refuses the download entirely (no unsigned window)", async () => {
    await expect(
      downloadVerified(
        { url: "u", sumsUrl: "s", expectedFile: "xr-linux-x64", fetchImpl: fetchFor({ s: { status: 404, body: "nope" } }) },
        async () => {},
      ),
    ).rejects.toThrow(/checksums unavailable/);
  });

  test("an artifact absent from the sums is refused even when downloadable", async () => {
    await expect(
      downloadVerified(
        {
          url: "u",
          sumsUrl: "s",
          expectedFile: "xr-linux-arm64",
          fetchImpl: fetchFor({
            s: { status: 200, body: sums },
            u: { status: 200, body: binary },
          }),
        },
        async () => {},
      ),
    ).rejects.toThrow(/no entry|No entry|checksums contain no entry/i);
  });

  test("sums parser round-trips sha256sum native format", () => {
    const parsed = parseSums(sums);
    expect(parsed.get("xr-linux-x64")).toBe(sha);
  });
});

describe("Phase 9 · T5 — channel-aware uninstall effects", () => {
  test("channel-managed uninstall dispatches the manager command and reports it", async () => {
    const { performUninstall } = await import("../../src/install/uninstall.ts");
    const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const home = mkdtempSync(join(tmpdir(), "xr-chan-uninst-"));
    try {
      const paths = {
        installDir: join(home, "pkg"),
        dataHome: join(home, "data"),
        launcher: join(home, ".local", "bin", "xr"),
        rcFiles: [] as string[],
      };
      mkdirSync(paths.installDir, { recursive: true });
      mkdirSync(paths.dataHome, { recursive: true });
      mkdirSync(join(paths.launcher, ".."), { recursive: true });
      writeFileSync(paths.launcher, "# launcher");
      writeFileSync(join(paths.dataHome, "config.json"), "{}");

      const commands: string[][] = [];
      const summary = performUninstall(
        {
          mode: "keep-data",
          yes: true,
          packageRoot: join(home, "elsewhere"),
          channel: { channel: "homebrew", managed: true, uninstall: ["brew", "uninstall", "xr"] },
          run: (cmd) => {
            commands.push(cmd);
            return { ok: true };
          },
        },
        paths,
      );
      expect(summary.channel).toBe("homebrew");
      expect(summary.channelRemoved).toBe(true);
      expect(commands).toEqual([["brew", "uninstall", "xr"]]);
      expect(summary.launcherRemoved).toBe(true);
      expect(existsSync(paths.launcher)).toBe(false);
      // keep-data preserves the data home
      expect(existsSync(join(paths.dataHome, "config.json"))).toBe(true);
      expect(summary.dataHomeRemoved).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("non-managed installs keep the Phase-1 uninstall behavior (channel fields null)", async () => {
    const { performUninstall } = await import("../../src/install/uninstall.ts");
    const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const home = mkdtempSync(join(tmpdir(), "xr-plain-uninst-"));
    try {
      const paths = {
        installDir: join(home, "pkg"),
        dataHome: join(home, "data"),
        launcher: join(home, ".local", "bin", "xr"),
        rcFiles: [] as string[],
      };
      mkdirSync(paths.installDir, { recursive: true });
      mkdirSync(paths.dataHome, { recursive: true });
      const summary = performUninstall(
        { mode: "purge", yes: true, packageRoot: join(home, "elsewhere") },
        paths,
      );
      expect(summary.channel).toBeNull();
      expect(summary.channelRemoved).toBe(false);
      expect(summary.channelCommand).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
