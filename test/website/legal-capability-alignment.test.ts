import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scanPlaceholders } from "../../scripts/placeholder-lint.ts";

/**
 * Phase 1.2 — P0-2 regression guard (XR_FINAL_MASTER_AUDIT §5, badge VERIFIED).
 *
 * The privacy policy, terms, pricing, security and dashboard pages promised
 * self-serve account/team deletion with an automatic purge and a purge-date
 * email. The cloud code ships none of it: of the 8 DELETE routes in
 * cloud/src/routes none deletes an account or team, there is no scheduler,
 * and nothing writes the deletion_scheduled_at / purged_at columns (all
 * re-verified at 662ac98d — see the Phase 1.2 handoff).
 *
 * These tests pin the copy fix (report option b): no automation claim may
 * survive on the public surface, the real request path must be stated, and
 * any console-action claim about deletion needs a matching route — or an
 * owner-approved allowlist entry. Today the allowlist is empty.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..");
const WEBSITE_SRC = join(REPO_ROOT, "website", "src");
const PRIVACY_PAGE = join(WEBSITE_SRC, "app", "legal", "privacy", "page.tsx");

/** The 7 website files the claim family lived in (group 3 relation check). */
const CLAIM_FILES = [
  "app/legal/privacy/page.tsx",
  "app/legal/terms/page.tsx",
  "app/security/page.tsx",
  "app/pricing/page.tsx",
  "app/dashboard/billing/page.tsx",
  "app/dashboard/compliance/page.tsx",
  "app/dashboard/policies/page.tsx",
] as const;

export interface ClaimFinding {
  file: string;
  line: number;
  text: string;
  capability: string;
}

