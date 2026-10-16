/** A1 production serve() process + real authenticated HTTP, never a handler stub. */
import { expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditRows, freshHome, removeHome, REPO_ROOT, writeConfig } from "../e2e-blackbox/helpers.ts";

async function fixture() {
  const home = freshHome(), cwd = join(home, "workspace"), outside = join(home, "outside");
  const secret = `A1_HTTP_SYNTHETIC_${randomUUID()}`;
  mkdirSync(cwd); mkdirSync(outside);
  writeFileSync(join(outside, "marker.txt"), secret);
  writeFileSync(join(cwd, ".env"), secret);
  writeFileSync(join(cwd, "safe.txt"), "HTTP_SAFE_POSITIVE");
  symlinkSync(outside, join(cwd, "linked"), "dir");
  writeConfig(home, { version: 22, memory: { enabled: false }, security: { egressAllowlist: [], hardened: true } });
  const child = spawn(process.execPath, [join(REPO_ROOT, "test/helpers/a1-daemon-process.ts")], { cwd, env: { PATH: process.env.PATH, HOME: home, XR_HOME: home, TMPDIR: process.env.TMPDIR, NO_COLOR: "1", XR_AUDIT_NO_AUTOKEY: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stderr.on("data", b => { errors += b.toString(); });
  const ready = await new Promise<{ port: number; token: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("daemon readiness timeout")), 15_000);
    child.once("exit", () => { clearTimeout(timer); reject(new Error("daemon exited before readiness")); });
    child.stdout.on("data", b => {
      output += b.toString();
      for (const line of output.split("\n")) {
        if (!line.startsWith('{"a1_ready":')) continue;
        clearTimeout(timer); resolve(JSON.parse(line));
      }
    });
  }).catch(e => { child.kill("SIGTERM"); throw e; });
  const base = `http://127.0.0.1:${ready.port}`;
  const unauth = await fetch(`${base}/api/v1/files/read?path=safe.txt`);
  expect(unauth.status).toBe(401);
  const bootstrap = await fetch(`${base}/?token=${ready.token}`, { redirect: "manual" });
  expect(bootstrap.status).toBe(302); // Existing token->HttpOnly-cookie bootstrap contract.
  const cookie = bootstrap.headers.get("set-cookie")!.split(";")[0]!;
  const request = (path: string, method = "GET", body?: unknown) => fetch(base + path, { method, headers: { cookie, origin: base, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return {
    home, cwd, outside, secret, request,
    leaked: (text: string) => (text + output + errors + JSON.stringify(auditRows(home))).includes(secret),
    async close() {
      // Exit is observed before harness escalation; no cancellation proof claimed.
      const exited = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("daemon did not terminate")); }, 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
      child.kill("SIGTERM"); await exited; removeHome(home);
    },
  };
}

test("FS08 actual token bootstrap: valid read positive, symlink/secret list/read denied", async () => {
  const f = await fixture();
  try {
    const positive = await f.request("/api/v1/files/read?path=safe.txt");
    expect(positive.status).toBe(200);
    expect((await positive.json() as {content: string}).content).toBe("HTTP_SAFE_POSITIVE");
    for (const path of ["linked/marker.txt", ".env"]) {
      const res = await f.request(`/api/v1/files/read?path=${encodeURIComponent(path)}`);
      const text = await res.text();
      expect(f.leaked(text)).toBe(false);
      expect(res.status).not.toBe(200);
    }
    const list = await f.request("/api/v1/files?path=linked");
    expect(list.status).not.toBe(200);
    expect(f.leaked(await list.text())).toBe(false);
  } finally { await f.close(); }
}, 30_000);

// Windows refuses to rename a directory while a handle bound by a pending approval is open.
// That refusal is the stronger guarantee; the swap then never happens.
function trySwapDir(from: string, to: string): boolean {
  try { renameSync(from, to); return true; } catch (e) {
    if (process.platform === "win32" && (e as NodeJS.ErrnoException).code === "EPERM") return false;
    throw e;
  }
}

test("FS09/FS10 authenticated save approval->parent-link swap refuses with zero outside effect", async () => {
  const f = await fixture();
  try {
    mkdirSync(join(f.cwd, "target"));
    writeFileSync(join(f.cwd, "target", "safe.txt"), "HTTP_APPROVED_OLD");
    const save = f.request("/api/v1/files/write", "POST", { path: "target/safe.txt", content: "HTTP_APPROVED_NEW" });
    let id: string | undefined;
    const deadline = Date.now() + 5000;
    while (!id && Date.now() < deadline) {
      const body = await (await f.request("/api/v1/approvals")).json() as { pending?: Array<{id: string; tool: string}> };
      id = body.pending?.find(p => p.tool === "write_file")?.id;
      if (!id) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(typeof id).toBe("string");
    // Deterministic: production request is blocked on its durable approval now.
    const swapped = trySwapDir(join(f.cwd, "target"), join(f.cwd, "retained"));
    if (swapped) symlinkSync(f.outside, join(f.cwd, "target"), "dir");
    const decision = await f.request(`/api/v1/approvals/${id}/decision`, "POST", { approved: true });
    expect(decision.ok).toBe(true);
    const result = await save;
    const body = await result.text();
    expect(existsSync(join(f.outside, "safe.txt"))).toBe(false);
    expect(f.leaked(body)).toBe(false);
    if (swapped) {
      expect(readFileSync(join(f.cwd, "retained", "safe.txt"), "utf8")).toBe("HTTP_APPROVED_OLD");
      expect(result.status).not.toBe(200);
    } else {
      // OS refused the swap while the approval held the directory; the write lands in the bound object.
      expect(readFileSync(join(f.cwd, "target", "safe.txt"), "utf8")).toBe("HTTP_APPROVED_NEW");
    }
  } finally { await f.close(); }
}, 30_000);

async function pendingApproval(f: Awaited<ReturnType<typeof fixture>>, tool: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const body = await (await f.request("/api/v1/approvals")).json() as { pending?: Array<{id: string; tool: string; preview?: unknown}> };
    const found = body.pending?.find(p => p.tool === tool);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("expected production durable approval did not become pending");
}
function gitFixture(cwd: string, args: string[]) {
  const r = spawnSync("git", ["-c", "user.name=Synthetic A1", "-c", "user.email=a1@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  expect({ status: r.status, stderr: r.stderr }).toMatchObject({ status: 0 });
}
test("FS09 actual authenticated new-destination save is gated and preserves outside bytes/mtime", async () => {
  const f = await fixture();
  try {
    const sentinel = statSync(join(f.outside, "marker.txt"));
    const saving = f.request("/api/v1/files/write", "POST", { path: "new/missing/file.txt", content: "HTTP_NEW_DESTINATION" });
    const approval = await pendingApproval(f, "write_file");
    expect(existsSync(join(f.cwd, "new"))).toBe(false);
    expect(f.leaked(JSON.stringify(approval))).toBe(false);
    expect((await f.request(`/api/v1/approvals/${approval.id}/decision`, "POST", { approved: true })).ok).toBe(true);
    const saved = await saving; expect(saved.status).toBe(200);
    expect((await saved.json() as {applied: boolean}).applied).toBe(true);
    expect(readFileSync(join(f.cwd, "new/missing/file.txt"), "utf8")).toBe("HTTP_NEW_DESTINATION");
    expect(readFileSync(join(f.outside, "marker.txt"), "utf8") === f.secret).toBe(true);
    expect(statSync(join(f.outside, "marker.txt")).mtimeMs).toBe(sentinel.mtimeMs);
  } finally { await f.close(); }
}, 30_000);
test("FS09 actual authenticated diff/hunk revert uses authorized snapshots and ordinary approval", async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.cwd, "notes.txt"), "HTTP_ORIGINAL\n"); gitFixture(f.cwd, ["init", "--quiet"]); gitFixture(f.cwd, ["add", "--", "notes.txt"]); gitFixture(f.cwd, ["commit", "--quiet", "-m", "Synthetic tracked baseline"]);
    writeFileSync(join(f.cwd, "notes.txt"), "HTTP_EDITED\n");
    const result = await f.request("/api/v1/files/diff?path=notes.txt"); expect(result.status).toBe(200);
    const diff = await result.json() as { diff: string; hunks: Array<{id: string}> };
    expect(diff.diff).toContain("+HTTP_EDITED"); expect(f.leaked(JSON.stringify(diff))).toBe(false); expect(diff.hunks.length).toBe(1);
    const reverting = f.request("/api/v1/files/hunks/revert", "POST", { path: "notes.txt", hunkIds: [diff.hunks[0]!.id] });
    const approval = await pendingApproval(f, "patch"); expect(readFileSync(join(f.cwd, "notes.txt"), "utf8")).toBe("HTTP_EDITED\n"); expect(f.leaked(JSON.stringify(approval))).toBe(false);
    expect((await f.request(`/api/v1/approvals/${approval.id}/decision`, "POST", { approved: true })).ok).toBe(true);
    const response = await reverting; expect(response.status).toBe(200); expect((await response.json() as {applied: boolean}).applied).toBe(true);
    expect(readFileSync(join(f.cwd, "notes.txt"), "utf8")).toBe("HTTP_ORIGINAL\n");
    linkSync(join(f.cwd, ".env"), join(f.cwd, "innocent.txt"));
    for (const path of [".env", "innocent.txt", "linked/marker.txt"]) {
      const denied = await f.request(`/api/v1/files/diff?path=${encodeURIComponent(path)}`); expect(denied.status).not.toBe(200); expect(f.leaked(await denied.text())).toBe(false);
    }
  } finally { await f.close(); }
}, 30_000);
test("FS09/FS10 actual authenticated hunk revert rejects a parent swapped at pending approval", async () => {
  const f = await fixture();
  try {
    mkdirSync(join(f.cwd, "target")); writeFileSync(join(f.cwd, "target/marker.txt"), "HTTP_BEFORE\n");
    gitFixture(f.cwd, ["init", "--quiet"]); gitFixture(f.cwd, ["add", "--", "target/marker.txt"]); gitFixture(f.cwd, ["commit", "--quiet", "-m", "Synthetic tracked target"]);
    writeFileSync(join(f.cwd, "target/marker.txt"), "HTTP_REVIEWED\n");
    const diff = await (await f.request("/api/v1/files/diff?path=target/marker.txt")).json() as {hunks: Array<{id: string}>}; expect(diff.hunks.length).toBe(1);
    const reverting = f.request("/api/v1/files/hunks/revert", "POST", { path: "target/marker.txt", hunkIds: [diff.hunks[0]!.id] });
    const approval = await pendingApproval(f, "patch");
    const swapped = trySwapDir(join(f.cwd, "target"), join(f.cwd, "retained")); if (swapped) symlinkSync(f.outside, join(f.cwd, "target"), "dir");
    expect((await f.request(`/api/v1/approvals/${approval.id}/decision`, "POST", { approved: true })).ok).toBe(true);
    const refused = await reverting; expect(f.leaked(await refused.text())).toBe(false);
    expect(readFileSync(join(f.outside, "marker.txt"), "utf8") === f.secret).toBe(true);
    if (swapped) {
      expect(refused.status).not.toBe(200);
      expect(readFileSync(join(f.cwd, "retained/marker.txt"), "utf8")).toBe("HTTP_REVIEWED\n");
    } else {
      // OS refused the swap; the approved revert acts on the bound in-root file.
      expect(refused.status).toBe(200);
      expect(readFileSync(join(f.cwd, "target/marker.txt"), "utf8")).toBe("HTTP_BEFORE\n");
    }
  } finally { await f.close(); }
}, 30_000);
