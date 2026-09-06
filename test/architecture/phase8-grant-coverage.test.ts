/**
 * XR Phase 8 · Step 2 — ARCHITECTURAL TEST: no side-effecting tool, MCP or
 * plugin path executes without grant verification.
 *
 * This is the test that makes Phase 8's headline claim falsifiable. The
 * implementation could be perfect today and silently regress the moment
 * someone adds a tool that writes to disk and forgets the `requireGrant` line
 * — a code review catches that only if the reviewer knows to look.
 *
 * Two complementary strategies, because either alone is weak:
 *
 *   A. STATIC — every declared side-effecting tool must call `requireGrant`
 *      (or be an explicitly enumerated non-side-effecting exception). Catches
 *      the forgotten line at the source.
 *
 *   B. BEHAVIOURAL — actually invoke each side-effecting tool with a context
 *      carrying NO grant and assert it refuses. Catches the case where the
 *      call exists but is unreachable, mis-ordered, or its result ignored.
 *
 * B is the one that would have caught a `requireGrant` whose result was
 * computed and then dropped, which is exactly the kind of bug static analysis
 * cannot see.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { ToolContext } from "../../src/core/types.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** A context with NO grant — the adversary's position. */
function ungrantedCtx(cwd: string, over: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd,
    approve: async () => true, // approval is deliberately GRANTED: only the
    audit: () => {},           // grant check should stop these calls.
    egressAllowlist: [],
    dryRun: false,
    ...over,
  } as ToolContext;
}

