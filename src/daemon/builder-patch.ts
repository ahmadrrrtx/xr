/**
 * Phase 17 · Builder — pure unified-diff application.
 *
 * The chat asks the model for unified diffs, the human reviews them hunk by
 * hunk, and ONLY then does the engine touch the file. Model-written diffs are
 * rarely byte-exact: line numbers drift, counts are wrong, trailing
 * whitespace differs. This applier therefore matches on CONTENT, not on the
 * `@@` numbers:
 *
 *   1. exact match at the hinted line (old start, shifted by earlier hunks);
 *   2. exact match searched outward from the hint (closest first);
 *   3. whitespace-insensitive match (trim both sides) searched the same way;
 *   4. otherwise the hunk is a CONFLICT and nothing from this patch is written
 *      — the caller gets the reasons and the user resolves it by hand.
 *
 * Deterministic, synchronous, no I/O: the routes own the approval and the
 * backup; tests exercise this module directly.
 */

import { parseUnifiedDiff, type DiffHunk } from "./hunks.ts";

export interface HunkConflict {
  index: number;
  header: string;
  reason: string;
}

export interface ApplyResult {
  ok: boolean;
  content: string;
  /** Hunks that were applied (in file order). */
  applied: number[];
  /** Hunks skipped because the caller did not select them. */
  skipped: number[];
  /** Hunks that could not be placed; `ok=false` when non-empty. */
  conflicts: HunkConflict[];
  /** Fuzz: how many hunks needed an offset or whitespace-insensitive match. */
  fuzzy: number;
}

const NO_NEWLINE = "\\ No newline at end of file";

/**
 * Normalise the loose diffs language models write: a bare `@@ … @@` header
 * without numbers becomes a hint at line 1 (content matching finds the
 * real spot), CRLF becomes LF, and a leading fenced-code wrapper is dropped.
 */
