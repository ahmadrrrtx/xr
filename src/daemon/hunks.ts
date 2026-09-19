/**
 * XR Daemon — unified-diff hunks with stable ids (Phase 2 · G-06).
 *
 * The desktop editor reviews an agent's change hunk by hunk: keep this one,
 * throw that one away. The engine already computes the truth (`git diff`);
 * this module gives every hunk an identity a client can hold across
 * re-renders and builds the exact patch `git apply -R` needs to revert a
 * chosen subset. Nothing here touches the disk — the route owns consent,
 * scope and the write.
 *
 * Hunk ids are content-addressed: sha256 over the OLD-side start line and the
 * hunk body. They survive reverting a *different* hunk of the same file (the
 * working copy's line numbers shift, the hunk's content and its position in
 * the committed side do not), and they change when the hunk's content
 * changes — which is precisely when a client's stale id must be refused.
 */

import { createHash } from "node:crypto";

export interface DiffHunk {
  /** Content-addressed id (12 hex chars). */
  id: string;
  /** 0-based position in the file's diff. */
  index: number;
  /** The `@@ -a,b +c,d @@ …` line exactly as git printed it. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Body lines including their leading ' ', '+', '-' or '\' marker. */
  lines: string[];
  added: number;
  removed: number;
}

export interface ParsedFileDiff {
  /** Everything before the first hunk (`diff --git`, `index`, `---`, `+++`, mode lines). */
  fileHeader: string[];
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function hunkId(oldStart: number, lines: string[]): string {
  return createHash("sha256").update(`${oldStart}\n${lines.join("\n")}`).digest("hex").slice(0, 12);
}

/** Parse ONE file's unified diff (what `git diff -- <path>` prints). */
export function parseUnifiedDiff(diff: string): ParsedFileDiff {
  const fileHeader: string[] = [];
  const hunks: DiffHunk[] = [];
  if (!diff.trim()) return { fileHeader, hunks };
  const rows = diff.split("\n");
  if (rows.length && rows[rows.length - 1] === "") rows.pop();
  let current: (Omit<DiffHunk, "id"> & { id?: string }) | null = null;
  for (const row of rows) {
    const m = HUNK_RE.exec(row);
    if (m) {
      if (current) hunks.push(finish(current));
      current = {
        index: hunks.length,
        header: row,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
        added: 0,
        removed: 0,
      };
      continue;
    }
    if (!current) {
      fileHeader.push(row);
      continue;
    }
    current.lines.push(row);
    if (row.startsWith("+")) current.added += 1;
    else if (row.startsWith("-")) current.removed += 1;
  }
  if (current) hunks.push(finish(current));
  return { fileHeader, hunks };
}

function finish(h: Omit<DiffHunk, "id"> & { id?: string }): DiffHunk {
  return { ...h, id: hunkId(h.oldStart, h.lines) } as DiffHunk;
}

/**
 * The patch text for a subset of hunks — the original file header followed
 * by the chosen hunks in file order, so `git apply -R` (or `git apply`) sees
 * a well-formed single-file patch. Hunk positions stay valid for a subset:
 * every `@@` position is relative to the ORIGINAL sides and git tracks the
 * cumulative offset while applying.
 */
export function buildHunkPatch(parsed: ParsedFileDiff, selected: ReadonlyArray<DiffHunk>): string {
  const ordered = [...selected].sort((a, b) => a.index - b.index);
  const out = [...parsed.fileHeader];
  for (const h of ordered) {
    out.push(h.header, ...h.lines);
  }
  return `${out.join("\n")}\n`;
}

/** Public shape for the API (no body lines duplication beyond what the UI needs). */
export function hunkSummary(h: DiffHunk): {
  id: string;
  index: number;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  added: number;
  removed: number;
  lines: string[];
} {
  return {
    id: h.id,
    index: h.index,
    header: h.header,
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    added: h.added,
    removed: h.removed,
    lines: h.lines,
  };
}
