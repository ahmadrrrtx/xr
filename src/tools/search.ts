/**
 * XR — search_code: read-only code search inside the working tree.
 *
 * Phase 23 (CLI coding agent). Uses ripgrep when it is installed; otherwise a
 * bounded in-process walk. Never writes, never executes a shell, never leaves
 * the working directory, and skips the usual generated/vendored trees. It needs
 * no approval because it is read-only — the same class as read_file / list_dir.
 */
import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import { join, relative, resolve, isAbsolute, sep } from "node:path";
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";

const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 300;
const MAX_FILE_BYTES = 1_000_000;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "target", "coverage", ".next", ".turbo", ".cache", "__pycache__", ".venv"]);

/** Resolve `p` against cwd; null when it would escape the working directory. */
function insideCwd(cwd: string, p: string): string | null {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

interface Match {
  file: string;
  line: number;
  text: string;
}

function run(cmd: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((done) => {
    execFile(cmd, args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 15_000 }, (err, stdout) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? ((err as unknown as { code: number }).code) : err ? null : 0;
      done({ code, stdout: String(stdout ?? "") });
    });
  });
}

async function rgSearch(pattern: string, base: string, cwd: string, include?: string): Promise<Match[] | null> {
  const args = ["--line-number", "--no-heading", "--color", "never", "--max-count", "5", "--max-columns", String(MAX_LINE_CHARS), "--max-columns-preview", "--", pattern, base];
  if (include) args.unshift(`--glob=${include}`);
  const res = await run("rg", args, cwd).catch(() => null);
  if (!res) return null;
  // rg exits 1 when nothing matched, 2 on a real error. Treat 2 as "unavailable".
  if (res.code === 2) return null;
  const out: Match[] = [];
  for (const line of res.stdout.split("\n")) {
    const m = /^(.*?):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    out.push({ file: relative(cwd, resolve(cwd, m[1]!)), line: Number(m[2]), text: m[3]!.trim().slice(0, MAX_LINE_CHARS) });
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

async function walkSearch(re: RegExp, base: string, cwd: string, include?: RegExp): Promise<Match[]> {
  const out: Match[] = [];
  const stack = [base];
  while (stack.length && out.length < MAX_MATCHES) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= MAX_MATCHES) break;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = relative(cwd, full).split(sep).join("/");
      if (include && !include.test(rel)) continue;
      let st;
      try {
        st = await fsp.stat(full);
      } catch {
        continue;
      }
      if (st.size > MAX_FILE_BYTES) continue;
      let text: string;
      try {
        text = await fsp.readFile(full, "utf8");
      } catch {
        continue;
      }
      if (text.includes("\u0000")) continue; // binary
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && out.length < MAX_MATCHES; i++) {
        if (re.test(lines[i]!)) {
          out.push({ file: rel, line: i + 1, text: lines[i]!.trim().slice(0, MAX_LINE_CHARS) });
        }
        re.lastIndex = 0;
      }
    }
  }
  return out;
}

/** Convert a simple glob (`*.ts`, `src/**\/*.tsx`) to a RegExp over relative paths. */
function globToRegExp(glob: string): RegExp {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`(?:^|/)${esc}$`);
}

export const searchCodeTool: Tool = {
  name: "search_code",
  description:
    "Search file contents under the working directory for a regular expression. Read-only. Returns file:line matches (max 100). Optional `path` (dir or file) and `include` (glob such as *.ts).",
  parameters: {
    pattern: "string (regular expression)",
    path: "string (optional, relative dir or file, default '.')",
    include: "string (optional glob, e.g. *.ts or src/**/*.tsx)",
  },
  requiresApproval: false,
  async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "").trim();
    if (!pattern) return { ok: false, output: "search_code requires a non-empty `pattern`" };
    const base = insideCwd(ctx.cwd, String(args.path ?? "."));
    if (!base) return { ok: false, output: `path escapes working directory: ${String(args.path)}` };
    const include = args.include ? String(args.include) : undefined;

    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (err) {
      return { ok: false, output: `invalid pattern: ${(err as Error).message}` };
    }

    const viaRg = await rgSearch(pattern, base, ctx.cwd, include);
    const matches = viaRg ?? (await walkSearch(re, base, ctx.cwd, include ? globToRegExp(include) : undefined));
    ctx.audit("search_code", { pattern: pattern.slice(0, 200), path: String(args.path ?? "."), matches: matches.length, engine: viaRg ? "rg" : "builtin" });

    if (matches.length === 0) return { ok: true, output: "(no matches)", data: { count: 0 } };
    const body = matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n");
    const capped = matches.length >= MAX_MATCHES ? `${body}\n… (stopped at ${MAX_MATCHES} matches)` : body;
    return { ok: true, output: capped, data: { count: matches.length } };
  },
};
