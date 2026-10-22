/**
 * XR-LAUNCH-031 — the shell secret-path heuristic splits commands into words
 * before deciding (src/security/shell-words.ts → guard.ts checkAction).
 *
 * Before: the whole command string was resolved as ONE path, so the reason
 * read "secret/credential path (<cwd>/cat /tmp/…/secret.txt)", and raw regexes
 * over the JSON both over-blocked (`git commit -m "….env…"`, `grep box-shadow`,
 * `cat .env.example`) and under-blocked (`cat ~/.n''etrc`).
 * After: per-word canonical checks. Still ADVISORY — the sandbox is the
 * boundary — and the last block pins the documented limits.
 */

import { describe, expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { checkAction } from "../../src/security/guard.ts";
import { shellPathCandidates, shellWords } from "../../src/security/shell-words.ts";

const POLICY = { egressAllowlist: [], requireApproval: ["shell"] };
const shell = (cmd: string, cwd?: string) => checkAction({ tool: "shell", args: { cmd } }, { ...POLICY, ...(cwd ? { cwd } : {}) });
const texts = (cmd: string) => shellWords(cmd).map((w) => w.text);

describe("shellWords — quote removal and operators, no expansion", () => {
  test("quotes and escapes are removed the way a shell removes them", () => {
    expect(texts(`cat ~/.n''etrc`)).toEqual(["cat", "~/.netrc"]);
    expect(texts(`cat ~/.s""sh/config`)).toEqual(["cat", "~/.ssh/config"]);
    expect(texts(String.raw`cat ~/.a\ws/config`)).toEqual(["cat", "~/.aws/config"]);
    expect(texts(`git commit -m 'rotate the .env loader'`)).toEqual(["git", "commit", "-m", "rotate the .env loader"]);
    expect(texts(String.raw`echo "a \"b\" \$c"`)).toEqual(["echo", 'a "b" $c']);
    expect(texts(`echo ''`)).toEqual(["echo", ""]);
  });

  test("operators and redirects split words; comments are dropped", () => {
    expect(texts("echo hi>~/.npmrc")).toEqual(["echo", "hi", "~/.npmrc"]);
    expect(texts("a|b&&c;d 2>err.log <in (e)")).toEqual(["a", "b", "c", "d", "2", "err.log", "in", "e"]);
    expect(texts("ls # cat ~/.netrc\npwd")).toEqual(["ls", "pwd"]);
    expect(texts("echo a#b")).toEqual(["echo", "a#b"]);
  });

  test("expansions and globs are marked dynamic (checked as written, never evaluated)", () => {
    const w = shellWords(`cat $HOME/.netrc "x$(id)" ~/.ne* plain`);
    expect(w.map((x) => x.dynamic)).toEqual([false, true, true, true, false]);
  });

  test("candidates include NAME=value, --flag=value and curl-style @file", () => {
    expect(shellPathCandidates("KEY=~/.aws/credentials run --config=~/.kube/config curl -d @~/.netrc")).toEqual([
      "KEY=~/.aws/credentials", "~/.aws/credentials", "run", "--config=~/.kube/config", "~/.kube/config", "curl", "-d", "@~/.netrc", "~/.netrc",
    ]);
  });
});

describe("checkAction(shell) — per-word secret-path decisions", () => {
  test("the reason names the actual file, not `<cwd>/cat …`", () => {
    const d = shell("cat /tmp/xr-031/secret.txt");
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toContain("secret/credential path (/tmp/xr-031/secret.txt)");
      expect(d.reason).not.toContain("cat ");
    }
    expect(shell("cat /tmp/xr-031/notes.txt").allowed).toBe(true);
  });

  test("false positives are gone: prose inside quotes, box-shadow, .env.example", () => {
    for (const cmd of [
      `git commit -m 'rotate the .env loader'`,
      "grep -r box-shadow src",
      "cat .env.example",
      "cp .env.template .env.example",
      "echo shadow",
    ]) expect(shell(cmd), cmd).toEqual({ allowed: true });
  });

  test("quote/escape splitting no longer hides a secret path", () => {
    for (const cmd of [`cat ~/.n''etrc`, `cat ~/.s""sh/config`, String.raw`cat ~/.a\ws/config`, "echo hi > ~/.npmrc", "X=1 cat ~/.git-credentials"]) {
      const d = shell(cmd);
      expect(d.allowed, cmd).toBe(false);
      if (!d.allowed) expect(d.reason).toContain(homedir());
    }
  });

  test("bare names resolve against the command's working directory", () => {
    const cwd = join(tmpdir(), "xr-031-proj");
    const d = shell("cat id_ed25519 | base64", cwd);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toContain(join(cwd, "id_ed25519"));
    expect(shell("source .env && npm start", cwd).allowed).toBe(false);
    expect(shell("sudo cat /etc/shadow").allowed).toBe(false);
  });

  test("dynamic words are still checked on their literal suffix", () => {
    expect(shell("cat $HOME/.netrc").allowed).toBe(false);
    expect(shell(`tar czf out.tgz "$HOME/.aws/credentials"`).allowed).toBe(false);
  });

  test("the denial keeps the stable tool-reason mapping (denied:secret-path)", async () => {
    const { guardDenialReason } = await import("../../src/core/tool-reasons.ts");
    const d = shell(`cat ~/.n''etrc`);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(guardDenialReason(d.reason)).toBe("denied:secret-path");
  });

  test("ADVISORY (documented limit): a computed path is invisible to a static check — the sandbox is the boundary", () => {
    expect(shell("cat ~/.ne*").allowed).toBe(true);
    expect(shell(`cat "$(printf '%s' ~/.ne)trc"`).allowed).toBe(true);
  });
});

describe("checkAction(non-shell) — free-text behaviour is unchanged apart from .env templates", () => {
  test("paths and key names in free text are still refused", () => {
    expect(checkAction({ tool: "write_file", args: { path: "a.md", content: "see ~/.ssh/id_rsa" } }, POLICY).allowed).toBe(false);
    expect(checkAction({ tool: "http", args: { body: "x id_ed25519 y" } }, POLICY).allowed).toBe(false);
  });
  test(".env.example in free text is documentation, not a secret", () => {
    expect(checkAction({ tool: "write_file", args: { path: "README.md", content: "copy .env.example first" } }, POLICY)).toEqual({ allowed: true });
  });
});
