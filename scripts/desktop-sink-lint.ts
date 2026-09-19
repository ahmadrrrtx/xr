#!/usr/bin/env bun
/**
 * XR — Desktop sink linter (Phase 1 · security).
 *
 * The desktop renderer holds the two things a compromise would want: the
 * engine link (port + bearer token for the sidecar) and the user's approvals.
 * Every XSS-class sink in `desktop/src` is therefore a credential-exfiltration
 * path, not a styling bug — and the audit found the app had no gate at all, so
 * a `dangerouslySetInnerHTML` could be introduced by any PR and ship.
 *
 * This linter fails the build on raw HTML/eval sinks in the renderer, matching
 * the repo's existing gate style (claim-lint, size-gate): explicit rules, an
 * allowlist that must justify itself inline, and a non-zero exit on violation.
 *
 *   bun run scripts/desktop-sink-lint.ts           # lint desktop/src
 *   bun run scripts/desktop-sink-lint.ts --json    # machine-readable
 *
 * Rules
 *   SET-INNER-HTML   element.innerHTML / .outerHTML assignment
 *   INSERT-HTML      insertAdjacentHTML / document.write / writeln
 *   REACT-HTML       dangerouslySetInnerHTML
 *   EVAL             eval( / new Function(
 *   SRCDOC           iframe srcdoc — a same-origin document unless separately
 *                    sandboxed, which is exactly how an "artifact preview"
 *                    becomes an escape hatch
 *
 * Escape hatch: a line carrying `// sink-allow: <reason>` is permitted, so an
 * intentional use is possible but must state why in the diff. The count of
 * escapes is printed, so a growing allowlist is visible rather than silent.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TARGET = join(ROOT, "desktop", "src");
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const ALLOW_MARKER = "sink-allow:";

interface Rule {
  id: string;
  /** What the offending code does. */
  pattern: RegExp;
  why: string;
}

export const RULES: Rule[] = [
  {
    id: "SET-INNER-HTML",
    pattern: /\.\s*(inner|outer)HTML\s*=/,
    why: "assigning HTML re-parses attacker-influenced strings into the shell's own document, where the engine token lives",
  },
  {
    id: "INSERT-HTML",
    pattern: /insertAdjacentHTML\s*\(|document\s*\.\s*write(ln)?\s*\(/,
    why: "same as above, through the document writer instead of an element",
  },
  {
    id: "REACT-HTML",
    pattern: /dangerouslySetInnerHTML/,
    why: "React's named escape hatch from escaping — it disables the protection the rest of the renderer relies on",
  },
  {
    id: "EVAL",
    pattern: /(^|[^.\w])eval\s*\(|new\s+Function\s*\(/,
    why: "string-to-code execution cannot be bounded by the engine's policy gate",
  },
  {
    id: "SRCDOC",
    pattern: /srcdoc\s*=/,
    why: "an iframe srcdoc is a same-origin document unless it is explicitly sandboxed (use a sandboxed frame and say so with a sink-allow)",
  },
];

export interface SinkViolation {
  file: string;
  line: number;
  rule: string;
  text: string;
  why: string;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // no desktop/src in this checkout — nothing to lint
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, out);
    } else if (EXTENSIONS.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

export function lintSinks(target: string = TARGET): {
  violations: SinkViolation[];
  allowed: SinkViolation[];
  scanned: number;
} {
  const files = walk(target);
  const violations: SinkViolation[] = [];
  const allowed: SinkViolation[] = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      // Only CODE can be a sink — a commented-out call is documentation.
      const code = text.replace(/\/\/.*$/, "");
      for (const rule of RULES) {
        if (!rule.pattern.test(code)) continue;
        const hit: SinkViolation = {
          file: relative(ROOT, file),
          line: i + 1,
          rule: rule.id,
          text: text.trim(),
          why: rule.why,
        };
        // The escape hatch reads naturally on the line itself or on the line
        // above it (where a // comment explaining WHY belongs).
        const declared = text.includes(ALLOW_MARKER) || (lines[i - 1] ?? "").includes(ALLOW_MARKER);
        if (declared) allowed.push(hit);
        else violations.push(hit);
      }
    });
  }
  return { violations, allowed, scanned: files.length };
}

if (import.meta.main) {
  const json = process.argv.includes("--json");
  const { violations, allowed, scanned } = lintSinks();

  if (json) {
    console.log(JSON.stringify({ violations, allowed, scanned }, null, 2));
  } else {
    console.log(
      `[desktop-sink-lint] scanned ${scanned} renderer file(s) · ${violations.length} violation(s) · ${allowed.length} declared exception(s)`,
    );
    for (const v of violations) {
      console.error(`  FAIL ${v.rule} ${v.file}:${v.line}`);
      console.error(`       ${v.text}`);
      console.error(`       ${v.why}`);
    }
    for (const a of allowed) {
      console.log(`  note ${a.rule} ${a.file}:${a.line} — exempt via ${ALLOW_MARKER}`);
    }
    if (violations.length === 0) {
      console.log("[desktop-sink-lint] ✓ no raw HTML/eval sinks in the desktop renderer");
    }
  }
  process.exit(violations.length === 0 ? 0 : 1);
}