/**
 * P0-2 (audit §5) — each entry names the capability the cloud code does NOT
 * have, which is exactly why the matched wording is forbidden.
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ re: RegExp; capability: string }> = [
  { re: /delete from the console/i, capability: "no console account/team deletion (0 of 8 DELETE routes)" },
  { re: /deletion from the console/i, capability: "no console account/team deletion" },
  { re: /schedules a purge/i, capability: "no purge scheduler/job in cloud/src" },
  { re: /stating the purge date/i, capability: "nothing sets deletion_scheduled_at; no purge date exists to state" },
  { re: /purge date is shown in the console/i, capability: "no purge date is computed or displayed anywhere" },
  { re: /soft-delete/i, capability: "soft-delete columns exist but no code writes them" },
  { re: /then purged/i, capability: "no automatic purge after any window" },
  { re: /sets a purge date/i, capability: "no code path sets deletion_scheduled_at" },
  { re: /you can cancel and delete your account/i, capability: "cancellation exists (POST /billing/cancel); console delete does not — the run-on fused them" },
  // relational: console/automatic claims tied to deletion or purge in one sentence
  { re: /(console|automatic|automatically)[^.]{0,60}(delete|purge)/i, capability: "no console action or schedule performs deletion/purge" },
];

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function lineText(text: string, line: number): string {
  return (text.split("\n")[line - 1] ?? "").trim();
}

export function scanForForbiddenClaims(text: string, file = "<memory>"): ClaimFinding[] {
  const findings: ClaimFinding[] = [];
  for (const { re, capability } of FORBIDDEN_PATTERNS) {
    const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
    const global = new RegExp(re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) !== null) {
      const line = lineOf(text, m.index);
      findings.push({ file, line, text: lineText(text, line), capability });
      if (m[0].length === 0) global.lastIndex++;
    }
  }
  return findings;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".next"].includes(entry.name)) walk(path, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(path);
  }
  return acc;
}

/** Sentence-ish segmentation of a source file: tags out, whitespace collapsed. */
function sentencesOf(text: string): string[] {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return plain.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

function cloudRoutes(): { deletes: Set<string>; exports: Set<string> } {
  const routesDir = join(REPO_ROOT, "cloud", "src", "routes");
  const deletes = new Set<string>();
  const exports = new Set<string>();
  for (const file of walk(routesDir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/app\.delete\(\s*"([^"]+)"/gs)) deletes.add(m[1]);
    for (const m of text.matchAll(/app\.(?:get|post)\(\s*"([^"]*(?:memory\/export|audit\/export)[^"]*)"/gs)) exports.add(m[1]);
  }
  return { deletes, exports };
}

describe("P0-2 · the promise is gone (automation claims)", () => {
  test("no forbidden deletion/purge claim survives anywhere under website/src", () => {
    const all: ClaimFinding[] = [];
    for (const file of walk(WEBSITE_SRC)) all.push(...scanForForbiddenClaims(readFileSync(file, "utf8"), file));
    if (all.length > 0) {
      for (const f of all) console.error(`   ${f.file}:${f.line}  ${f.text}\n      ↳ missing capability: ${f.capability}`);
    }
    expect(all).toEqual([]);
  });
});

describe("P0-2 · the real erasure path is stated", () => {
  const privacy = readFileSync(PRIVACY_PAGE, "utf8");

  test("privacy page names the request path", () => {
    expect(privacy).toContain("privacy@xr.rrrtx.ai");
    expect(privacy).toContain("Data Rights Request");
  });

  test("deletion copy cannot drop the word 'request' silently", () => {
    const deletionSentences = sentencesOf(privacy).filter((s) => /delet|erasur/i.test(s));
    expect(deletionSentences.length).toBeGreaterThan(0);
    expect(deletionSentences.join(" ")).toMatch(/request/i);
  });
});

describe("P0-2 · capability relation (console claims need routes)", () => {
  /**
   * Owner-approved exceptions only: { id, sentence, reason, routePattern | "request-path" }.
   * A routePattern must be satisfied by a real parsed DELETE route. Today: empty —
   * every console/deletion sentence was removed, not exempted.
   */
  const ALLOWLIST: ReadonlyArray<{ id: string; sentence: string; reason: string; routePattern?: RegExp }> = [];

  test("no claim-file sentence ties deletion/erasure to a console action without a route", () => {
    const { deletes } = cloudRoutes();
    expect(deletes.size).toBe(8); // re-assert the re-verified inventory from the audit
    const offenders: string[] = [];
    for (const rel of CLAIM_FILES) {
      for (const sentence of sentencesOf(readFileSync(join(WEBSITE_SRC, rel), "utf8"))) {
        if (!/(delete|erasure)/i.test(sentence) || !/(console|dashboard|Settings)/i.test(sentence)) continue;
        const allowed = ALLOWLIST.find(
          (a) => sentence.includes(a.sentence) && (!a.routePattern || [...deletes].some((r) => a.routePattern!.test(r))),
        );
        if (!allowed) offenders.push(`${rel}: ${sentence.slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the export claims that stayed are still backed by routes", () => {
    const { exports } = cloudRoutes();
    expect(exports.has("/teams/:id/memory/export")).toBe(true); // memory.ts:381
    expect(exports.has("/teams/:id/audit/export")).toBe(true); // audit.ts:114 (POST job)
    const privacy = readFileSync(PRIVACY_PAGE, "utf8");
    expect(privacy).toContain("Team memory as plaintext JSON and the audit log as CSV"); // Export. bullet intact
  });
});

describe("P0-2 · the test bites", () => {
  test("in-memory phantom promise produces findings", () => {
    const phantom = "You can delete from the console. Deletion schedules a purge and emails you the date.";
    const findings = scanForForbiddenClaims(phantom);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings[0].capability).toContain("no console");
  });

  test("request-based truthful copy produces none", () => {
    const clean =
      "Deletion is by request: email privacy@xr.rrrtx.ai with the subject “Data Rights Request”. We verify, erase, and confirm by email — within 30 days.";
    expect(scanForForbiddenClaims(clean)).toEqual([]);
  });
});

describe("P0-2 checkpoint · the P0-1 gate stays green", () => {
  test("placeholder-lint still scans website/src clean", () => {
    expect(scanPlaceholders(WEBSITE_SRC).findings).toEqual([]);
  });
});
