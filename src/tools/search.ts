/** Search ONLY authorized bounded snapshots. ripgrep never receives a workspace path. */
import { spawnSync } from "node:child_process";
import type { Tool, ToolResult } from "../core/types.ts";
import { FilesystemAuthority, filesystemMessage } from "../security/filesystem.ts";
import { filesystemReason } from "../core/tool-reasons.ts";
import { readTrustRequest } from "../runtime/trust/tool-support.ts";
const MAX_MATCHES = 200, MAX_FILE_BYTES = 1_000_000, MAX_TOTAL_BYTES = 16_000_000;
const SKIP = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", "target", ".venv", "__pycache__"]);
const rgEnv = () => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" });
function glob(pattern: string): RegExp {
  return new RegExp(pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
}
function ignored(fs: FilesystemAuthority): RegExp[] {
  const out: RegExp[] = [];
  for (const name of [".gitignore", ".xrignore"]) {
    try {
      for (const line of fs.read(name, 32_000).content.split("\n")) {
        const p = line.trim();
        if (!p || p.startsWith("#") || p.startsWith("!")) continue;
        out.push(glob(p.replace(/^\//, "").replace(/\/$/, "") + (p.endsWith("/") ? "/*" : "")));
      }
    } catch { /* ergonomic filtering, never authorization */ }
  }
  return out;
}
export const searchCodeTool: Tool = {
  name: "search_code",
  description: "Search file contents in the working directory for a regex pattern. Returns matching lines as path:line:text. Optional `path` (directory or file) and `include` (filename glob such as *.ts).",
  parameters: { pattern: "string (regex)", path: "string (optional, relative directory or file)", include: "string (optional, filename glob)" },
  requiresApproval: false,
  trustRequest: (_args, ctx) => readTrustRequest("search_code", ctx.cwd),
  async run(args, ctx): Promise<ToolResult> {
    if (typeof args.pattern !== "string" || !args.pattern.trim()) return { ok: false, output: "search_code requires a non-empty `pattern`" };
    let fs: FilesystemAuthority | undefined;
    try {
      fs = ctx.filesystem ?? new FilesystemAuthority(ctx.cwd);
      const root = typeof args.path === "string" && args.path ? args.path : ".";
      const include = typeof args.include === "string" ? glob(args.include) : undefined;
      const exclusions = ignored(fs);
      const available = spawnSync("rg", ["--no-config", "--version"], { env: rgEnv(), encoding: "utf8", timeout: 2000 }).status === 0;
      let re: RegExp;
      try { re = new RegExp(args.pattern); } catch { re = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); }
      const out: string[] = [];
      let bytes = 0;
      for (const entry of fs.walk(root, SKIP, 5000)) {
        if (out.length >= MAX_MATCHES || bytes >= MAX_TOTAL_BYTES) break;
        if (entry.size > MAX_FILE_BYTES || (include && !include.test(entry.path)) || exclusions.some(r => r.test(entry.path))) continue;
        let content: string;
        try { content = fs.read(entry.path, MAX_FILE_BYTES).content; } catch { continue; }
        bytes += Buffer.byteLength(content);
        if (available) {
          // stdin snapshot means --follow/hidden/files-from/ambient config cannot redirect I/O.
          const result = spawnSync("rg", ["--no-config", "--json", "--color=never", "--max-count=20", "-e", args.pattern, "-"], { env: rgEnv(), input: content, encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
          if (result.status !== 0 && result.status !== 1) return { ok: false, output: "search failed (bounded ripgrep operation)" };
          for (const line of result.stdout.split("\n")) {
            if (!line || out.length >= MAX_MATCHES) continue;
            const item = JSON.parse(line) as { type: string; data: { line_number: number; lines: { text: string } } };
            if (item.type === "match") out.push(`${entry.path}:${item.data.line_number}:${item.data.lines.text.replace(/\r?\n$/, "").slice(0, 300)}`);
          }
        } else {
          const lines = content.split("\n");
          let count = 0;
          for (let i = 0; i < lines.length && count < 20 && out.length < MAX_MATCHES; i++) {
            if (re.test(lines[i]!)) { out.push(`${entry.path}:${i + 1}:${lines[i]!.slice(0, 300)}`); count++; }
          }
        }
      }
      ctx.audit("search_code", { path: root, matches: out.length, engine: available ? "ripgrep" : "js", authority: fs.descriptor() });
      return { ok: true, output: out.join("\n") || "(no matches)", data: { matches: out.length, engine: available ? "ripgrep" : "js" } };
    } catch (e) { return { ok: false, output: filesystemMessage(e), reason: filesystemReason(e) }; }
    finally { if (fs && fs !== ctx.filesystem) fs.close(); }
  },
};
