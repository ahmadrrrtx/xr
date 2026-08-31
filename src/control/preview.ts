/**
 * XR Phase 2 · F-26 — Structured approval previews.
 *
 * The consent plane shows DATA, not model prose: file writes/deletes render
 * as unified diffs (or "new file" heads), shell commands render as an
 * interpreted breakdown (binary resolution via the existing exec-integrity
 * path + an args table), and everything else renders as a redacted argument
 * view. The model-shaped `reason` text is carried as an explicitly UNTRUSTED
 * field — surfaces must frame it as data, never as the authority the human
 * approves.
 *
 * Redaction: secret-shaped keys/values are masked before a preview is ever
 * shown, in every renderer, on every surface.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { resolveShellCommandIdentity } from "../security/exec-integrity.ts";
// Phase 2 · F-26 — the canonical preview types live in the kernel layer so
// every layer can reference them without an upward import; this module
// renders them and re-exports for convenience.
export type { PreviewKind, PreviewSection, StructuredPreview } from "../core/types.ts";
import type { PreviewSection, StructuredPreview } from "../core/types.ts";

/** Tools that write files (by bare or qualified name). */
const WRITE_TOOLS = new Set([
  "write_file", "files.write", "write", "edit_file", "patch", "create_file", "save_file",
]);
/** Tools that delete paths. */
const DELETE_TOOLS = new Set([
  "delete_file", "files.delete", "delete", "rm", "remove_file", "unlink",
]);
/** Tools that execute a shell command. */
const SHELL_TOOLS = new Set([
  "shell", "exec", "bash", "run_command", "system.exec", "command",
]);

const MAX_DIFF_LINES = 240;
const MAX_DIFF_CHARS = 24_000;
const MAX_GENERIC_BYTES = 16_000;

const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|passwd|authorization|credential|private[_-]?key)/i;
const SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g;

