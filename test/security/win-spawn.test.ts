/**
 * Windows batch-shim spawning (Bun ≥ 1.4 refuses `.cmd`/`.bat` without a
 * shell — CVE-2024-27980). Platform, PATH and the filesystem are injected, so
 * the Windows decisions are exercised on every OS.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveWindowsCommand, shimSafe } from "../../src/util/win-spawn.ts";

const NPM_DIR = "C:\\nodejs";
const BUN_DIR = "C:\\bun\\bin";
// Windows filesystems are case-insensitive (PATHEXT yields `npm.CMD` for npm.cmd).
const files = new Set([join(NPM_DIR, "npm.cmd"), join(NPM_DIR, "npx.cmd"), join(NPM_DIR, "node.exe"), join(BUN_DIR, "bun.exe"), join(BUN_DIR, "xr.CMD")].map((f) => f.toLowerCase()));
const exists = (p: string) => files.has(p.toLowerCase());
const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
const env = { PATH: `${BUN_DIR};${NPM_DIR}`, PATHEXT: ".COM;.EXE;.BAT;.CMD", ComSpec: "C:\\Windows\\system32\\cmd.exe" };

describe("Windows batch shims run through an explicit cmd.exe, never a bare spawn", () => {
  test("non-Windows hosts are untouched", () => {
    expect(shimSafe("npm", ["install", "-g", "@rrrtx/xr@1.2.3"], env, "linux", exists)).toEqual(["npm", ["install", "-g", "@rrrtx/xr@1.2.3"], {}]);
  });

  test("PATHEXT order resolves bare names; real .exe targets are untouched", () => {
    expect(lc(resolveWindowsCommand("npm", env, exists))).toBe(lc(join(NPM_DIR, "npm.cmd")));
    expect(lc(resolveWindowsCommand("bun", env, exists))).toBe(lc(join(BUN_DIR, "bun.exe")));
    expect(resolveWindowsCommand("nope", env, exists)).toBeNull();
    expect(shimSafe("bun", ["--version"], env, "win32", exists)).toEqual(["bun", ["--version"], {}]);
    expect(shimSafe("node.exe", ["-v"], env, "win32", exists)).toEqual(["node.exe", ["-v"], {}]);
  });

  test("npm / npx / xr shims → cmd.exe /d /s /c with one quoted, verbatim line", () => {
    const [cmd, args, opts] = shimSafe("npm", ["install", "-g", "@rrrtx/xr@1.2.3"], env, "win32", exists);
    expect(cmd).toBe(env.ComSpec);
    expect(args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(lc(args[3])).toBe(lc(`"${join(NPM_DIR, "npm.cmd")} install -g @rrrtx/xr@1.2.3"`));
    expect(opts).toEqual({ windowsVerbatimArguments: true });
    expect(lc(shimSafe("npx", ["-y", "@modelcontextprotocol/server-everything"], env, "win32", exists)[1][3])).toContain("npx.cmd -y @modelcontextprotocol/server-everything");
    expect(lc(shimSafe("xr", ["--version"], env, "win32", exists)[1][3])).toBe(lc(`"${join(BUN_DIR, "xr.CMD")} --version"`));
  });

  test("arguments with spaces are quoted; empty arguments survive", () => {
    const line = shimSafe("C:\\Program Files\\nodejs\\npm.cmd", ["run", "my script", ""], env, "win32", exists)[1][3];
    expect(line).toBe(`""C:\\Program Files\\nodejs\\npm.cmd" run "my script" """`);
  });

  test("cmd.exe metacharacters are refused, not escaped", () => {
    for (const bad of ["a&calc", "x|y", "<in", ">out", "%PATH%", "q\"uote", "^", "!x!", "line\nbreak"]) {
      expect(() => shimSafe("npm", ["install", bad], env, "win32", exists)).toThrow(/refusing to pass/);
    }
  });
});
