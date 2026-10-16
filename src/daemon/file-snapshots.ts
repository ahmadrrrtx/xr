/** Pure reverse application; no git worktree applier. */
import { FilesystemError } from "../security/filesystem.ts";
import type { DiffHunk } from "./hunks.ts";
export { fileGit, snapshotDiff } from "../util/git-snapshots.ts";
/** Exact reverse application against the already-read snapshot, not a host path. */
export function reverseHunks(content: string, selected: readonly DiffHunk[]): string {
  const trailing = content.endsWith("\n"), lines = content.replace(/\n$/, "").split("\n");
  for (const h of [...selected].sort((a, b) => b.newStart - a.newStart)) {
    const expected: string[] = [], replacement: string[] = [];
    for (const row of h.lines) {
      if (row.startsWith("\\")) continue;
      if (!row.startsWith("-")) expected.push(row.slice(1));
      if (!row.startsWith("+")) replacement.push(row.slice(1));
    }
    const start = Math.max(0, h.newStart - 1);
    if (lines.slice(start, start + expected.length).join("\n") !== expected.join("\n")) throw new FilesystemError("stale");
    lines.splice(start, expected.length, ...replacement);
  }
  return lines.join("\n") + (trailing ? "\n" : "");
}
