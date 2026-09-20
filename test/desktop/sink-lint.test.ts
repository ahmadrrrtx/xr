/**
 * Phase 1 · the desktop sink linter (scripts/desktop-sink-lint.ts).
 *
 * A linter that cannot fail is decoration. The audit's finding was that the
 * renderer had NO gate on raw HTML sinks, which is the same class of defect as
 * the capability probe that always answered `true` (`browserAvailable`): a check
 * whose negative branch is unreachable. These tests therefore prove the
 * negative branch on a fixture tree — one sample per rule, a violation for
 * each, and the allowlist marker as the only escape — and then assert the
 * shipped renderer is actually clean.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RULES, lintSinks } from "../../scripts/desktop-sink-lint.ts";

function fixtureTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-sink-"));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

describe("desktop sink lint · the gate actually fires", () => {
  test("the shipped renderer is clean — and the gate really walked it", () => {
    const { violations, scanned } = lintSinks();
    expect(scanned).toBeGreaterThan(25); // a green result from 0 files proves nothing
    expect(violations).toEqual([]);
  });

  test("one sample per rule produces one violation, with the right rule id", () => {
    const samples: Record<string, string> = {
      "set-inner.ts": "el.innerHTML = html;\n",
      "set-outer.ts": "el.outerHTML = html;\n",
      "insert.ts": 'el.insertAdjacentHTML("beforeend", html);\n',
      "write.ts": "document.write(html);\n",
      "react.tsx": "export const X = () => <i dangerouslySetInnerHTML={{ __html: x }} />;\n",
      "eval.ts": "eval(payload);\n",
      "fn.ts": "const f = new Function(code);\n",
      "srcdoc.tsx": "export const Y = () => <iframe srcdoc={artifact} />;\n",
      "clean.ts": "export const ok = (s: string) => ({ text: s });\n",
    };
    const dir = fixtureTree(samples);
    const { violations, scanned } = lintSinks(dir);

    expect(scanned).toBe(9);
    expect(violations.map((v) => `${basename(v.file)}:${v.rule}`).sort()).toEqual(
      [
        "eval.ts:EVAL",
        "fn.ts:EVAL",
        "insert.ts:INSERT-HTML",
        "react.tsx:REACT-HTML",
        "set-inner.ts:SET-INNER-HTML",
        "set-outer.ts:SET-INNER-HTML",
        "srcdoc.tsx:SRCDOC",
        "write.ts:INSERT-HTML",
      ].sort(),
    );
    // The clean file is not reported.
    expect(violations.some((v) => v.file.endsWith("clean.ts"))).toBe(false);
  });

  test("a declared exception is reported, never silently dropped", () => {
    const dir = fixtureTree({
      "allowed.ts": '// sink-allow: engine-authored report HTML, rendered in a sandboxed frame\nel.innerHTML = engineReport;\n',
      "silent.ts": "el.innerHTML = userInput;\n",
    });
    const { violations, allowed } = lintSinks(dir);
    expect(allowed.map((a) => basename(a.file))).toEqual(["allowed.ts"]);
    expect(violations.map((v) => basename(v.file))).toEqual(["silent.ts"]);
  });

  test("a commented-out sink is not a violation (comments are not code)", () => {
    const dir = fixtureTree({ "commented.ts": "// el.innerHTML = legacy;\nexport const x = 1;\n" });
    expect(lintSinks(dir).violations).toEqual([]);
  });

  test("every rule carries a reason a reviewer can act on", () => {
    expect(RULES.length).toBeGreaterThanOrEqual(5);
    for (const rule of RULES) {
      expect(rule.id).toMatch(/^[A-Z-]+$/);
      expect(rule.why.length).toBeGreaterThan(40);
    }
  });
});
