import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../../src/util/process.ts";
import { cleanup, tempDir, writeTree, openStore } from "./helpers.ts";
import { createRepoIntelligence } from "../../src/repo/index.ts";

async function git(cwd: string, args: string[]): Promise<void> {
  const r = await runCommand("git", args, { cwd, timeoutMs: 10_000 });
  if (!r.ok) throw new Error(r.stderr || r.stdout || args.join(" "));
}

describe("Phase 11 — git / diff awareness", () => {
  test("modified tracked files are detected via real git, and diff is returned", async () => {
    const home = tempDir("xr-git");
    const root = join(home, "proj");
    writeTree(root, { "src/a.ts": `export function alpha(): number { return 1; }\n` });
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "xr@example.com"]);
    await git(root, ["config", "user.name", "XR"]);
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "init"]);
    writeFileSync(join(root, "src/a.ts"), `export function alpha(): number { return 2; }\nexport function beta(): void {}\n`);

    process.env.XR_HOME = home;
    const store = openStore("ws-git", home);
    const intel = createRepoIntelligence({ workspaceId: "ws-git", root, store });
    try {
      await intel.index({ force: true });
      const status = await intel.gitStatus();
      expect(status["src/a.ts"] === "modified" || Object.values(status).includes("modified")).toBe(true);

      const hunks = await intel.diff("src/a.ts");
      expect(hunks.length).toBeGreaterThan(0);
      expect(hunks[0]!.additions + hunks[0]!.deletions).toBeGreaterThan(0);
      expect(hunks[0]!.patch).toContain("alpha");
    } finally {
      cleanup(home, store);
    }
  });
});
