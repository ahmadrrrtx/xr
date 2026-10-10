/**
 * Line diff for the coder CLI — unified output in the style of `git diff`.
 *
 * LCS-based, bounded: inputs above MAX_CELLS fall back to a single full-file
 * hunk so a huge file can never spend unbounded CPU or memory (Art. XII·3).
 */

import { style } from "./style.ts";

const MAX_CELLS = 4_000_000;

type Op = { kind: " " | "-" | "+"; line: string };

function ops(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [...a.map((line) => ({ kind: "-" as const, line })), ...b.map((line) => ({ kind: "+" as const, line }))];
  }
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: " ", line: a[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      out.push({ kind: "-", line: a[i]! });
      i++;
    } else {
      out.push({ kind: "+", line: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: "-", line: a[i++]! });
  while (j < m) out.push({ kind: "+", line: b[j++]! });
  return out;
}

export interface DiffStats {
  added: number;
  removed: number;
}

/** Unified diff with `context` lines around each change. Empty string = no change. */
export function unifiedDiff(oldText: string, newText: string, path: string, context = 3): string {
  if (oldText === newText) return "";
  // A trailing newline terminates the last line; it does not start a new one.
  const splitText = (t: string): string[] => (t === "" ? [] : t.replace(/\n$/, "").split("\n"));
  const a = splitText(oldText);
  const b = splitText(newText);
  const all = ops(a, b);

  // Position of each op in the old/new files (1-based line numbers).
  const pos: Array<{ oldNo: number; newNo: number }> = [];
  let oldNo = 1;
  let newNo = 1;
  for (const op of all) {
    pos.push({ oldNo, newNo });
    if (op.kind !== "+") oldNo++;
    if (op.kind !== "-") newNo++;
  }

  // Group changed indices into hunks, merging when context windows touch.
  const changed = all.map((op, idx) => (op.kind !== " " ? idx : -1)).filter((idx) => idx >= 0);
  if (changed.length === 0) return "";
  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, changed[0]! - context);
  let end = Math.min(all.length - 1, changed[0]! + context);
  for (const idx of changed.slice(1)) {
    if (idx - context <= end + 1) {
      end = Math.min(all.length - 1, idx + context);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, idx - context);
      end = Math.min(all.length - 1, idx + context);
    }
  }
  ranges.push([start, end]);

  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const [s, e] of ranges) {
    const slice = all.slice(s, e + 1);
    const oldCount = slice.filter((o) => o.kind !== "+").length;
    const newCount = slice.filter((o) => o.kind !== "-").length;
    const oldStart = oldCount === 0 ? pos[s]!.oldNo - 1 : pos[s]!.oldNo;
    const newStart = newCount === 0 ? pos[s]!.newNo - 1 : pos[s]!.newNo;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) lines.push(`${op.kind}${op.line}`);
  }
  return lines.join("\n");
}

export function diffStats(diff: string): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

/** Colorize a unified diff: green additions, red removals, cyan hunks. */
export function colorizeDiff(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return style.bold(line);
      if (line.startsWith("@@")) return style.cyan(line);
      if (line.startsWith("+")) return style.green(line);
      if (line.startsWith("-")) return style.red(line);
      return style.dim(line);
    })
    .join("\n");
}
