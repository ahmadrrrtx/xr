/**
 * XR Phase 11 — real git status / diff. Never inferred from mtimes.
 */

import { runCommand } from "../util/process.ts";
import { withFilesystem } from "../security/filesystem.ts";
import { fileGit, snapshotDiff } from "../util/git-snapshots.ts";
import type { GitFileStatus, RepoDiffHunk } from "./types.ts";

export interface GitSnapshot {
  gitRoot: string | null;
  status: Map<string, GitFileStatus>;
  /** porcelain line per relative path (for diffs). */
  raw: Map<string, string>;
}

export async function readGitSnapshot(root: string): Promise<GitSnapshot> {
  const rootCheck = await runCommand("git", ["rev-parse", "--show-toplevel"], { cwd: root, timeoutMs: 8_000 });
  if (!rootCheck.ok || !rootCheck.stdout.trim()) {
    return { gitRoot: null, status: new Map(), raw: new Map() };
  }
  const gitRoot = rootCheck.stdout.trim();
  const st = await runCommand("git", ["status", "--porcelain", "-uall"], { cwd: gitRoot, timeoutMs: 15_000, maxBuffer: 2 * 1024 * 1024 });
  const status = new Map<string, GitFileStatus>();
  const raw = new Map<string, string>();
  if (!st.ok) return { gitRoot, status, raw };
  for (const line of st.stdout.split("\n")) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    let path = line.slice(3);
    if (path.includes(" -> ")) path = path.split(" -> ").pop() ?? path;
    path = path.replace(/\\/g, "/");
    status.set(path, decodeStatus(code));
    raw.set(path, line);
  }
  return { gitRoot, status, raw };
}

export async function readDiff(root: string, file?: string): Promise<RepoDiffHunk[]> {
  const out: RepoDiffHunk[] = [];
  try {
    withFilesystem(root, "index", fs => {
      const paths = file ? [file] : fileGit(fs.root, ["ls-files", "--cached", "-z"]).stdout.split("\0").filter(Boolean).slice(0, 2000);
      for (const path of paths) {
        let pending: ReturnType<typeof fs.prepare> | undefined;
        try {
          pending = fs.prepare(path, "write"); // also represents a deleted (missing) worktree file
          if (pending.sensitive) continue;
          const result = snapshotDiff(fs.root, pending.path, pending.oldContent);
          if (!result.tracked || !result.diff) continue;
          const stat = countDiffStat(result.diff);
          out.push({ relativePath: pending.path, status: pending.existed ? "modified" : "deleted", ...stat, patch: result.diff.slice(0, 8000) });
        } catch { /* denied/unsafe entries never become diff inputs */ }
        finally { pending?.close(); }
      }
    });
  } catch { /* fixed empty refusal; no raw subprocess/filesystem errors */ }
  return out;
}

function decodeStatus(code: string): GitFileStatus {
  if (code === "??") return "untracked";
  if (code === "!!") return "ignored";
  const x = code[0];
  const y = code[1];
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "M" || y === "M") return "modified";
  return "unknown";
}

function splitPatches(diff: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!diff) return map;
  const parts = diff.split(/^diff --git /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const m = /^a\/(.+?) b\/(.+)$/m.exec(part);
    const path = (m?.[2] ?? m?.[1] ?? "").replace(/\\/g, "/");
    if (path) map.set(path, `diff --git ${part}`.slice(0, 8_000));
  }
  return map;
}

export function countDiffStat(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}
