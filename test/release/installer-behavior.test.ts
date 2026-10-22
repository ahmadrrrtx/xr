/**
 * Launch audit XR-LAUNCH-002 — install.sh BEHAVIOUR, not just its text.
 *
 * Runs the real install.sh against a fake GitHub Releases (a `curl` shim that
 * serves fixture files and 404s everything else) in a throwaway HOME, and
 * asserts the acceptance criteria of Phase 1:
 *   - a missing release exits non-zero, creates nothing, and never falls back
 *     to an unpinned branch;
 *   - the pinned version installs, verified against SHA256SUMS;
 *   - a checksum mismatch is fatal (no silent fallback);
 *   - a foreign directory is never overwritten; an older installer's leftover
 *     dist/ is accepted;
 *   - --version pins / rejects; --from-source installs the same release's
 *     verified source archive;
 *   - `curl | bash` without a terminal declines with a clear --yes hint
 *     instead of hanging.
 * POSIX only (bash + coreutils); Windows is covered by installer-powershell.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const INSTALL_SH = join(ROOT, "install.sh");
const PINNED = (JSON.parse(readFileSync(join(ROOT, "release.manifest.json"), "utf8")) as {
  identity: { version: string };
  channels?: { publicVersion?: string };
}).channels?.publicVersion ?? "";
const BINARIES = ["xr-linux-x64", "xr-linux-arm64", "xr-darwin-x64", "xr-darwin-arm64"];

const posix = process.platform !== "win32" && Bun.which("bash") !== null && Bun.which("tar") !== null;
const d = posix ? describe : describe.skip;

let work = "";
let home = "";
let shims = "";
let fixtures = "";
let curlLog = "";
let fakeLog = "";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function writeExec(path: string, body: string) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

/** Publish a fake release v<version> with every binary + a source archive. */
function publishRelease(version: string, opts: { tamper?: string; omitFromSums?: string[] } = {}) {
  const dir = join(fixtures, `v${version}`);
  mkdirSync(dir, { recursive: true });
  for (const b of BINARIES) {
    writeExec(
      join(dir, b),
      `#!/bin/sh\ncase "$1" in\n  --version) echo "xr ${version}" ;;\n  *) echo "binary $*" >> "$XR_FAKE_LOG" ;;\nesac\nexit 0\n`,
    );
  }
  const src = join(work, `src-${version}`);
  mkdirSync(join(src, "src"), { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "@rrrtx/xr", version }, null, 2));
  writeFileSync(join(src, "src", "index.ts"), `console.log("xr ${version}");\n`);
  writeFileSync(join(src, "bun.lock"), "{}\n");
  const tar = Bun.spawnSync(["tar", "-czf", join(dir, "xr-source.tar.gz"), "-C", src, "."]);
  if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`);

  const names = [...BINARIES, "xr-source.tar.gz"].filter((n) => !opts.omitFromSums?.includes(n));
  const lines = names.map((n) => `${sha256(join(dir, n))}  ${n}`);
  writeFileSync(join(dir, "SHA256SUMS"), lines.join("\n") + "\n");
  // Tamper AFTER the sums were written: the published hash no longer matches.
  if (opts.tamper) writeFileSync(join(dir, opts.tamper), "#!/bin/sh\necho evil\n", { mode: 0o755 });
}

function run(args: string[], opts: { env?: Record<string, string>; noTerminal?: boolean } = {}) {
  const env: Record<string, string> = {
    HOME: home,
    PATH: `${shims}:/usr/bin:/bin:/usr/sbin:/sbin`,
    TMPDIR: work,
    XR_FIXTURES: fixtures,
    CURL_LOG: curlLog,
    XR_FAKE_LOG: fakeLog,
    TERM: "dumb",
    ...opts.env,
  };
  // Always detach from any controlling terminal so no prompt can block the test
  // run; `setsid` is Linux-only, elsewhere tests pass --yes or are skipped.
  const setsid = Bun.which("setsid");
  const cmd = setsid ? [setsid, "-w", "bash", INSTALL_SH, ...args] : ["bash", INSTALL_SH, ...args];
  const r = Bun.spawnSync(cmd, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return {
    code: r.exitCode,
    out: r.stdout.toString() + r.stderr.toString(),
    urls: existsSync(curlLog) ? readFileSync(curlLog, "utf8").trim().split("\n").filter(Boolean) : [],
  };
}

const target = () => join(home, ".xr-agent");
const launcher = () => join(home, ".local", "bin", "xr");

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "xr-installer-behavior-"));
  home = join(work, "home");
  shims = join(work, "shims");
  fixtures = join(work, "releases");
  curlLog = join(work, "curl.log");
  fakeLog = join(work, "fake.log");
  mkdirSync(home, { recursive: true });
  mkdirSync(shims, { recursive: true });
  mkdirSync(fixtures, { recursive: true });
  // Fake curl: serves https://github.com/ahmadrrrtx/xr/releases/download/v<V>/<asset>
  // from $XR_FIXTURES/v<V>/<asset>; every other URL (branches, bun.sh, …) is a 404.
  writeExec(
    join(shims, "curl"),
    `#!/usr/bin/env bash
url=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) shift; out="$1" ;;
    https://*|http://*) url="$1" ;;
  esac
  shift
done
echo "$url" >> "$CURL_LOG"
prefix="https://github.com/ahmadrrrtx/xr/releases/download/"
if [[ "$url" == "$prefix"* ]]; then
  rel="\${url#"$prefix"}"
  if [ -f "$XR_FIXTURES/$rel" ]; then
    if [ -n "$out" ]; then cp "$XR_FIXTURES/$rel" "$out"; else cat "$XR_FIXTURES/$rel"; fi
    exit 0
  fi
