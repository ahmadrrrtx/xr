import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkedWingetChanges,
  submitWinget,
} from "../../scripts/publish-winget";
test("publisher reads only canonical version files and refuses altered unsigned bytes before API work", () => {
  const root = mkdtempSync(join(tmpdir(), "xr-winget-"));
  try {
    const dir = join(root, "manifests/x/Xr/Xr/1.2.3");
    mkdirSync(dir, { recursive: true });
    const sums = new Map<string, string>();
    for (const name of [
      "Xr.Xr.yaml",
      "Xr.Xr.installer.yaml",
      "Xr.Xr.locale.en-US.yaml",
    ]) {
      writeFileSync(join(dir, name), "fixture " + name);
      sums.set(
        name,
        createHash("sha256")
          .update("fixture " + name)
          .digest("hex"),
      );
    }
    expect(checkedWingetChanges(root, "Xr.Xr", "1.2.3", sums)).toHaveLength(3);
    writeFileSync(join(dir, "Xr.Xr.yaml"), "tampered");
    expect(() => checkedWingetChanges(root, "Xr.Xr", "1.2.3", sums)).toThrow();
    expect(() => checkedWingetChanges(root, "../Xr", "1.2.3", sums)).toThrow();
    expect(() =>
      checkedWingetChanges(root, "Xr.Xr", "1.2.3-rc.1", sums),
    ).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("Git/PR transport uses returned SHAs, never force-updates owner work or invents submission success", async () => {
  const prefix = "manifests/x/Xr/Xr/1.2.3/",
    changes = [
      "Xr.Xr.yaml",
      "Xr.Xr.installer.yaml",
      "Xr.Xr.locale.en-US.yaml",
    ].map((name) => ({
      path: prefix + name,
      content: Buffer.from("fixture").toString("base64"),
    }));
  const calls: any[] = [],
    sha = (n: number) => String(n).repeat(40);
  const api = async (method: string, path: string, body?: any) => {
    calls.push({ method, path, body });
    if (path === "/user") return { login: "owner" };
    if (path === "/repos/microsoft/winget-pkgs")
      return { default_branch: "master" };
    if (path.includes("/git/ref/heads/master"))
      return { object: { sha: sha(1) } };
    if (path.endsWith("/git/commits/" + sha(1)))
      return { tree: { sha: sha(2) } };
    if (path === "/repos/owner/winget-pkgs")
      return { fork: true, source: { full_name: "microsoft/winget-pkgs" } };
    if (path.includes("/git/ref/heads/xr-")) return null;
    if (path.endsWith("/git/blobs")) return { sha: sha(3) };
    if (path.endsWith("/git/trees")) return { sha: sha(4) };
    if (path.endsWith("/git/commits")) return { sha: sha(5) };
    if (path.endsWith("/git/refs")) return {};
    if (path.endsWith("/pulls"))
      return { html_url: "https://github.com/microsoft/winget-pkgs/pull/42" };
    throw new Error("unexpected fixture API operation");
  };
  expect(await submitWinget(api, changes, "Xr.Xr", "1.2.3")).toContain(
    "/pull/42",
  );
  expect(calls.find((c) => c.path.endsWith("/git/trees")).body.base_tree).toBe(
    sha(2),
  );
  expect(
    calls.find((c) => c.path.endsWith("/git/commits")).body.parents,
  ).toEqual([sha(1)]);
  expect(calls.find((c) => c.path.endsWith("/git/refs")).body.sha).toBe(sha(5));
  const before = calls.length;
  await expect(submitWinget(api, [], "Xr.Xr", "1.2.3")).rejects.toThrow();
  expect(calls.length).toBe(before);
  await expect(
    submitWinget(
      async (m, p, b) =>
        p.includes("/git/ref/heads/xr-")
          ? { object: { sha: sha(6) } }
          : api(m, p, b),
      changes,
      "Xr.Xr",
      "1.2.3",
    ),
  ).rejects.toThrow("Staging branch already exists");
});