describe("Phase 8 · Step 2 — static: side-effecting tools verify a grant", () => {
  /**
   * Tools in `src/tools/` that do NOT need a grant, with the reason. Read-only
   * observation is not a side effect; forcing grants onto it would train
   * everyone to mint grants reflexively, which devalues the signal.
   */
  const READ_ONLY_TOOLS = new Set([
    // Filesystem observation.
    "read_file", "list_files", "list_dir", "grep", "glob", "find_files",
    // Repository observation — these run `git` but only ever report state.
    "git_status", "git_diff", "git_log",
    /**
     * Network READS. These reach the outside world but do not modify it, and
     * they are already gated by the egress allowlist + guardedFetch, which is
     * the boundary that actually matters for them (where may we talk to,
     * rather than may we act). Exfiltration risk is covered by egress policy
     * and tested in the adversarial suite, not by grants.
     */
    "web_search", "web_fetch", "http_get", "fetch_url", "check_package",
    // Memory / task observation.
    "todo_read", "memory_search", "recall",
  ]);

  test("every write/exec tool in src/tools calls requireGrant", () => {
    const offenders: string[] = [];
    for (const file of walk(join(SRC, "tools"))) {
      const code = readFileSync(file, "utf8");
      const rel = relative(ROOT, file).replace(/\\/g, "/");

      // Find declared tools and whether the file guards them.
      const names = [...code.matchAll(/^\s*name:\s*["'`]([a-z0-9_.]+)["'`]/gim)].map((m) => m[1]);
      const sideEffecting = names.filter((n) => !READ_ONLY_TOOLS.has(n));
      if (!sideEffecting.length) continue;

      const guards = (code.match(/requireGrant\s*\(/g) ?? []).length;
      if (guards < sideEffecting.length) {
        offenders.push(`${rel}: ${sideEffecting.length} side-effecting tool(s) [${sideEffecting.join(", ")}] but only ${guards} requireGrant call(s)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the third-party execution boundaries (MCP, plugins) verify a grant", () => {
    // These are the paths where code XR did not write gets to run.
    const required: Array<[string, number]> = [
      ["src/mcp/client.ts", 2],      // wrapMcpTool + wrapMcpResource
      ["src/plugins/manager.ts", 1], // adaptTool
    ];
    for (const [rel, min] of required) {
      const code = readFileSync(join(ROOT, rel), "utf8");
      const count = (code.match(/requireGrant\s*\(/g) ?? []).length;
      expect({ rel, count: count >= min }).toEqual({ rel, count: true });
    }
  });

  test("the enforcement point is the ONLY definition of the check", () => {
    // One implementation, many call sites. A second, subtly different copy of
    // this logic is how boundaries drift apart.
    const defs = walk(SRC).filter((f) => /export function requireGrant/.test(readFileSync(f, "utf8")));
    expect(defs.map((f) => relative(ROOT, f).replace(/\\/g, "/"))).toEqual(["src/capabilities/enforce.ts"]);
  });
});

describe("Phase 8 · Step 2 — behavioural: an ungranted call is refused", () => {
  const cases: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "write_file", args: { path: "evil.txt", content: "pwned" } },
    { name: "delete_file", args: { path: "evil.txt" } },
    { name: "shell", args: { cmd: "echo pwned" } },
  ];

  for (const c of cases) {
    test(`${c.name} refuses to run without a grant`, async () => {
      const tmp = mkdtempSync(join(tmpdir(), "xr-gc-"));
      process.env.XR_HOME = join(tmp, "home");
      const { allTools } = await import("../../src/tools/registry.ts");
      const tool = allTools().find((t) => t.name === c.name);
      expect(tool).toBeDefined();

      const res = await tool!.run(c.args, ungrantedCtx(tmp));
      expect(res.ok).toBe(false);
      expect(res.output.toLowerCase()).toContain("grant");
    });
  }

  test("write_file with no grant leaves NO file behind (refusal is real)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "xr-gc2-"));
    process.env.XR_HOME = join(tmp, "home");
    const { allTools } = await import("../../src/tools/registry.ts");
    const writeFile = allTools().find((t) => t.name === "write_file")!;

    await writeFile.run({ path: "should-not-exist.txt", content: "x" }, ungrantedCtx(tmp));
    expect(require("node:fs").existsSync(join(tmp, "should-not-exist.txt"))).toBe(false);
  });

  test("delete_file with no grant does NOT delete (refusal precedes the effect)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "xr-gc3-"));
    process.env.XR_HOME = join(tmp, "home");
    const victim = join(tmp, "victim.txt");
    writeFileSync(victim, "precious");

    const { allTools } = await import("../../src/tools/registry.ts");
    const del = allTools().find((t) => t.name === "delete_file")!;
    const res = await del.run({ path: "victim.txt" }, ungrantedCtx(tmp));

    expect(res.ok).toBe(false);
    expect(readFileSync(victim, "utf8")).toBe("precious");
  });

  test("a granted call for DIFFERENT arguments is refused (args binding holds)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "xr-gc4-"));
    process.env.XR_HOME = join(tmp, "home");
    const { mintTestGrant } = await import("../helpers/grant.ts");
    const { allTools } = await import("../../src/tools/registry.ts");
    const writeFile = allTools().find((t) => t.name === "write_file")!;

    // Mint for a harmless path, then attempt a different one — the TOCTOU
    // shape Phase 8 exists to close.
    const grantId = mintTestGrant("write_file", { path: "allowed.txt", content: "ok" });
    const res = await writeFile.run(
      { path: "escalated.txt", content: "pwned" },
      ungrantedCtx(tmp, { grantId }),
    );

    expect(res.ok).toBe(false);
    expect(require("node:fs").existsSync(join(tmp, "escalated.txt"))).toBe(false);
  });

  test("a grant is single-use: replaying it is refused", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "xr-gc5-"));
    process.env.XR_HOME = join(tmp, "home");
    const { mintTestGrant } = await import("../helpers/grant.ts");
    const { allTools } = await import("../../src/tools/registry.ts");
    const writeFile = allTools().find((t) => t.name === "write_file")!;

    const args = { path: "once.txt", content: "first" };
    const grantId = mintTestGrant("write_file", args);

    const first = await writeFile.run(args, ungrantedCtx(tmp, { grantId }));
    expect(first.ok).toBe(true);

    const replay = await writeFile.run(args, ungrantedCtx(tmp, { grantId }));
    expect(replay.ok).toBe(false);
  });

  test("a grant for tool A cannot authorize tool B", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "xr-gc6-"));
    process.env.XR_HOME = join(tmp, "home");
    const { mintTestGrant } = await import("../helpers/grant.ts");
    const { allTools } = await import("../../src/tools/registry.ts");
    const shell = allTools().find((t) => t.name === "shell")!;

    const grantId = mintTestGrant("write_file", { cmd: "echo hi" });
    const res = await shell.run({ cmd: "echo hi" }, ungrantedCtx(tmp, { grantId }));
    expect(res.ok).toBe(false);
  });
});