fi
echo "curl: (22) The requested URL returned error: 404" >&2
exit 22
`,
  );
  // Fake bun for source installs (records what it was asked to do).
  writeExec(
    join(shims, "bun"),
    `#!/bin/sh\ncase "$1" in\n  --version) echo "1.3.0" ;;\n  *) echo "bun $*" >> "$XR_FAKE_LOG" ;;\nesac\nexit 0\n`,
  );
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

d("install.sh behaviour against a fake GitHub Releases (XR-LAUNCH-002)", () => {
  test("the manifest pins a public version for the installer", () => {
    expect(PINNED).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readFileSync(INSTALL_SH, "utf8")).toContain(`VERSION="${PINNED}"`);
  });

  test("missing release → non-zero exit, nothing created, no branch fallback", () => {
    const r = run(["--yes"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("refusing an unverified install");
    expect(r.out).toContain("Nothing was installed");
    expect(existsSync(target())).toBe(false);
    expect(existsSync(launcher())).toBe(false);
    expect(r.urls).toEqual([`https://github.com/ahmadrrrtx/xr/releases/download/v${PINNED}/SHA256SUMS`]);
    for (const u of r.urls) {
      expect(u).not.toContain("raw.githubusercontent.com");
      expect(u).not.toContain("/archive/");
      expect(u).not.toContain("main");
    }
  });

  test("happy path installs the pinned, verified binary and writes the marker", () => {
    publishRelease(PINNED);
    const r = run(["--yes"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Compiled binary installed and verified");
    const marker = readFileSync(join(target(), ".xr-install"), "utf8");
    expect(marker).toContain(`version=${PINNED}`);
    expect(marker).toContain("method=binary");
    expect(existsSync(launcher())).toBe(true);
    // Only the pinned release was contacted.
    for (const u of r.urls) expect(u.startsWith(`https://github.com/ahmadrrrtx/xr/releases/download/v${PINNED}/`)).toBe(true);
    // The wizard ran through the launcher with --yes.
    expect(readFileSync(fakeLog, "utf8")).toContain("install --from-bootstrap --yes");
    // No staging leftovers.
    const leftovers = Bun.spawnSync(["sh", "-c", `ls -a "${work}" | grep -c '^xr-install\\.' || true`]).stdout.toString().trim();
    expect(leftovers).toBe("0");
  });

  test("checksum mismatch is fatal: no fallback, nothing installed", () => {
    const uname = Bun.spawnSync(["uname", "-sm"]).stdout.toString();
    const name = uname.includes("Darwin")
      ? uname.includes("arm64") ? "xr-darwin-arm64" : "xr-darwin-x64"
      : /aarch64|arm64/.test(uname) ? "xr-linux-arm64" : "xr-linux-x64";
    publishRelease(PINNED, { tamper: name });
    const r = run(["--yes"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Integrity check FAILED");
    expect(existsSync(target())).toBe(false);
    expect(r.urls.some((u) => u.endsWith("/xr-source.tar.gz"))).toBe(false);
  });

  test("a binary missing from SHA256SUMS is refused; the verified source archive is used", () => {
    publishRelease(PINNED, { omitFromSums: BINARIES });
    const r = run(["--yes"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("refusing the unverified binary");
    expect(readFileSync(join(target(), ".xr-install"), "utf8")).toContain("method=source");
    expect(existsSync(join(target(), "src", "index.ts"))).toBe(true);
  });

  test("a directory that is not an XR install is never touched", () => {
    publishRelease(PINNED);
    mkdirSync(target(), { recursive: true });
    writeFileSync(join(target(), "thesis.docx"), "precious");
    const r = run(["--yes"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("is not an XR install");
    expect(readFileSync(join(target(), "thesis.docx"), "utf8")).toBe("precious");
    expect(r.urls).toEqual([]);
  });

  test("the dist/ left behind by an older failed installer is accepted", () => {
    publishRelease(PINNED);
    mkdirSync(join(target(), "dist"), { recursive: true });
    writeFileSync(join(target(), "dist", ".sha256sums.tmp"), "");
    const r = run(["--yes"]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(target(), ".xr-install"), "utf8")).toContain(`version=${PINNED}`);
  });

  test("--version pins a different published release", () => {
    publishRelease("0.9.0");
    const r = run(["--yes", "--version=v0.9.0"]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(target(), ".xr-install"), "utf8")).toContain("version=0.9.0");
    for (const u of r.urls) expect(u).toContain("/releases/download/v0.9.0/");
  });

  test("an invalid --version is rejected before any download", () => {
    const r = run(["--yes", "--version=../../main"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Invalid version");
    expect(r.urls).toEqual([]);
    expect(existsSync(target())).toBe(false);
  });

  test("--from-source installs the same release's verified source archive (frozen lockfile)", () => {
    publishRelease(PINNED);
    const r = run(["--yes", "--from-source"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Source archive verified");
    expect(readFileSync(join(target(), ".xr-install"), "utf8")).toContain("method=source");
    expect(readFileSync(fakeLog, "utf8")).toContain("bun install --frozen-lockfile --ignore-scripts");
    expect(r.urls.some((u) => /\/xr-(linux|darwin)-/.test(u))).toBe(false);
    // The launcher runs the source tree through Bun when there is no binary.
    expect(readFileSync(launcher(), "utf8")).toContain("src/index.ts");
  });

  const linuxOnly = Bun.which("setsid") ? test : test.skip;
  linuxOnly("`curl | bash` with no terminal and no --yes declines with a --yes hint (never hangs)", () => {
    publishRelease(PINNED);
    const r = run([]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("No terminal to confirm on");
    expect(r.out).toContain("bash -s -- --yes");
    expect(existsSync(target())).toBe(false);
  });
});
