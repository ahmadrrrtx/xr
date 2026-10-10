/**
 * XR — search_code: read-only text search inside the working directory.
 *
 * Uses ripgrep when it is installed (it honors .gitignore natively). Without
 * it, falls back to a bounded in-process scan that skips VCS and dependency
 * folders. Read-only, so it never requires approval.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";
import { readTrustRequest } from "../runtime/trust/tool-support.ts";

const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 1_000_000;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", "target", ".venv", "__pycache__"]);

function within(cwd: string, p: string): string | null {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

function rgAvailable(): boolean {
  const res = spawnSync("rg", ["--version"], { encoding: "utf8", timeout: 2000 });
  return res.status === 0;
}

function viaRipgrep(pattern: string, dir: string, include: string | undefined, cwd: string): string[] {
  const args = ["--line-number", "--no-heading", "--color", "never", "--max-count", "20", "--max-columns", "300", "-e", pattern];
  if (include) args.push("--glob", include);
  args.push(dir);
  const res = spawnSync("rg", args, { cwd, encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  if (res.status === null) return ["(search timed out)"];
  if (res.status === 1) return [];
  if (res.status !== 0) return [`(rg error: ${String(res.stderr).trim().split("\n")[0]})`];
  return res.stdout.split("\n").filter(Boolean).slice(0, MAX_MATCHES);
}

function viaScan(pattern: string, dir: string, include: string | undefined, cwd: string): string[] {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  const incRe = include ? new RegExp(include.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$") : null;
  const out: string[] = [];
  const walk = (current: string): void => {
    if (out.length >= MAX_MATCHES) return;
    let entries: string[];
    try {
      entries = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= MAX_MATCHES) return;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(current, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      if (incRe && !incRe.test(name)) continue;
      let text: string;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (text.includes("\u0000")) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && out.length < MAX_MATCHES; i++) {
        if (re.test(lines[i]!)) {
          out.push(`${relative(cwd, full).split(sep).join("/")}:${i + 1}:${lines[i]!.slice(0, 300)}`);
        }
      }
    }
  };
  walk(dir);
  return out;
}

export const searchCodeTool: Tool = {
  name: "search_code",
  description:
    "Search file contents in the working directory for a regex pattern. Returns matching lines as path:line:text. Optional `path` (directory or file) and `include` (filename glob such as *.ts).",
  parameters: {
    pattern: "string (regex)",
    path: "string (optional, relative directory or file)",
    include: "string (optional, filename glob)",
  },
  requiresApproval: false,
  trustRequest: (_args, ctx: ToolContext) => readTrustRequest("search_code", ctx.cwd),
  async run(args, ctx): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "").trim();
    if (!pattern) return { ok: false, output: "search_code requires a non-empty `pattern`" };
    const dir = within(ctx.cwd, String(args.path ?? ".") || ".");
    if (!dir) return { ok: false, output: `path escapes working directory: ${String(args.path)}` };
    const include = typeof args.include === "string" && args.include ? args.include : undefined;
    const lines = rgAvailable() ? viaRipgrep(pattern, dir, include, ctx.cwd) : viaScan(pattern, dir, include, ctx.cwd);
    ctx.audit("search_code", { pattern: pattern.slice(0, 80), matches: lines.length });
    if (lines.length === 0) return { ok: true, output: "no matches" };
    return {
      ok: true,
      output: lines.join("\n") + (lines.length >= MAX_MATCHES ? `\n…(capped at ${MAX_MATCHES} matches)` : ""),
      data: { matches: lines.length },
    };
  },
};