export function normalisePatch(patch: string): string {
  let text = patch.replace(/\r\n/g, "\n");
  text = text.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```\s*$/, "\n");
  const rows = text.split("\n");
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? "";
    if (row.startsWith("@@") && !/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(row)) {
      const tail = row.replace(/^@@+\s*(?:[^@]*@@)?/, "").trim();
      rows[i] = `@@ -1,0 +1,0 @@${tail ? ` ${tail}` : ""}`;
    }
  }
  return rows.join("\n");
}

function splitLines(content: string): { lines: string[]; trailingNewline: boolean } {
  if (content === "") return { lines: [], trailingNewline: true };
  const trailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

type Op = { kind: "ctx" | "del" | "add"; text: string };

interface HunkBody {
  ops: Op[];
  /** Lines the hunk expects to find (context + deletions), in order. */
  before: string[];
  /** The hunk ends with "\ No newline" after a + line → file loses its trailing newline. */
  stripsTrailingNewline: boolean;
  /** The hunk removes a last line that had no newline → file gains one. */
  addsTrailingNewline: boolean;
}

function hunkBody(h: DiffHunk): HunkBody {
  const ops: Op[] = [];
  let stripsTrailingNewline = false;
  let addsTrailingNewline = false;
  let last: Op["kind"] | null = null;
  for (const raw of h.lines) {
    if (raw.startsWith(NO_NEWLINE)) {
      if (last === "add" || last === "ctx") stripsTrailingNewline = true;
      if (last === "del") addsTrailingNewline = true;
      continue;
    }
    const tag = raw[0];
    const text = raw.slice(1);
    if (tag === "+") ops.push({ kind: "add", text });
    else if (tag === "-") ops.push({ kind: "del", text });
    // An empty row inside a hunk is a blank context line whose leading
    // space was trimmed by an editor or a model; unknown prefixes are
    // treated as context — safer than silently dropping them.
    else if (tag === " " || raw === "") ops.push({ kind: "ctx", text });
    else ops.push({ kind: "ctx", text: raw });
    last = ops[ops.length - 1]?.kind ?? null;
  }
  if (stripsTrailingNewline && addsTrailingNewline) {
    stripsTrailingNewline = false;
    addsTrailingNewline = false;
  }
  return { ops, before: ops.filter((o) => o.kind !== "add").map((o) => o.text), stripsTrailingNewline, addsTrailingNewline };
}

function matchesAt(lines: string[], at: number, before: string[], loose: boolean): boolean {
  if (at < 0 || at + before.length > lines.length) return false;
  for (let i = 0; i < before.length; i += 1) {
    const a = lines[at + i] ?? "";
    const b = before[i] ?? "";
    if (loose ? a.trim() !== b.trim() : a !== b) return false;
  }
  return true;
}

/** Closest-first search around `hint` over the whole file; returns the index or -1. */
function locate(lines: string[], before: string[], hint: number, loose: boolean): number {
  const start = Math.min(Math.max(0, hint), lines.length);
  const limit = Math.max(start, lines.length - start);
  for (let d = 0; d <= limit; d += 1) {
    if (matchesAt(lines, start + d, before, loose)) return start + d;
    if (d > 0 && matchesAt(lines, start - d, before, loose)) return start - d;
  }
  return -1;
}

/**
 * Rebuild the replaced region: context lines come from the FILE (so a
 * whitespace-insensitive match never rewrites indentation), deletions are
 * dropped, additions come from the patch.
 */
function rebuild(lines: string[], at: number, ops: Op[]): string[] {
  const out: string[] = [];
  let cursor = at;
  for (const op of ops) {
    if (op.kind === "add") out.push(op.text);
    else {
      if (op.kind === "ctx") out.push(lines[cursor] ?? op.text);
      cursor += 1;
    }
  }
  return out;
}

/**
 * Apply the selected hunks of ONE file's unified diff to `content`.
 * `selected` = 0-based hunk indexes (undefined → all hunks).
 */
export function applyUnifiedDiff(content: string, patch: string, selected?: ReadonlyArray<number>): ApplyResult {
  const parsed = parseUnifiedDiff(normalisePatch(patch));
  const { lines: original, trailingNewline } = splitLines(content);
  let lines = original.slice();
  let endsWithNewline = trailingNewline;
  const applied: number[] = [];
  const skipped: number[] = [];
  const conflicts: HunkConflict[] = [];
  let fuzzy = 0;
  let delta = 0; // lines added so far by earlier hunks

  if (parsed.hunks.length === 0) {
    return { ok: false, content, applied, skipped, conflicts: [{ index: -1, header: "", reason: "no hunks found in the patch" }], fuzzy };
  }

  const wanted = selected ? new Set(selected) : null;
  for (const h of parsed.hunks) {
    if (wanted && !wanted.has(h.index)) {
      skipped.push(h.index);
      continue;
    }
    const body = hunkBody(h);
    const hint = Math.max(0, h.oldStart - 1 + delta);

    let at: number;
    if (body.before.length === 0) {
      // Pure insertion: at the hinted line (clamped). A model that omits all
      // context is asking for an append when the hint is past the end.
      at = Math.min(hint, lines.length);
    } else {
      at = matchesAt(lines, hint, body.before, false) ? hint : -1;
      if (at < 0) {
        at = locate(lines, body.before, hint, false);
        if (at >= 0) fuzzy += 1;
      }
      if (at < 0) {
        at = locate(lines, body.before, hint, true);
        if (at >= 0) fuzzy += 1;
      }
    }
    if (at < 0) {
      const first = body.before.find((l) => l.trim().length > 0) ?? body.before[0] ?? "";
      conflicts.push({
        index: h.index,
        header: h.header,
        reason: `context not found near line ${h.oldStart}: "${first.slice(0, 80)}"`,
      });
      continue;
    }
    const replacement = rebuild(lines, at, body.ops);
    lines = [...lines.slice(0, at), ...replacement, ...lines.slice(at + body.before.length)];
    delta += replacement.length - body.before.length;
    if (body.stripsTrailingNewline && at + replacement.length >= lines.length) endsWithNewline = false;
    if (body.addsTrailingNewline) endsWithNewline = true;
    applied.push(h.index);
  }

  if (conflicts.length > 0) {
    return { ok: false, content, applied: [], skipped, conflicts, fuzzy };
  }
  const next = lines.length === 0 ? "" : lines.join("\n") + (endsWithNewline ? "\n" : "");
  return { ok: true, content: next, applied, skipped, conflicts, fuzzy };
}

/** Human-readable conflict line for approvals / errors. */
export function describeConflicts(conflicts: ReadonlyArray<HunkConflict>): string {
  return conflicts.map((c) => (c.index >= 0 ? `hunk ${c.index + 1}: ${c.reason}` : c.reason)).join("; ");
}
