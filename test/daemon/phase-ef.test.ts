/**
 * UX Phase E + F — voice & avatar state language, plus honesty/QA gates.
 *
 *   E-1 — avatar state orb (idle / thinking / working) driven by REAL agent
 *         state; speaking/listening are intentionally NOT faked.
 *   E-2 — voice panel shows the real STT/TTS backends + wake word + an honest
 *         offline note; /api/config exposes the non-secret voice detail.
 *   E-3 — the official supplied variants are curated into assets/brand/.
 *   F-1 — no hardcoded success text or fabricated scores on the dashboard
 *         (the EDR card now derives from the real security report).
 *   F-3 — the bento matrix has a plain-text screen-reader digest.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { DASHBOARD_PAGE, DASHBOARD_SCRIPT, DASHBOARD_CSS } from "../../src/daemon/dashboard.ts";

const TOKEN = "ef-token";
function fresh() {
  const tmp = mkdtempSync(join(tmpdir(), "xr-ef-"));
  process.env.XR_HOME = join(tmp, "home");
  return { store: new Store(join(tmp, "d.db")), h: makeHandler(new Store(join(tmp, "d.db")), TOKEN) };
}
const get = (path: string) =>
  new Request(`http://127.0.0.1:7842${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });

describe("E-1 — avatar state orb (real agent state only)", () => {
  test("the orb and empty-state ring exist in the markup", () => {
    expect(DASHBOARD_PAGE).toContain('id="chat-state-orb"');
    expect(DASHBOARD_PAGE).toContain('id="chat-empty-orb"');
    expect(DASHBOARD_PAGE).toContain("XR state — idle");
  });

  test("the state machine maps streaming → thinking, running tool → working, else idle", () => {
    expect(DASHBOARD_SCRIPT).toContain("function setAvatarState(kind)");
    expect(DASHBOARD_SCRIPT).toContain("function applyAvatarState()");
    expect(DASHBOARD_SCRIPT).toContain("if (running) setAvatarState(\"working\")");
    expect(DASHBOARD_SCRIPT).toContain("else if (chatStreaming) setAvatarState(\"thinking\")");
    expect(DASHBOARD_SCRIPT).toContain("setAvatarState(\"thinking\")");
    expect(DASHBOARD_SCRIPT).toContain("applyAvatarState();");
  });

  test("speaking/listening states are NOT faked (no audio pipeline in the GUI)", () => {
    expect(DASHBOARD_SCRIPT).not.toContain("setAvatarState(\"speaking\")");
    expect(DASHBOARD_SCRIPT).not.toContain("setAvatarState(\"listening\")");
    expect(DASHBOARD_SCRIPT).toContain("Speaking/listening states are NOT shown");
  });

  test("ring CSS states exist and honor reduced motion via the global rule", () => {
    expect(DASHBOARD_CSS).toContain(".chat-state-orb.thinking::after");
    expect(DASHBOARD_CSS).toContain(".chat-state-orb.working::after");
    expect(DASHBOARD_CSS).toContain("@keyframes xrOrbPulse");
    expect(DASHBOARD_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

describe("E-2 — voice panel shows real backend detail + honest offline note", () => {
  test("the config route exposes non-secret voice detail (STT/TTS/wake/mic)", async () => {
    const { h } = fresh();
    const res = await h(get("/api/v1/config"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.voice).toBeDefined();
    expect(typeof body.voice.sttBackend).toBe("string");
    expect(typeof body.voice.ttsBackend).toBe("string");
    expect("wakeWord" in body.voice).toBe(true);
    expect(typeof body.voice.microphonePermission).toBe("string");
  });

  test("the dashboard renders the offline note from those real backends", () => {
    expect(DASHBOARD_PAGE).toContain('id="voice-offline-note"');
    expect(DASHBOARD_SCRIPT).toContain("v.sttBackend || \"auto\"");
    expect(DASHBOARD_SCRIPT).toContain("Local adapters (whisper-cli, whispercpp) work offline.");
    expect(DASHBOARD_SCRIPT).toContain("voice works without network");
  });
});

describe("RELEASE — no unverified static state claims in the dashboard", () => {
  test("default cards/matrix values are neutral (—), not claims", () => {
    // these are replaced by real data the moment the loaders run; a static
    // "Safe"/"Ready"/"OK"/"0%" before that is a fake state.
    expect(DASHBOARD_PAGE).toContain('id="d-sec-score">—</div>');
    expect(DASHBOARD_PAGE).toContain('id="d-shield-health">—</div>');
    expect(DASHBOARD_PAGE).toContain('id="d-shield-scans">—</div>');
    expect(DASHBOARD_PAGE).toContain('id="h-val-voice">—</div>');
    expect(DASHBOARD_PAGE).toContain('id="market-runtime">—</div>');
    expect(DASHBOARD_PAGE).not.toContain('id="d-shield-health">Safe</div>');
    expect(DASHBOARD_PAGE).not.toContain('id="h-val-voice">Ready</div>');
  });

  test("the voice bento cell is wired to the real config (no static green)", () => {
    expect(DASHBOARD_SCRIPT).toContain('voiceVal.textContent = on ? (mode === "off" ? "On" : mode) : "Off"');
    expect(DASHBOARD_SCRIPT).toContain('voiceCell.className = "matrix-cell-status " + (on ? "green" : "")');
  });

  test("the Protection Log derives from the real security report", () => {
    expect(DASHBOARD_SCRIPT).toContain('s.blocked + "/" + s.total + " blocked · injection lab"');
    expect(DASHBOARD_SCRIPT).toContain('healthEl.textContent = s.rate >= 1 ? "All blocked" : s.rate >= 0.9 ? "Mostly blocked" : "Gaps"');
  });

  test("the marketplace runtime index is real (OK only on registry response)", () => {
    expect(DASHBOARD_SCRIPT).toContain('document.getElementById("market-runtime").textContent = "OK"');
    expect(DASHBOARD_SCRIPT).toContain('document.getElementById("market-runtime").textContent = "—"');
  });
});

describe("E-3 — official variants curated into assets/brand/", () => {
  test("the canonical kit exists", () => {
    expect(existsSync("assets/brand/avatar-front.png")).toBe(true);
    expect(existsSync("assets/brand/avatar-hero.png")).toBe(true);
    expect(existsSync("assets/brand/palette-reference.png")).toBe(true);
  });
});

describe("F-1 — dashboard honesty: no hardcoded success text or fabricated scores", () => {
  test("'All modules validated' is gone; the EDR card derives from the real report", () => {
    expect(DASHBOARD_SCRIPT).not.toContain("All modules validated");
    expect(DASHBOARD_SCRIPT).toContain('s.blocked + "/" + s.total + " blocked · injection lab"');
    expect(DASHBOARD_SCRIPT).toContain('"No scans yet — run the security lab"');
  });

  test("the security score never fabricates a percentage (the old `|| 96` is gone)", () => {
    expect(DASHBOARD_SCRIPT).not.toContain("|| 96");
    expect(DASHBOARD_SCRIPT).toContain("typeof s.rate === \"number\" ? Math.round(s.rate * 100) : null");
    expect(DASHBOARD_SCRIPT).toContain('scoreEl.textContent = pct === null ? "—" : pct + "%"');
  });
});

describe("F-3 — bento matrix has a plain-text screen-reader digest", () => {
  test("the hidden summary exists and is populated from the real cells", () => {
    expect(DASHBOARD_PAGE).toContain('id="bento-summary" class="xr-sr-only" aria-live="polite"');
    expect(DASHBOARD_SCRIPT).toContain("function updateBentoSummary()");
    expect(DASHBOARD_SCRIPT).toContain('el.textContent = "System health: "');
    expect(DASHBOARD_SCRIPT).toContain('document.querySelectorAll(".matrix-cell")');
  });
});
