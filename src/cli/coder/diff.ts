/**
 * Phase 23 — line diff for the coding agent's approval previews.
 *
 * Common prefix/suffix are trimmed first, then an LCS over the changed middle
 * (bounded: past the cap we show the middle as a full replacement, which is still
 * correct, just less minimal). Output is git-style unified hunks.
 */
import type { Painter } from "./ansi.ts";

export type DiffOp = { t: " " | "+" | "-"; line: string };

const LCS_CELL_CAP = 4_000_000;

export function lineDiff(oldText: string, newText: string): DiffOp[] {
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");

  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);
  const ops: DiffOp[] = [];
  for (let i = 0; i < pre; i++) ops.push({ t: " ", line: a[i]! });

  if (midA.length * midB.length > LCS_CELL_CAP) {
    for (const l of midA) ops.push({ t: "-", line: l });
    for (const l of midB) ops.push({ t: "+", line: l });
  } else {
    ops.push(...lcsOps(midA, midB));
  }

  for (let i = a.length - suf; i < a.length; i++) ops.push({ t: " ", line: a[i]! });
  return ops;
}

function lcsOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: " ", line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ t: "-", line: a[i]! });
      i++;
    } else {
      out.push({ t: "+", line: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ t: "-", line: a[i++]! });
  while (j < m) out.push({ t: "+", line: b[j++]! });
  return out;
}

export function diffStat(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.t === "+") added++;
    else if (o.t === "-") removed++;
  }
  return { added, removed };
}

/**
 * Unified diff text with `context` lines around each change. Returns "" when
 * nothing changed.
 */
export function unifiedDiff(path: string, ops: DiffOp[], context = 3): string {
  if (!ops.some((o) => o.t !== " ")) return "";
  // Mark which op indices are within `context` of a change.
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, idx) => {
    if (o.t === " ") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });

  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  let oldLine = 1;
  let newLine = 1;
  let idx = 0;
  while (idx < ops.length) {
    if (!keep[idx]) {
      if (ops[idx]!.t !== "+") oldLine++;
      if (ops[idx]!.t !== "-") newLine++;
      idx++;
      continue;
    }
    // Hunk: consecutive kept ops.
    const start = idx;
    while (idx < ops.length && keep[idx]) idx++;
    const hunk = ops.slice(start, idx);
    const oldCount = hunk.filter((o) => o.t !== "+").length;
    const newCount = hunk.filter((o) => o.t !== "-").length;
    lines.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`);
    for (const o of hunk) lines.push(`${o.t}${o.line}`);
    for (const o of hunk) {
      if (o.t !== "+") oldLine++;
      if (o.t !== "-") newLine++;
    }
  }
  return lines.join("\n");
}

/** Colourise unified diff text the way `git diff` does (green +, red -, cyan @@). */
export function colorizeDiff(text: string, p: Painter): string {
  return text
    .split("\n")
    .map((l) => {
      if (l.startsWith("+++") || l.startsWith("---")) return p.bold(l);
      if (l.startsWith("@@")) return p.cyan(l);
      if (l.startsWith("+")) return p.green(l);
      if (l.startsWith("-")) return p.red(l);
      return l;
    })
    .join("\n");
}
