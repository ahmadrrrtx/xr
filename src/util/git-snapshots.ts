/** Read an index blob; the worktree side MUST be an already-authorized snapshot. */
import { spawnSync } from "node:child_process";
import { unifiedDiff } from "./unified-diff.ts";
export function fileGit(root: string, args: string[]): { ok: boolean; stdout: string } {
  const r = spawnSync("git", ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" },
  });
  return { ok: r.status === 0, stdout: r.status === 0 ? r.stdout : "" };
}
export function snapshotDiff(root: string, path: string, content: string): { diff: string; tracked: boolean; ok: boolean } {
  const index = fileGit(root, ["show", "--no-ext-diff", "--no-textconv", `:${path}`]);
  if (!index.ok) return { diff: "", tracked: false, ok: true };
  return { diff: unifiedDiff(index.stdout, content, path), tracked: true, ok: true };
}
