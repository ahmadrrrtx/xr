/** A1 public CLI -> coder -> AgentService -> real production tool regressions. */
import { expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { a1Fixture } from "../helpers/a1-cli-fixture.ts";
import { auditEvents, auditDetail } from "./helpers.ts";
import { spawnSync } from "node:child_process";
const T = 45_000;

for (const path of ["linked/marker.txt", ".env", "alias.txt", "key.pem"]) {
  test(`FS01/FS04 read_file ${path}: no canary in provider, output or audit`, async () => {
    const f = await a1Fixture("read_file", { path });
    try {
      writeFileSync(join(f.outside, "marker.txt"), f.secret);
      writeFileSync(join(f.cwd, ".env"), f.secret);
      writeFileSync(join(f.cwd, "key.pem"), f.secret);
      linkSync(join(f.cwd, ".env"), join(f.cwd, "alias.txt"));
      symlinkSync(f.outside, join(f.cwd, "linked"), "dir");
      const r = await f.run();
      expect(r.timedOut).toBe(false);
      expect(f.requests.length).toBe(2);
      expect(f.disclosure(r.stdout + r.stderr)).toBe(false);
    } finally { await f.close(); }
  }, T);
}

test("FS02 write_file linked missing destination: zero outside effect", async () => {
  const f = await a1Fixture("write_file", { path: "linked/new.txt", content: "authorized only in root" });
  try {
    writeFileSync(join(f.outside, "sentinel.txt"), f.secret);
    const before = statSync(join(f.outside, "sentinel.txt"));
    symlinkSync(f.outside, join(f.cwd, "linked"), "dir");
    const r = await f.run();
    expect(r.timedOut).toBe(false);
    expect(f.requests.length).toBe(2);
    expect(existsSync(join(f.outside, "new.txt"))).toBe(false);
    expect(readFileSync(join(f.outside, "sentinel.txt"), "utf8") === f.secret).toBe(true);
    expect(statSync(join(f.outside, "sentinel.txt")).mtimeMs).toBe(before.mtimeMs);
    expect(f.disclosure(r.stdout + r.stderr)).toBe(false);
  } finally { await f.close(); }
}, T);

for (const input of ["AGENTS.md", "package.json", ".gitignore", ".xrignore"]) {
  test(`FS05 implicit ${input} link cannot reach provider`, async () => {
    const f = await a1Fixture("read_file", { path: "ordinary.txt" });
    try {
      writeFileSync(join(f.outside, "context.txt"), input === "package.json" ? JSON.stringify({ name: f.secret }) : f.secret);
      symlinkSync(join(f.outside, "context.txt"), join(f.cwd, input));
      writeFileSync(join(f.cwd, "ordinary.txt"), "ordinary context");
      const r = await f.run([], "Synthetic task @AGENTS.md @linked/");
      expect(r.timedOut).toBe(false);
      expect(f.requests.length).toBe(2);
      expect(f.disclosure(r.stdout + r.stderr)).toBe(false);
    } finally { await f.close(); }
  }, T);
}

for (const root of [".", "linked", ".env"]) {
  test(`FS06/FS07 search_code explicit ${root}: secret never enters output`, async () => {
    const f = await a1Fixture("search_code", { pattern: "A1_SYNTHETIC", path: root, include: "*" });
    try {
      mkdirSync(join(f.cwd, "sub"));
      writeFileSync(join(f.cwd, "sub", "safe.txt"), "A1_SYNTHETIC_SAFE_POSITIVE");
      writeFileSync(join(f.cwd, ".env"), f.secret);
      writeFileSync(join(f.outside, "marker.txt"), f.secret);
      symlinkSync(f.outside, join(f.cwd, "linked"), "dir");
      const config = join(f.home, "rg-config");
      writeFileSync(config, "--hidden\n--follow\n--no-ignore\n");
      const r = await f.run([], "Synthetic search", { RIPGREP_CONFIG_PATH: config });
      expect(r.timedOut).toBe(false);
      expect(f.requests.length).toBe(2);
      expect(f.disclosure(r.stdout + r.stderr)).toBe(false);
      if (root === ".") {
        expect(JSON.stringify(f.requests).includes("A1_SYNTHETIC_SAFE_POSITIVE")).toBe(true);
        const expected = process.env.A1_EXPECT_SEARCH_ENGINE ?? (spawnSync("rg", ["--no-config", "--version"]).status === 0 ? "ripgrep" : "js");
        expect(auditDetail(f.home, "search_code").map(detail => JSON.parse(detail).engine)).toContain(expected);
      }
    } finally { await f.close(); }
  }, T);
}

for (const [tool, args, expected] of [
  ["read_file", { path: "safe.txt" }, "A1_SAFE_READ_POSITIVE"],
  ["write_file", { path: "safe.txt", content: "A1_SAFE_WRITE_POSITIVE" }, "A1_SAFE_WRITE_POSITIVE"],
] as const) {
  test(`FS01/FS02 positive in-root ${tool} retains real operation and schema`, async () => {
    const f = await a1Fixture(tool, args);
    try {
      writeFileSync(join(f.cwd, "safe.txt"), "A1_SAFE_READ_POSITIVE");
      const r = await f.run();
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      expect(f.requests.length).toBe(2);
      const schemas = JSON.stringify(f.requests[0]?.tools);
      expect(schemas.includes('"path"')).toBe(true);
      expect(readFileSync(join(f.cwd, "safe.txt"), "utf8")).toBe(expected);
      if (tool === "read_file") expect(JSON.stringify(f.requests).includes(expected)).toBe(true);
    } finally { await f.close(); }
  }, T);
}

for (const args of [
  { cmd: "printf %s A1_POLICY_ONLY > denied-marker.txt" },
  { cmd: "printf %s A1_POLICY_ONLY > denied-marker.txt", command: "harmless decoy" },
  { command: "printf %s A1_POLICY_ONLY > denied-marker.txt" },
  { cmd: 123 },
]) {
  test(`E08/E09 actual process shell policy/decoy ${JSON.stringify(Object.keys(args))}`, async () => {
    const f = await a1Fixture("shell", args);
    try {
      f.permissions(["shell:printf*"]);
      const r = await f.run();
      expect(r.timedOut).toBe(false);
      expect(f.requests.length).toBe(2);
      expect(existsSync(join(f.cwd, "denied-marker.txt"))).toBe(false);
      const audits = auditEvents(f.home);
      expect(audits).toContain("shell.denied");
      expect(audits).not.toContain("shell.isolated_blocked");
      expect(audits).not.toContain("shell.run_isolated");
      expect(audits).not.toContain("shell.run");
      if (typeof args.cmd === "string") {
        expect(r.stdout.includes('"decision":"deny"')).toBe(true);
        expect(r.stdout.includes("deny rule")).toBe(true);
      }
    } finally { await f.close(); }
  }, T);
}

test("E03 exact token override reaches the actual downstream governor independently of USD", async () => {
  const f = await a1Fixture("write_file", { path: "token-marker.txt", content: "NEVER_WRITTEN" });
  try {
    // This is a TOKEN cap, not the provider's per-response max_tokens option.
    // The real governor reports the exact received cap and refuses its first 2000-token estimate.
    const r = await f.run(["--max-tokens", "173"]);
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(1);
    expect(f.requests.length).toBe(0);
    expect(r.stdout).toContain('"stopped":"budget"');
    expect(existsSync(join(f.cwd, "token-marker.txt"))).toBe(false);
    expect(auditEvents(f.home)).toContain("budget.stop");
    expect(auditDetail(f.home, "budget.pause").join("\n")).toContain("token ceiling (173)");
  } finally { await f.close(); }
}, T);


test("E10 print-mode tool filtering cannot be upgraded by an allow rule", async () => {
  const f = await a1Fixture("shell", { cmd: "printf %s A1_READONLY > read-only-marker.txt" });
  try {
    const r = await f.run(["--print"]);
    expect(r.timedOut).toBe(false);
    expect(f.requests.length).toBe(2);
    const schemas = JSON.stringify(f.requests[0]?.tools);
    expect(schemas).toContain('"read_file"');
    expect(schemas).not.toContain('"shell"');
    expect(existsSync(join(f.cwd, "read-only-marker.txt"))).toBe(false);
    const audits = auditEvents(f.home);
    for (const event of ["shell.run", "shell.run_isolated", "shell.isolated_blocked", "shell.hardened_blocked"]) expect(audits).not.toContain(event);
  } finally { await f.close(); }
}, T);

test("E10 harmless quoted force-push text uses actual cmd dangerous classification, never the decoy", async () => {
  const f = await a1Fixture("shell", { cmd: "printf '%s' 'git push --force' > dangerous-marker.txt", command: "harmless decoy" });
  try {
    const r = await f.run();
    expect(r.timedOut).toBe(false);
    expect(f.requests.length).toBe(2);
    expect(r.stdout).toContain("dangerous command");
    expect(r.stdout).toContain("git-force-push");
    expect(existsSync(join(f.cwd, "dangerous-marker.txt"))).toBe(false);
    const audits = auditEvents(f.home);
    expect(audits).toContain("shell.denied");
    for (const event of ["shell.run", "shell.run_isolated", "shell.isolated_blocked", "shell.hardened_blocked"]) expect(audits).not.toContain(event);
  } finally { await f.close(); }
}, T);
