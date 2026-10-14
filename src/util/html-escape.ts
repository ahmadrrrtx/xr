/**
 * XR Phase 31 · Bucket A (A2) — HTML escaping for server-rendered strings.
 *
 * The daemon dashboard client is a served JS string and cannot import this
 * module; it carries the identical `escapeHtml`/`esc` implementation inline
 * (src/daemon/dashboard/client-chat.ts, defined once and hoisted across the
 * concatenated script). This module is the canonical TypeScript copy for
 * every server-side / test-side caller, and the two MUST stay byte-equivalent
 * in behaviour: `& < > " '` are all escaped, `'` as `&#39;` so the result is
 * safe inside single-quoted attributes as well as element text.
 */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}
