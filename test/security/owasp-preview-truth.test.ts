import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

test("OWASP review states the actual desktop CSP and limits retrieval evidence", () => {
  const conf = JSON.parse(readFileSync("desktop/src-tauri/tauri.conf.json", "utf8"));
  const csp = conf.app.security.csp as string;
  const doc = readFileSync("docs/release/preview1/OWASP-LLM-2025.md", "utf8");
  expect(csp).toMatch(/script-src 'self';/);
  expect(csp).toMatch(/style-src 'self' 'unsafe-inline'/);
  expect(doc).toContain("CSP disallows inline scripts but permits inline styles");
  expect(doc).not.toContain("no inline script or inline style");
  expect(doc).toContain("authorization denial and lexical retrieval exclusion");
  expect(doc).toContain("no claim about every embedding/vector backend");
});
