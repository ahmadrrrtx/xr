/**
 * Diagnostics from XR, read only from an explicit structured block.
 *
 * XR publishes Problems-panel entries only when an answer contains a fenced
 * block tagged `xr-diagnostics` with a JSON array. Free text never produces a
 * diagnostic, so nothing is invented from prose. Entries that do not match the
 * shape are dropped, and file paths must stay inside the workspace.
 */

export interface XrDiagnostic {
  file: string;
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
}

const BLOCK_RE = /```xr-diagnostics[ \t]*\n([\s\S]*?)\n```/g;
const MAX_ITEMS = 200;
const MAX_MESSAGE = 300;

export function parseDiagnosticBlocks(text: string): XrDiagnostic[] {
  const out: XrDiagnostic[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(text)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      const d = validateDiagnostic(item);
      if (d) out.push(d);
      if (out.length >= MAX_ITEMS) return out;
    }
  }
  return out;
}

export function validateDiagnostic(item: unknown): XrDiagnostic | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const file = typeof o.file === "string" ? o.file.trim() : "";
  const line = typeof o.line === "number" ? o.line : NaN;
  const severity = o.severity;
  const message = typeof o.message === "string" ? o.message.trim() : "";
  if (!file || file.startsWith("/") || /^[a-zA-Z]:/.test(file) || file.split(/[\\/]/).includes("..")) return null;
  if (!Number.isSafeInteger(line) || line < 1) return null;
  if (severity !== "error" && severity !== "warning" && severity !== "info") return null;
  if (!message) return null;
  return { file, line, severity, message: message.slice(0, MAX_MESSAGE) };
}
