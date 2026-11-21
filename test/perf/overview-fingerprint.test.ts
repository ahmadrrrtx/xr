/** Overview observations must not walk a project synchronously on the HTTP path. */
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invalidateConfigCache } from "../../src/config/cache.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { invalidateGitCache } from "../../src/daemon/state/cache.ts";
import * as processUtil from "../../src/util/process.ts";
import { invalidateProjectProfiles, observeProjectProfile, type ProjectProfileObservation } from "../../src/daemon/state/project-profile.ts";
import { FilesystemAuthority } from "../../src/security/filesystem.ts";
import { Store } from "../../src/state/workspace-store.ts";

const token = "overview-fixture";
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
let temp: string, root: string, cwd: string, home: string | undefined, store: Store;
let handler: ReturnType<typeof makeHandler>;
// The overview's git probe runs after the response; stubbed so no child process outlives a test's temp cwd.
let gitRun: ReturnType<typeof spyOn<typeof processUtil, "runCommand">>;
const gitResult = (stdout: string, ok = true): processUtil.RunCommandResult => ({ ok, status: ok ? 0 : 128, stdout, stderr: "", signal: null });
const get = (path: string, authorized = true) => handler(new Request(`http://localhost:3141/api/v1/${path}`, {
  headers: authorized ? { authorization: `Bearer ${token}` } : {},
}));
async function settled(path = root): Promise<ProjectProfileObservation> {
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    const value = observeProjectProfile(path);
    if (value.fingerprintStatus.state !== "pending") return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("project observation did not settle");
}
beforeEach(() => {
  cwd = process.cwd(); home = process.env.XR_HOME;
  temp = mkdtempSync(join(tmpdir(), "xr-overview-profile-"));
  root = join(temp, "project"); mkdirSync(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "fixture" } }));
  writeFileSync(join(root, "safe.test.ts"), "export const safe = true;");
  process.chdir(root); process.env.XR_HOME = join(temp, "home");
  invalidateProjectProfiles(); invalidateConfigCache("all");
  invalidateGitCache(); gitRun = spyOn(processUtil, "runCommand").mockResolvedValue(gitResult("", false));
  store = new Store(join(temp, "state.db")); handler = makeHandler(store, token);
});
afterEach(async () => {
  invalidateProjectProfiles(); await turn();
  gitRun.mockRestore(); invalidateGitCache();
  store.close(); process.chdir(cwd);
  if (home === undefined) delete process.env.XR_HOME; else process.env.XR_HOME = home;
  invalidateConfigCache("all"); rmSync(temp, { recursive: true, force: true });
});

test("a cold overview reports pending, never runs a synchronous project walk", async () => {
  const walk = spyOn(FilesystemAuthority.prototype, "walk");
  try {
    const response = await get("overview");
    expect(response.status).toBe(200);
    expect(walk).not.toHaveBeenCalled();
    const body = await response.json() as ProjectProfileObservation;
    expect(body.fingerprint).toBeNull();
    expect(body.fingerprintStatus).toEqual({ state: "pending", observedAt: null });
    const ready = await settled();
    expect(ready.fingerprint).toEqual({ files: 2, languages: { ".json": 1, ".ts": 1 }, frameworks: ["react"], hasTests: true });
    expect(ready.fingerprintStatus.state).toBe("ready");
    expect(ready.fingerprintStatus.observedAt).toBeGreaterThan(0);
    expect(walk).not.toHaveBeenCalled();
    expect((await (await get("overview")).json() as ProjectProfileObservation).fingerprint).toEqual(ready.fingerprint);
  } finally { walk.mockRestore(); }
});

test("a held scan cannot hold overview or health; concurrent polls share one flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = FilesystemAuthority.prototype.walkAsync;
  const walk = spyOn(FilesystemAuthority.prototype, "walkAsync").mockImplementation(async function (this: FilesystemAuthority, ...args) {
    await gate; return original.apply(this, args);
  });
  try {
    expect((await get("overview", false)).status).toBe(401);
    await turn(); expect(walk).not.toHaveBeenCalled();
    const first = await get("overview"); await turn();
    expect((await first.json() as ProjectProfileObservation).fingerprintStatus.state).toBe("pending");
    expect(walk).toHaveBeenCalledTimes(1);
    const health = await get("health");
    expect(health.status).toBe(200); expect(Object.keys(await health.json() as object).sort()).toEqual(["ok", "ts"]);
    const polls = await Promise.all([get("overview"), get("overview")]);
    for (const response of polls) expect((await response.json() as ProjectProfileObservation).fingerprint).toBeNull();
    expect(walk).toHaveBeenCalledTimes(1);
    release(); expect((await settled()).fingerprint?.files).toBe(2);
  } finally { release(); walk.mockRestore(); }
});

test("expired observations become pending and refresh, never claim cached counts are live", async () => {
  observeProjectProfile(root); const before = await settled();
  writeFileSync(join(root, "new.ts"), "export const newlyAdded = true;");
  expect(observeProjectProfile(root)).toEqual(before);
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 5_001);
  try {
    expect(observeProjectProfile(root)).toEqual({ fingerprint: null, fingerprintStatus: { state: "pending", observedAt: null } });
  } finally { clock.mockRestore(); }
  expect((await settled()).fingerprint?.files).toBe(3);
});