/** Redact secret-shaped values from any preview text. */
export function redactPreviewText(text: string): string {
  let out = text;
  out = out.replace(SECRET_VALUE_RE, "***");
  out = out.replace(/(["']?\w*(?:api[_-]?key|token|secret|password)\w*["']?\s*[:=]\s*["']?)([^"'\s,}]{4,})(["']?)/gi, "$1***$3");
  return out;
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = "***";
    } else if (typeof v === "string") {
      out[k] = redactPreviewText(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Simple O(n*m) line diff (good enough for bounded previews). */
function unifiedDiffLines(oldLines: string[], newLines: string[]): string[] {
  // LCS table, then walk back emitting +/-/context rows. Capped input keeps
  // the DP cheap: MAX_DIFF_LINES² is bounded.
  const n = oldLines.length;
  const m = newLines.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = oldLines[i] === newLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const rows: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push(` ${oldLines[i]}`);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push(`-${oldLines[i]}`);
      i++;
    } else {
      rows.push(`+${newLines[j]}`);
      j++;
    }
  }
  while (i < n) rows.push(`-${oldLines[i++]}`);
  while (j < m) rows.push(`+${newLines[j++]}`);
  return rows;
}

function clampSection(body: string, maxLines: number, maxChars: number): { body: string; truncated: boolean } {
  let lines = body.split("\n");
  let truncated = false;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
  }
  let out = lines.join("\n");
  if (out.length > maxChars) {
    out = out.slice(0, maxChars);
    truncated = true;
  }
  return { body: out, truncated };
}

function extractPath(args: Record<string, unknown>): string | null {
  const p = args.path ?? args.file ?? args.filePath ?? args.filename ?? args.target;
  return typeof p === "string" ? p : null;
}

function extractContent(args: Record<string, unknown>): string | null {
  const c = args.content ?? args.text ?? args.data ?? args.body;
  return typeof c === "string" ? c : null;
}

function extractCommand(args: Record<string, unknown>): string | null {
  const c = args.command ?? args.cmd ?? args.script ?? args.cmdline;
  if (typeof c === "string") return c;
  if (Array.isArray(args.argv)) {
    try {
      return (args.argv as unknown[]).map((a) => String(a)).join(" ");
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Interpret a shell command into a structured breakdown:
 * binary resolution (interpreter + directly-invoked executables → resolved
 * path → canonical realpath → content hash) via the exec-integrity layer +
 * a positional args table. Never executes anything.
 */
export function interpretCommand(command: string, cwd: string): PreviewSection[] {
  const identity = resolveShellCommandIdentity(command, cwd);
  const sections: PreviewSection[] = [];
  const fmtIdentity = (label: string, id: { token: string; resolved?: string; canonical?: string; hash?: string; error?: string } | null | undefined): string | null => {
    if (!id) return null;
    return [
      `${label} token    : ${id.token}`,
      id.resolved ? `${label} resolved : ${id.resolved}` : `${label} resolved : (not found on PATH)`,
      id.canonical && id.canonical !== id.resolved ? `${label} canonical: ${id.canonical}` : null,
      id.hash ? `${label} sha256   : ${id.hash}` : null,
      id.error ? `${label} error    : ${id.error}` : null,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");
  };

  const parts: string[] = [];
  const interp = fmtIdentity("interp ", identity.interpreter);
  if (interp) parts.push(interp);
  identity.direct.forEach((d, i) => {
    const block = fmtIdentity(`direct${i}`, d);
    if (block) parts.push(block);
  });
  if (parts.length === 0) {
    parts.push("no executable could be resolved statically (shell-builtin / pipeline / dynamic command)");
  }
  sections.push({ title: "binary", body: parts.join("\n"), kind: "code" });

  const tokens = splitShellTokens(command);
  if (tokens.length > 1) {
    const rows = tokens.slice(1).map((t, i) => `${String(i + 1).padStart(2)} │ ${redactPreviewText(t)}`);
    const body = rows.join("\n");
    const clamped = clampSection(body, 60, 6000);
    sections.push({ title: `arguments (${tokens.length - 1})`, body: clamped.body, kind: "table", truncated: clamped.truncated });
  }
  return sections;
}

/** Minimal shell tokenizer for preview purposes (quotes respected; no exec). */
function splitShellTokens(cmd: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inS = false;
  let inD = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (inS) {
      if (ch === "'") inS = false;
      else cur += ch;
    } else if (inD) {
      if (ch === '"') inD = false;
      else cur += ch;
    } else if (ch === "'") inS = true;
    else if (ch === '"') inD = true;
    else if (ch === " " || ch === "\t" || ch === "\n") {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/**
 * The one entry point: build a structured preview for an approval request.
 * `riskTier` comes from the capability metadata (never from the model).
 */
export function buildStructuredPreview(req: {
  tool: string;
  args?: Record<string, unknown>;
  reason: string;
  cwd: string;
  riskTier?: string;
}): StructuredPreview {
  const args = redactArgs(req.args ?? {});
  const base = {
    tool: req.tool,
    riskTier: req.riskTier ?? "unknown",
    untrustedReason: redactPreviewText(req.reason),
  };

  if (WRITE_TOOLS.has(req.tool)) {
    const path = extractPath(args);
    const content = extractContent(args);
    const target = path ? resolve(req.cwd, path) : null;
    const sections: PreviewSection[] = [];
    sections.push({ title: "path", body: target ?? (path ?? "(no path in args)"), kind: "text" });
    if (content === null) {
      sections.push({ title: "content", body: "(no content field — args redacted)", kind: "text" });
    } else if (target && existsSync(target)) {
      try {
        const oldText = readFileSync(target, "utf8");
        const oldLines = oldText.split("\n").slice(0, MAX_DIFF_LINES);
        const newLines = content.split("\n").slice(0, MAX_DIFF_LINES);
        const diff = unifiedDiffLines(oldLines, newLines);
        const clamped = clampSection(diff.join("\n"), MAX_DIFF_LINES, MAX_DIFF_CHARS);
        sections.push({
          title: `unified diff (${basename(target)}, ${oldLines.length} → ${newLines.length} lines)`,
          body: clamped.body,
          kind: "code",
          truncated: clamped.truncated,
        });
      } catch {
        sections.push({ title: "content", body: "(existing file unreadable — diff unavailable)", kind: "text" });
      }
    } else {
      const clamped = clampSection(content, 60, 6000);
      sections.push({
        title: "new file content (file does not exist yet)",
        body: clamped.body,
        kind: "code",
        truncated: clamped.truncated,
      });
    }
    return { kind: target && existsSync(target) ? "diff" : "new-file", ...base, sections };
  }

  if (DELETE_TOOLS.has(req.tool)) {
    const path = extractPath(args);
    const paths = path ? [path] : (Array.isArray(args.paths) ? (args.paths as unknown[]).map(String) : []);
    const target0 = paths.length > 0 ? resolve(req.cwd, paths[0]) : null;
    const sections: PreviewSection[] = [];
    sections.push({ title: "paths to delete", body: paths.map((p) => resolve(req.cwd, p)).join("\n") || "(none)", kind: "text" });
    if (target0 && existsSync(target0)) {
      try {
        const st = statSync(target0);
        const kind = st.isDirectory() ? "directory" : `file (${st.size} bytes)`;
        sections.push({ title: "target", body: `${kind}`, kind: "text" });
        if (!st.isDirectory()) {
          const head = readFileSync(target0, "utf8").split("\n").slice(0, 20).join("\n");
          const clamped = clampSection(head, 20, 3000);
          sections.push({ title: "first lines of the file being deleted", body: clamped.body, kind: "code", truncated: clamped.truncated });
        }
      } catch {
        /* stat failed — keep the paths section only */
      }
    }
    return { kind: "file-delete", ...base, sections };
  }

  if (SHELL_TOOLS.has(req.tool)) {
    const command = extractCommand(args);
    if (command) {
      return { kind: "command", ...base, sections: interpretCommand(command, req.cwd) };
    }
  }

  // Generic: redacted argument view. Bounded, honest, non-authoritative.
  let body: string;
  try {
    body = JSON.stringify(args, null, 2);
  } catch {
    body = "(arguments are not JSON-serializable)";
  }
  const clamped = clampSection(body, 80, MAX_GENERIC_BYTES);
  return {
    kind: "generic",
    ...base,
    sections: [{ title: "arguments (redacted)", body: clamped.body, kind: "code", truncated: clamped.truncated }],
  };
}

/** Plain-text rendering shared by text surfaces (CLI/TUI confirm prompts). */
export function renderPreviewText(preview: StructuredPreview): string {
  const header = `${preview.kind.toUpperCase()} · ${preview.tool} · risk: ${preview.riskTier}`;
  const sections = preview.sections
    .map((s) => `── ${s.title}${s.truncated ? " (truncated)" : ""}\n${s.body}`)
    .join("\n");
  const reason = preview.untrustedReason
    ? `── reason (model text — untrusted)\n${preview.untrustedReason}`
    : "";
  return [header, sections, reason].filter(Boolean).join("\n");
}
