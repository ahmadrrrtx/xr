/**
 * Path rules for opening files named in chat answers.
 *
 * A file reference from the model is treated as untrusted text. It opens only
 * when it resolves to a file inside a workspace folder. Absolute paths and any
 * `..` segment that escapes the folder are refused.
 */

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 500) return false;
  if (path.startsWith("/") || path.startsWith("\\") || /^[a-zA-Z]:/.test(path)) return false;
  if (path.includes("\0")) return false;
  const parts = path.split(/[\\/]+/);
  if (parts.some((p) => p === "..")) return false;
  return true;
}

/** True when `child` is `root` or inside it, comparing normalized forward-slash paths. */
export function isInside(root: string, child: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const c = norm(child);
  return c === r || c.startsWith(r + "/");
}

/** Clamp a 1-based line from a model reference to a valid 0-based index. */
export function clampLine(line: number, lineCount: number): number {
  const zero = Math.floor(line) - 1;
  return Math.min(Math.max(zero, 0), Math.max(lineCount - 1, 0));
}
