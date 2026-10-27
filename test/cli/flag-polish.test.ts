/**
 * XR-LAUNCH-028 — CLI argument-handling polish (contract tests).
 *
 *   · usage errors go to stderr only: nothing on stdout (Bun sends a zero-arg
 *     console.error()/console.warn() to STDOUT, which polluted scripts);
 *   · commands marked `strictFlags` reject undeclared options, values on their
 *     boolean options and an undeclared global --dry-run, before the kernel boots;
 *   · the global --dry-run reaches the commands that honour it;
 *   · `xr uninstall --dry-run` previews and removes nothing, even with --yes;
 *   · an unknown `--x=y` after the command is kept (it used to vanish).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGlobalFlags } from "../../src/cli/flags.ts";
import { assertStrictFlags, reinjectGlobalFlags } from "../../src/cli/router.ts";
import { CATALOG, getCatalogEntry, resolveCommandName } from "../../src/cli/catalog.ts";

const ROOT = join(import.meta.dir, "..", "..");
const ENTRY = join(ROOT, "src", "index.ts");

function xr(args: string[], home: string) {
  const r = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: home,
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: process.env.TMPDIR ?? tmpdir(), NO_COLOR: "1", XR_SECRET_BACKEND: "file" },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function withHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "xr-028-"));
  try {
    return fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("XR-LAUNCH-028 usage errors: stderr only, exit 2", () => {
  test("no zero-argument console.error()/console.warn() anywhere in src/ (Bun routes them to stdout)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && /console\.(error|warn)\(\s*\)/.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });

  for (const argv of [["--bogus"], ["serve", "--badflag"], ["doctor", "--frobnicate"], ["health", "--zzz"], ["update", "--nope"], ["update", "--check=1"], ["status", "--dry-run"], ["repair", "--purge"], ["uninstall", "--force"]]) {
    test(`xr ${argv.join(" ")} → exit 2, empty stdout, the reason on stderr`, () =>
      withHome((home) => {
        const r = xr(argv, home);
        expect(r.code).toBe(2);
        expect(r.stdout).toBe("");
        expect(r.stderr).toMatch(/unknown option|takes no value|has no --dry-run/);
      }));
  }

  test("strict errors name the command's own usage line", () =>
    withHome((home) => {
      const r = xr(["doctor", "--frobnicate"], home);
      expect(r.stderr).toContain("unknown option for doctor: --frobnicate");
      expect(r.stderr).toContain("Usage: xr doctor [--deep] [--network] [--perf] [--json]");
    }));
});

describe("XR-LAUNCH-028 strict command flags (unit)", () => {
  const doctor = getCatalogEntry("doctor")!;
  const check = (argv: string[]) => {
    const flags = parseGlobalFlags(argv);
    return () => assertStrictFlags(doctor, flags.args.slice(1), flags);
  };

  test("declared options and global flags pass", () => {
    expect(check(["doctor", "--deep", "--network", "--json", "--yes"])).not.toThrow();
  });

  test("undeclared options, values on boolean options and an undeclared --dry-run are refused", () => {
    expect(check(["doctor", "--frobnicate"])).toThrow(/unknown option for doctor: --frobnicate/);
    expect(check(["doctor", "--deep=1"])).toThrow(/--deep takes no value/);
    expect(check(["doctor", "--dry-run"])).toThrow(/has no --dry-run/);
  });

  test("tokens after `--` are not options", () => {
    expect(check(["doctor", "--", "--weird"])).not.toThrow();
  });

  test("every strict entry declares its flags and its usage mentions each one", () => {
    const strict = CATALOG.filter((e) => e.strictFlags);
    expect(strict.map((e) => e.name).sort()).toEqual(["doctor", "repair", "status", "uninstall", "update"]);
    for (const e of strict) {
      expect(e.flags?.length, e.name).toBeGreaterThan(0);
      for (const f of e.flags ?? []) expect(e.usage, `${e.name} usage lists ${f}`).toContain(f);
    }
  });

  test("every command name and alias resolves to command help", () => {
    for (const e of CATALOG) {
      expect(resolveCommandName(e.name), e.name).toBeTruthy();
      for (const a of e.aliases ?? []) expect(resolveCommandName(a), `${e.name} alias ${a}`).toBeTruthy();
    }
  });
});

describe("coding-first help without removing shared engine commands", () => {
  test("default help focuses on coding; legacy discovery and serve remain available", () =>
    withHome((home) => {
      const focused = xr(["--help"], home);
      expect(focused.code).toBe(0);
      expect(focused.stdout).toContain("coding agent");
      expect(focused.stdout).toContain('xr "');
      expect(focused.stdout).toContain("--provider");
      expect(focused.stdout).toContain("--dry-run");
      expect(focused.stdout).toContain("xr help --all");
      expect(focused.stdout).not.toContain("xr research");
      expect(focused.stdout).not.toContain("xr serve");
      const all = xr(["help", "--all"], home);
      expect(all.code).toBe(0);
      expect(all.stdout).toContain("xr research");
      expect(all.stdout).toContain("xr serve");
      const serve = xr(["serve", "--help"], home);
      expect(serve.code).toBe(0);
      expect(serve.stdout).toContain("xr serve");
      // Existing machine consumers still receive the full command catalog.
      const json = xr(["--json", "--help"], home);
      expect(json.code).toBe(0);
      const data = JSON.parse(json.stdout) as { commands: Array<{ name: string }> };
      expect(data.commands.some((c) => c.name === "serve")).toBe(true);
      expect(data.commands.some((c) => c.name === "research")).toBe(true);
    }));
});

describe("honest CLI budget guidance", () => {
  test("real run help describes the USD limit as estimated, not a hard spend cap", () =>
    withHome((home) => {
      const r = xr(["run", "--help"], home);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("estimated per-task USD limit");
      expect(r.stdout.toLowerCase()).not.toContain("hard spend cap");
      const budget = xr(["help", "budget"], home);
      expect(budget.code).toBe(0);
      expect(budget.stdout).toContain("can overshoot");
      expect(budget.stdout).toContain("unknown pricing");
    }));
});

describe("XR-LAUNCH-028 no dropped flags", () => {
  test("the global --dry-run is re-attached for commands that read it from their args", () => {
    const flags = parseGlobalFlags(["memory", "summarize", "--dry-run", "--yes"]);
    expect(flags.args).toEqual(["memory", "summarize"]);
    const args = reinjectGlobalFlags(flags.args.slice(1), flags);
    expect(args).toContain("--dry-run");
    expect(args).toContain("--yes");
  });

  test("an unknown --x=y after the command is kept for the command", () => {
    expect(parseGlobalFlags(["skill", "--foo=bar"]).args).toEqual(["skill", "--foo=bar"]);
  });

  test("`--` is recorded so command-side checks can stop there", () => {
    const f = parseGlobalFlags(["doctor", "--", "--x"]);
    expect(f.args).toEqual(["doctor", "--x"]);
    expect(f.endOfOptions).toBe(1);
  });
});

describe("XR-LAUNCH-028 xr uninstall --dry-run", () => {
  test("previews and removes nothing, even with --yes and --purge", () =>
    withHome((home) => {
      const launcher = join(home, ".local", "bin", "xr");
      const installDir = join(home, ".xr-agent");
      const dataHome = join(home, ".xr");
      mkdirSync(join(home, ".local", "bin"), { recursive: true });
      writeFileSync(launcher, "#!/bin/sh\n");
      mkdirSync(installDir, { recursive: true });
      mkdirSync(dataHome, { recursive: true });
      writeFileSync(join(dataHome, "config.json"), "{}\n");

      const r = xr(["uninstall", "--purge", "--dry-run", "--yes"], home);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain(`Launcher:   ${launcher}`);
      expect(r.stdout).toContain("PURGE");
      expect(r.stdout).toContain("Dry run: nothing was removed.");
      expect(r.stdout).not.toContain("Uninstall complete");
      expect(existsSync(launcher)).toBe(true);
      expect(existsSync(installDir)).toBe(true);
      expect(existsSync(join(dataHome, "config.json"))).toBe(true);
    }));
});
