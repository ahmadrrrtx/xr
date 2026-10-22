/**
 * Launch audit XR-LAUNCH-006 — uninstall must remove ONLY the PATH block XR
 * wrote. Fixture rc files (Ubuntu's default ~/.profile, a .bashrc and a
 * .zshrc with unrelated PATH lines) must be byte-identical after
 * install → uninstall.
 *
 * The "install" step executes the exact printf line from install.sh (no
 * re-typed copy), so installer and uninstaller cannot drift apart.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LEGACY_RC_BLOCK,
  performUninstall,
  RC_BLOCK,
  RC_BLOCK_BEGIN,
  RC_BLOCK_END,
  resolveUninstallPaths,
  stripXrRcBlock,
} from "../../src/install/uninstall.ts";

const ROOT = join(import.meta.dir, "..", "..");
const INSTALL_SH = readFileSync(join(ROOT, "install.sh"), "utf8");

// Ubuntu 22.04/24.04 /etc/skel/.profile, verbatim.
const UBUNTU_PROFILE = `# ~/.profile: executed by the command interpreter for login shells.
# This file is not read by bash(1), if ~/.bash_profile or ~/.bash_login
# exists.
# see /usr/share/doc/bash/examples/startup-files for examples.
# the files are located in the bash-doc package.

# the default umask is set in /etc/profile; for setting the umask
# for ssh logins, install and configure the libpam-umask package.
#umask 022

# if running bash
if [ -n "$BASH_VERSION" ]; then
    # include .bashrc if it exists
    if [ -f "$HOME/.bashrc" ]; then
	. "$HOME/.bashrc"
    fi
fi

# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/bin" ] ; then
    PATH="$HOME/bin:$PATH"
fi

# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/.local/bin" ] ; then
    PATH="$HOME/.local/bin:$PATH"
fi
`;
const BASHRC = `# ~/.bashrc
export PATH="$HOME/.local/bin:$PATH"   # my own line, not XR's
export PATH="$HOME/.cargo/bin:$PATH"
alias ll='ls -alF'
`;
const ZSHRC = `# zsh
path=($HOME/.local/bin $path)
export PATH="$HOME/.local/bin:$PATH"
# XR launcher is great, says this unrelated comment
source ~/.zsh_plugins`;

const sh = Bun.which("bash");
const posix = process.platform !== "win32" && sh !== null;

/** Run install.sh's real rc-append printf against `rc`. */
function installerAppend(rc: string) {
  const line = INSTALL_SH.split("\n").find((l) => l.includes("printf '\\n# >>> XR launcher >>>"));
  if (!line) throw new Error("install.sh no longer contains the marker-block printf");
  const r = Bun.spawnSync([sh!, "-c", `rc=${JSON.stringify(rc)}; ${line.trim()}`]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
}

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "xr-rc-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function uninstall() {
  const paths = resolveUninstallPaths({ HOME: home });
  return performUninstall({ mode: "keep-data", yes: true, packageRoot: "/nonexistent" }, paths);
}

describe("XR-LAUNCH-006 · uninstall leaves unrelated rc content byte-identical", () => {
  test("the installer's block is exactly RC_BLOCK (installer and uninstaller agree)", () => {
    if (!posix) return;
    const rc = join(home, "probe");
    writeFileSync(rc, "");
    installerAppend(rc);
    expect(readFileSync(rc, "utf8")).toBe(RC_BLOCK);
  });

  const fixtures: Array<[string, string]> = [
    [".profile", UBUNTU_PROFILE],
    [".bashrc", BASHRC],
    [".zshrc", ZSHRC],
  ];

  for (const [name, original] of fixtures) {
    test(`${name}: install → uninstall is byte-identical (current marker block)`, () => {
      if (!posix) return;
      const rc = join(home, name);
      writeFileSync(rc, original);
      installerAppend(rc);
      expect(readFileSync(rc, "utf8")).toContain(RC_BLOCK_BEGIN);
      const s = uninstall();
      expect(readFileSync(rc, "utf8")).toBe(original);
      expect(s.rcFilesTouched).toContain(rc);
    });

    test(`${name}: a block written by an older installer is removed byte-exactly`, () => {
      const rc = join(home, name);
      writeFileSync(rc, original + LEGACY_RC_BLOCK);
      uninstall();
      expect(readFileSync(rc, "utf8")).toBe(original);
    });

    test(`${name}: with no XR block, uninstall does not touch the file`, () => {
      const rc = join(home, name);
      writeFileSync(rc, original);
      const s = uninstall();
      expect(readFileSync(rc, "utf8")).toBe(original);
      expect(s.rcFilesTouched).not.toContain(rc);
    });
  }

  test("Ubuntu's ~/.profile keeps its `.local/bin` if-block (the old uninstaller left a syntax error)", () => {
    const rc = join(home, ".profile");
    writeFileSync(rc, UBUNTU_PROFILE + LEGACY_RC_BLOCK);
    uninstall();
    const after = readFileSync(rc, "utf8");
    expect(after).toContain('    PATH="$HOME/.local/bin:$PATH"\nfi\n');
    if (posix) {
      const r = Bun.spawnSync([sh!, "-n", rc]);
      expect(r.exitCode).toBe(0);
    }
  });

  test("a marker block the user edited is removed from BEGIN to END only", () => {
    const before = "a=1\n";
    const edited = `${before}\n${RC_BLOCK_BEGIN}\nexport PATH="$HOME/.local/bin:$PATH:/opt/x"\n${RC_BLOCK_END}\nb=2\n`;
    expect(stripXrRcBlock(edited)).toBe(`${before}b=2\n`);
  });

  test("an unterminated marker is left alone (never guess what to delete)", () => {
    const content = `x\n${RC_BLOCK_BEGIN}\nexport PATH=/y\n`;
    expect(stripXrRcBlock(content)).toBe(content);
  });

  test("a file that did not end with a newline is restored exactly", () => {
    if (!posix) return;
    const rc = join(home, ".zshrc");
    writeFileSync(rc, "no-trailing-newline");
    installerAppend(rc);
    uninstall();
    expect(readFileSync(rc, "utf8")).toBe("no-trailing-newline");
  });

  test("CRLF rc files are handled byte-exactly", () => {
    const original = "line1\r\nline2\r\n";
    const crlfBlock = RC_BLOCK.replace(/\n/g, "\r\n");
    expect(stripXrRcBlock(original + crlfBlock)).toBe(original);
  });

  test("the installer only appends when no XR block exists (re-install never stacks blocks)", () => {
    if (!posix) return;
    const rc = join(home, ".bashrc");
    mkdirSync(home, { recursive: true });
    writeFileSync(rc, BASHRC);
    expect(INSTALL_SH).toContain('if ! grep -q "XR launcher" "$rc"');
    // Simulate the installer's guard around its own append, twice.
    for (let i = 0; i < 2; i++) {
      if (!readFileSync(rc, "utf8").includes("XR launcher")) installerAppend(rc);
    }
    expect(readFileSync(rc, "utf8").split(RC_BLOCK_BEGIN).length - 1).toBe(1);
    uninstall();
    expect(readFileSync(rc, "utf8")).toBe(BASHRC);
  });
});

describe("XR-LAUNCH-006 · the interactive confirmation can actually say yes", () => {
  test("confirm() pipes the child's stdout (inherit made every answer empty → 'Cancelled.')", () => {
    const src = readFileSync(join(ROOT, "src", "install", "uninstall.ts"), "utf8");
    expect(src).toContain('stdio: ["inherit", "pipe", "inherit"]');
    expect(src).not.toMatch(/stdio: "inherit", encoding: "utf8"/);
  });
});