test("failed scans are unavailable, not empty; invalidation allows recovery", async () => {
  const walk = spyOn(FilesystemAuthority.prototype, "walkAsync").mockRejectedValue(new Error("synthetic scan refusal"));
  try {
    observeProjectProfile(root);
    const failed = await settled();
    expect(failed).toEqual({ fingerprint: null, fingerprintStatus: { state: "unavailable", observedAt: null } });
    expect(observeProjectProfile(root)).toEqual(failed);
    expect(walk).toHaveBeenCalledTimes(1);
  } finally { walk.mockRestore(); }
  invalidateProjectProfiles();
  expect(observeProjectProfile(root).fingerprintStatus.state).toBe("pending");
  expect((await settled()).fingerprint?.files).toBe(2);
});

test("late invalidated work cannot erase the replacement flight or publish its result", async () => {
  const releases: Array<() => void> = [];
  const original = FilesystemAuthority.prototype.walkAsync;
  const walk = spyOn(FilesystemAuthority.prototype, "walkAsync").mockImplementation(async function (this: FilesystemAuthority, ...args) {
    await new Promise<void>(resolve => releases.push(resolve));
    return original.apply(this, args);
  });
  try {
    observeProjectProfile(root); await turn(); expect(walk).toHaveBeenCalledTimes(1);
    invalidateProjectProfiles(); observeProjectProfile(root); await turn(); expect(walk).toHaveBeenCalledTimes(2);
    releases[0]!(); await turn();
    expect(observeProjectProfile(root).fingerprintStatus.state).toBe("pending");
    expect(walk).toHaveBeenCalledTimes(2);
    releases[1]!(); expect((await settled()).fingerprint?.files).toBe(2);
  } finally { for (const release of releases) release(); walk.mockRestore(); }
});

test("distinct roots never share counts and no more than two walks run at once", async () => {
  const second = join(temp, "second"), third = join(temp, "third"); mkdirSync(second); mkdirSync(third);
  writeFileSync(join(second, "only.py"), "pass");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = FilesystemAuthority.prototype.walkAsync;
  const walk = spyOn(FilesystemAuthority.prototype, "walkAsync").mockImplementation(async function (this: FilesystemAuthority, ...args) {
    await gate; return original.apply(this, args);
  });
  try {
    expect(observeProjectProfile(root).fingerprintStatus.state).toBe("pending");
    expect(observeProjectProfile(second).fingerprintStatus.state).toBe("pending");
    expect(observeProjectProfile(third)).toEqual({ fingerprint: null, fingerprintStatus: { state: "busy", observedAt: null } });
    await turn(); expect(walk).toHaveBeenCalledTimes(2); release();
    expect((await settled(root)).fingerprint?.files).toBe(2);
    expect((await settled(second)).fingerprint?.files).toBe(1);
    await turn(); expect(observeProjectProfile(third).fingerprintStatus.state).toBe("pending");
    const empty = await settled(third);
    expect(empty.fingerprint?.files).toBe(0); expect(empty.fingerprintStatus.state).toBe("ready");
    expect(walk).toHaveBeenCalledTimes(3);
  } finally { release(); walk.mockRestore(); }
});

type OverviewGit = { git: { branch: string; dirty: boolean } | null; gitStatus: { state: string; observedAt: number | null } };
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 2500;
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error("condition not reached");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function settledGit(): Promise<OverviewGit> {
  let body: OverviewGit | undefined;
  await until(async () => {
    body = await (await get("overview")).json() as OverviewGit;
    return body.gitStatus.state !== "pending";
  });
  return body!;
}

test("a held git probe cannot hold overview; polls share one probe; expiry serves the last summary while one refresh runs", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  gitRun.mockImplementation(async (_cmd, args = []) => { await gate; return gitResult(args[0] === "rev-parse" ? "main\n" : " M src/x.ts\n"); });
  try {
    const first = await Promise.race([get("overview"), new Promise<"held">(resolve => setTimeout(() => resolve("held"), 1_000))]);
    expect(first).not.toBe("held"); // the old handler awaited `git status` right here
    expect(await (first as Response).json()).toMatchObject({ git: null, gitStatus: { state: "pending", observedAt: null } });
    await Promise.all([get("overview"), get("overview")]);
    await until(() => gitRun.mock.calls.length >= 2); await turn();
    expect(gitRun).toHaveBeenCalledTimes(2); // ONE probe (rev-parse + status) for all three polls
    release();
    const ready = await settledGit();
    expect(ready).toMatchObject({ git: { branch: "main", dirty: true }, gitStatus: { state: "ready" } });
    expect(ready.gitStatus.observedAt).toBeGreaterThan(0);
    const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 5_001);
    try {
      expect(await (await get("overview")).json()).toMatchObject({ git: { branch: "main", dirty: true }, gitStatus: { state: "ready", observedAt: ready.gitStatus.observedAt } });
    } finally { clock.mockRestore(); }
    await until(() => gitRun.mock.calls.length >= 4);
    expect(gitRun).toHaveBeenCalledTimes(4); // the stale read started exactly one refresh
  } finally { release(); }
});

test("a failed git probe is unavailable with the legacy value, never a fabricated branch", async () => {
  expect((await (await get("overview")).json() as OverviewGit).gitStatus.state).toBe("pending");
  const failed = await settledGit();
  expect(failed).toMatchObject({ git: { branch: "no git", dirty: false }, gitStatus: { state: "unavailable" } });
  expect(gitRun).toHaveBeenCalledTimes(2);
});
