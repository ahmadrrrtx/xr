/**
 * Phase 34 · R2 — unknown-request-field detection (P1-6 phantom success).
 * Mount policy: index.ts validateBody (v1 rejects 400 with paths + accepted
 * set; legacy names via x-xr-ignored-fields until 2027-08-01 — policy §4.1
 * in docs/api/COMPATIBILITY.md). Descends declared objects + arrays; unwraps
 * optional/nullable/default; unions/records/maps/catch/empty-bags opaque —
 * no false positives first. Bounded: ≤20 paths, depth ≤8; never throws.
 */
import { z } from "zod/v4";

const MAX_PATHS = 20;
const MAX_DEPTH = 8;

/** Top-level keys a request schema declares (for the 400 error message). */
export function declaredKeys(schema: unknown): string[] {
  const s = unwrap(schema);
  return s instanceof z.ZodObject ? Object.keys(s.shape) : [];
}
/** Dotted paths (`a.b`, `items[0].c`) of keys the schema does not declare. */
export function unknownFieldPaths(schema: unknown, raw: unknown): string[] {
  const out: string[] = [];
  try { walk(unwrap(schema), raw, "", 0, out); } catch { /* never a 500 */ }
  return out.slice(0, MAX_PATHS);
}function unwrap(s: unknown): unknown {
  for (;;) {
    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
      s = (s as unknown as { unwrap(): unknown }).unwrap();
    } else if (s instanceof z.ZodDefault) {
      s = (s as unknown as { removeDefault(): unknown }).removeDefault();
    } else return s;
  }
}
function walk(s: unknown, v: unknown, path: string, depth: number, out: string[]): void {
  if (out.length >= MAX_PATHS || depth > MAX_DEPTH || v === null || typeof v !== "object") return;
  const opaque = // free-form subtrees are opaque by contract
    s instanceof z.ZodUnion || s instanceof z.ZodDiscriminatedUnion || s instanceof z.ZodRecord ||
    s instanceof z.ZodMap || s instanceof z.ZodCatch || s instanceof z.ZodAny || s instanceof z.ZodUnknown;
  if (opaque) return;
  if (Array.isArray(v)) {
    if (s instanceof z.ZodArray) v.forEach((x, i) => walk(unwrap(s.element), x, `${path}[${i}]`, depth + 1, out));
    return;
  }
  if (!(s instanceof z.ZodObject)) return;
  const shape = s.shape as Record<string, unknown>;
  if (Object.keys(shape).length === 0) return; // declared free-form bag (e.g. trigger spec)
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!(k in shape)) out.push(path ? `${path}.${k}` : k);
    else walk(unwrap(shape[k]), x, path ? `${path}.${k}` : k, depth + 1, out);
    if (out.length >= MAX_PATHS) return;
  }
}
