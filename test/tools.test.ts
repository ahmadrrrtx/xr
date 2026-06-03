/**
 * XR — Block 1 tests: new tools (web/system) + egress gate + dry-run.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostAllowed, htmlToText } from "../src/tools/egress.ts";
import { listDirTool, deleteFileTool, shellTool } from "../src/tools/system.ts";
import { fetchUrlTool, webSearchTool } from "../src/tools/web.ts";
import type { ToolContext } from "../src/core/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-tools-"));
});

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: tmp,
    approve: async () => true,
    audit: () => {},
    egressAllowlist: [],
    dryRun: false,
    ...overrides,
  };
}

// ---- egress ----
test("hostAllowed: exact + subdomain match, reject others", () => {
  expect(hostAllowed("https://api.github.com/x", ["github.com"])).toBe(true);
  expect(hostAllowed("https://github.com", ["github.com"])).toBe(true);
  expect(hostAllowed("https://evil.com", ["github.com"])).toBe(false);
  expect(hostAllowed("not a url", ["github.com"])).toBe(false);
});

test("htmlToText strips tags and scripts", () => {
  const t = htmlToText("<html><script>bad()</script><p>Hello <b>world</b></p></html>");
  expect(t).toContain("Hello");
  expect(t).toContain("world");
  expect(t).not.toContain("bad()");
});

// ---- network tools are egress-gated ----
test("fetch_url blocked when domain not allow-listed", async () => {
  const r = await fetchUrlTool.run({ url: "https://evil.com/x" }, ctx({ egressAllowlist: ["github.com"] }));
  expect(r.ok).toBe(false);
  expect(r.output).toContain("egress blocked");
});

test("fetch_url blocked when allow-list empty", async () => {
  const r = await fetchUrlTool.run({ url: "https://github.com" }, ctx({ egressAllowlist: [] }));
  expect(r.ok).toBe(false);
});

test("web_search blocked when searxng host not allow-listed", async () => {
  const r = await webSearchTool.run({ query: "test" }, ctx({ egressAllowlist: [] }));
  expect(r.ok).toBe(false);
});

// ---- system tools ----
test("list_dir lists files", async () => {
  writeFileSync(join(tmp, "a.txt"), "x");
  const r = await listDirTool.run({ path: "." }, ctx());
  expect(r.ok).toBe(true);
  expect(r.output).toContain("a.txt");
});

test("delete_file requires approval (denied = no delete)", async () => {
  writeFileSync(join(tmp, "d.txt"), "x");
  const r = await deleteFileTool.run({ path: "d.txt" }, ctx({ approve: async () => false }));
  expect(r.ok).toBe(false);
  expect(existsSync(join(tmp, "d.txt"))).toBe(true);
});

test("delete_file dry-run does not delete", async () => {
  writeFileSync(join(tmp, "d.txt"), "x");
  const r = await deleteFileTool.run({ path: "d.txt" }, ctx({ dryRun: true }));
  expect(r.ok).toBe(true);
  expect(r.output).toContain("[dry-run]");
  expect(existsSync(join(tmp, "d.txt"))).toBe(true);
});

test("delete_file actually deletes when approved", async () => {
  writeFileSync(join(tmp, "d.txt"), "x");
  const r = await deleteFileTool.run({ path: "d.txt" }, ctx());
  expect(r.ok).toBe(true);
  expect(existsSync(join(tmp, "d.txt"))).toBe(false);
});

test("shell blocks dangerous commands BEFORE approval", async () => {
  let approvalAsked = false;
  const r = await shellTool.run(
    { cmd: "rm -rf /" },
    ctx({ approve: async () => { approvalAsked = true; return true; } }),
  );
  expect(r.ok).toBe(false);
  expect(r.output).toContain("blocked");
  expect(approvalAsked).toBe(false); // policy blocks before even asking
});

test("shell dry-run does not execute", async () => {
  const r = await shellTool.run({ cmd: "echo hello" }, ctx({ dryRun: true }));
  expect(r.ok).toBe(true);
  expect(r.output).toContain("[dry-run]");
});

test("shell denied = no run", async () => {
  const r = await shellTool.run({ cmd: "echo hello" }, ctx({ approve: async () => false }));
  expect(r.ok).toBe(false);
  expect(r.output).toContain("denied");
});
