/**
 * XR Control Center served-client fragment — core shell (api, nav, dashboard load, provider chip, composer meta, voice, settings sync).
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

import { UX_STATUS_JS } from "../../core/ux-status.ts";

export const CORE = `
const TOKEN = "__TOKEN__";
const BASE = window.location.origin;

// ── Phase 12 · Phase C/D — the canonical UX status vocabulary ────────────────
// Interpolated from src/core/ux-status.ts (the single source of truth), exactly
// as the design tokens below are interpolated from src/ui/tokens.ts. This served
// client is a concatenated string and cannot import, so interpolating is what
// keeps the browser copy from drifting from the kernel copy — the drift that
// produced three different descriptions of one run.
${UX_STATUS_JS}

// ── API request helper (Phase 8 · T1 — the dashboard consumes the VERSIONED API)
function v1(path) {
  return typeof path === "string" && path.startsWith("/api/") && !path.startsWith("/api/v1")
    ? "/api/v1" + path.slice("/api".length)
    : path;
}
async function api(path, opts = {}) {
  const res = await fetch(BASE + v1(path), {
    ...opts,
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Toast notifier — live-region aware (Phase 8 · T3):
// routine confirmations are polite status updates; failures are alerts.
function toast(msg, type = "info") {
  const wrap = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.setAttribute("role", type === "err" ? "alert" : "status");
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Views routing navigator
// Labels keyed by REAL panel ids (nav data-panel attributes) — breadcrumbs,
// disclosure, and the palette all derive from this one map (T4: fixed the
// stale status/security keys; control/shield were unmapped before).
const NAV_LABELS = {
  dashboard: "Home", chat: "Chat", sessions: "Runs — Sessions", research: "Runs — Research", automation: "Runs — Automation",
  agents: "Agents", providers: "Models — Providers", models: "Models — Local Runtimes",
  skills: "Extensions — Skills", plugins: "Extensions — Plugins", mcp: "Extensions — MCP", capabilities: "Extensions — Capabilities",
  approvals: "Guardrails — Approvals", budget: "Guardrails — Cost & Budget", audit: "Guardrails — Audit Log",
  shield: "Guardrails — Shield", control: "Guardrails — Computer Use",
  memory: "Memory", settings: "Settings", workspaces: "Settings — Workspaces", files: "Settings — Files",
  voice: "Settings — Voice", about: "Settings — About"
};

// Section IA: every panel belongs to ONE sidebar area. The sidebar button
// highlights for the whole section; the per-panel tab strip shows position.
const SECTION_OF = {
  dashboard: "home", chat: "chat",
  sessions: "runs", research: "runs", automation: "runs",
  agents: "agents",
  providers: "models", models: "models",
  skills: "extensions", plugins: "extensions", mcp: "extensions", capabilities: "extensions",
  approvals: "guardrails", budget: "guardrails", audit: "guardrails", shield: "guardrails", control: "guardrails",
  memory: "memory",
  settings: "settings", workspaces: "settings", files: "settings", voice: "settings", about: "settings"
};
const SECTION_SHORT = {
  home: "Home", chat: "Chat", runs: "Runs", agents: "Agents", models: "Models",
  extensions: "Extensions", guardrails: "Guardrails", memory: "Memory", settings: "Settings"
};
// Exposed for the progressive-disclosure wrapper (revealAreaFor) and any
// late-bound surface that needs the panel → area mapping.
window.SECTION_OF = SECTION_OF;

function navigateTo(id) {
  const section = SECTION_OF[id];
  // Toggle nav buttons — a section's nav-item is active for EVERY panel in
  // that section. Visual state AND the accessibility current-page state
  // (aria-current is what a screen reader announces; the class is only paint).
  document.querySelectorAll(".nav-item").forEach(el => {
    const active = section ? el.dataset.section === section : el.dataset.panel === id;
    el.classList.toggle("active", active);
    if (active) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  // Sync the in-panel tab strips (proper tab semantics: aria-selected).
  document.querySelectorAll(".tab-strip .tab-item").forEach(el => {
    const active = el.dataset.panel === id;
    el.classList.toggle("active", active);
    el.setAttribute("aria-selected", active ? "true" : "false");
  });
  // Toggle panels
  document.querySelectorAll(".panel").forEach(el => {
    el.classList.toggle("active", el.id === "panel-" + id);
  });
  // Focus management (Phase 8 · T3): when navigation came from the keyboard
  // (a nav button, the body on a shortcut key, or anywhere inside a panel
  // being hidden), move focus into the newly-shown panel so keyboard and
  // screen-reader users land on the new context instead of being stranded
  // on a now-hidden element. Topbar chips/breadcrumb clicks keep their own
  // focus — they stay visible across navigation.
  const ae = document.activeElement;
  if (ae && (ae === document.body || (ae.closest && ae.closest(".nav-item, .panel")))) {
    const panel = document.getElementById("panel-" + id);
    if (panel) panel.focus({ preventScroll: true });
  }
  // Update breadcrumb
  document.getElementById("breadcrumb-active").textContent = NAV_LABELS[id] ?? id;

  // Clean chat layout padding override
  const chatMount = document.getElementById("panel-chat");
  const content = document.querySelector(".content");
  if (id === "chat") {
    buildChatUI();
    content.style.padding = "0";
    content.style.overflow = "hidden";
  } else {
    content.style.padding = "";
    content.style.overflow = "";
  }

  // Load modules data
  switch (id) {
    case "dashboard": loadDashboard(); break;
    case "sessions": loadSessionsPanel(); break;
    case "workspaces": loadWorkspaces(); break;
    case "providers": loadProviders(); break;
    case "models": loadModels(); break;
    case "memory": loadMemory(); break;
    case "research": loadResearchPanel(); break;
    case "skills": loadMarketplace(); break;
    case "plugins": loadPlugins(); break;
    case "capabilities": loadCapabilities(); break;
    case "mcp": loadMcp(); break;
    case "control": loadComputerControl(); break;
    case "shield": loadSecurity(); break;
    case "audit": loadAuditLog(); break;
    case "budget": loadBudgetPanel(); break;
    case "files": loadFiles(); break;
    case "settings": loadSettings(); break;
    case "agents": loadAgents(); break;
    case "approvals": loadApprovalsPanel(); break;
    case "automation": loadAutomation(); break;
    case "about": break; // static build identity — nothing to fetch
    case "voice": loadVoiceStatus(); break;
  }
}

document.querySelectorAll(".nav-item").forEach(el => {
  el.addEventListener("click", () => navigateTo(el.dataset.panel));
});
// In-panel tab strips reuse navigateTo — every panel id stays reachable
// exactly as before (sidebar default + tabs + palette + shortcuts).
document.querySelectorAll(".tab-strip .tab-item").forEach(el => {
  el.addEventListener("click", () => navigateTo(el.dataset.panel));
});

// F-3 — the bento matrix is a visual grid: give screen readers a plain-text
// digest of the real cell states (never color-only).
function updateBentoSummary() {
  const el = document.getElementById("bento-summary");
  if (!el) return;
  const cells = Array.from(document.querySelectorAll(".matrix-cell")).slice(0, 12);
  const parts = cells.map(function (c) {
    const title = (c.querySelector(".matrix-cell-title") || {}).textContent || "";
    const val = (c.querySelector(".matrix-cell-val") || {}).textContent || "";
    const status = c.querySelector(".matrix-cell-status") || {};
    const tone = status.className ? String(status.className).replace("matrix-cell-status", "").trim() : "";
    return title.trim() + ": " + val.trim() + (tone ? " (" + tone + ")" : "");
  });
  el.textContent = "System health: " + (parts.join(", ") || "loading");
}

// ── Home Dashboard loader
// The rebuilt Home is HONEST BY CONSTRUCTION: every value is bound to an
// endpoint result, empty states say so, and the "Needs your attention" strip
// only ever appears when the data says something actually needs a human.
// Phase 01 — two-stage load: the lightweight cards render FIRST so the first
// meaningful paint never waits for the slowest endpoint; the heavier
// provider/model surfaces render from shared daemon caches in stage two. No
// endpoint is fetched twice: results are passed into helpers, not re-fetched.
async function loadDashboard() {
  try {
    const [ov, cost, security, approvals, sessions] = await Promise.allSettled([
      api("/api/overview"),
      api("/api/cost"),
      api("/api/security"),
      api("/api/approvals"),
      api("/api/sessions")
    ]);

    const attention = []; // {label, detail, panel} — rendered only when real

    if (ov.status === "fulfilled") {
      const d = ov.value;
      document.getElementById("dash-project").textContent = d.project ?? "default";
      const auditOk = d.audit?.chain?.valid;
      document.getElementById("d-audit-val").textContent = auditOk ? "Intact" : "ALERT";
      document.getElementById("d-audit-val").className = "card-value " + (auditOk ? "text-green" : "text-red");
      document.getElementById("d-audit-entries").textContent = (d.audit?.count ?? 0) + " entries";
      document.getElementById("h-val-memory").textContent = d.memory?.enabled ? ((d.memory?.count ?? 0) + " entries") : "Disabled";
      document.getElementById("d-memory-sub").textContent = d.memory?.enabled ? "entries in the RAG ledger" : "memory is switched off in config";
      document.getElementById("h-val-research").textContent = (d.research?.count ?? 0) + " runs";
      document.getElementById("h-cell-research").className = "matrix-cell-status " + ((d.research?.count ?? 0) > 0 ? "green" : "");
    }

    if (cost.status === "fulfilled") {
      const c = cost.value;
      document.getElementById("d-spent").textContent = "$" + (c.totalUsd ?? 0).toFixed(4);
      document.getElementById("d-tokens").textContent = (c.totalTokens ?? 0).toLocaleString() + " tokens processed";
      document.getElementById("chip-budget-label").textContent = "$" + (c.totalUsd ?? 0).toFixed(2);
    }

    if (security.status === "fulfilled") {
      const s = security.value;
      const pct = typeof s.rate === "number" ? Math.round(s.rate * 100) : null;
      const valEl = document.getElementById("h-val-shield");
      const scansEl = document.getElementById("d-shield-scans");
      const cellEl = document.getElementById("h-cell-shield");
      if (valEl) valEl.textContent = pct === null ? "No scans yet" : pct + "% blocked";
      if (scansEl) scansEl.textContent = typeof s.total === "number" ? (s.blocked + "/" + s.total + " injection-lab probes blocked") : "run the security lab for a real rate";
      if (cellEl) cellEl.className = "matrix-cell-status " + (pct === null ? "" : pct >= 90 ? "green" : pct >= 70 ? "amber" : "red");
    }

    if (approvals.status === "fulfilled") {
      const pending = approvals.value.pending ?? [];
      document.getElementById("d-approvals").textContent = String(pending.length);
      document.getElementById("d-approvals").className = "card-value " + (pending.length ? "text-amber" : "");
      document.getElementById("d-approvals-sub").textContent = pending.length ? "waiting on your decision" : "nothing waiting — runs proceed";
      const badge = document.getElementById("nav-approvals-badge");
      if (badge) {
        badge.hidden = !pending.length;
        badge.textContent = String(pending.length);
      }
      if (pending.length) {
        const oldest = pending.reduce((a, b) => (a.requestedAt ?? Infinity) < (b.requestedAt ?? Infinity) ? a : b, pending[0]);
        attention.push({
          label: pending.length + " approval" + (pending.length > 1 ? "s" : "") + " pending",
          detail: "oldest: " + (oldest.tool ?? "action") + " — " + (oldest.reason ?? "no reason given"),
          panel: "approvals"
        });
      }
    }

    if (sessions.status === "fulfilled") {
      const rows = sessions.value.sessions ?? [];
      const broken = rows.filter(s => /fail|interrupt|error/i.test(String(s.status)));
      const listEl = document.getElementById("home-recent-runs");
      if (listEl) {
        listEl.innerHTML = rows.length ? rows.slice(0, 6).map(r => \`
          <div class="stat-row">
            <span class="stat-key">\${new Date(r.created_at).toLocaleString()}</span>
            <span class="stat-val mono truncate xr-s-54">\${escapeHtml(r.title || r.id)}</span>
            <span class="badge \${r.status === "completed" ? "badge-green" : /fail|interrupt|error/i.test(String(r.status)) ? "badge-red" : "badge-gray"}">\${escapeHtml(r.status)}</span>
          </div>\`).join("")
          : '<div class="muted">No runs yet — start one in <button class="btn btn-ghost" data-xr-action="navigateTo(\\'chat\\')">Chat</button>.</div>';
      }
      if (broken.length) {
        attention.push({
          label: broken.length + " run" + (broken.length > 1 ? "s" : "") + " failed or interrupted",
          detail: escapeHtml(broken[0].title || broken[0].id),
          panel: "sessions"
        });
      }
    }

    // Needs-attention strip: rendered ONLY when the data above found something.
    const attnEl = document.getElementById("home-attention");
    const attnList = document.getElementById("home-attention-list");
    if (attnEl && attnList) {
      attnEl.hidden = !attention.length;
      attnList.innerHTML = attention.map(a => \`
        <div class="stat-row">
          <span class="stat-val">\${a.label}</span>
          <span class="stat-key truncate">\${a.detail}</span>
          <button class="btn btn-ghost xr-s-2" data-xr-action="navigateTo('\${a.panel}')">Open</button>
        </div>\`).join("");
    }

    updateBentoSummary();

    // Stage two — model card, provider cells, MCP count (served from shared
    // daemon caches).
    const [providers, models, mcp] = await Promise.allSettled([
      api("/api/providers"),
      api("/api/models"),
      api("/api/mcp")
    ]);
    if (models.status === "fulfilled") {
      const m = models.value;
      const selected = m.selected ?? {};
      document.getElementById("h-val-model").textContent = selected.model ?? "not set";
      document.getElementById("h-val-local").textContent = m.current?.healthy ? "Reachable" : "Offline";
      document.getElementById("h-cell-local").className = "matrix-cell-status " + (m.current?.healthy ? "green" : "red");
      document.getElementById("h-val-provider").textContent = selected.runtime ?? "—";
      document.getElementById("dash-hardware-summary").innerHTML = "<h3>System Specs</h3>" + (m.hardware?.summary || "Local specs detected OK.");
    }
    if (providers.status === "fulfilled" || models.status === "fulfilled") {
      const pr = providers.status === "fulfilled" ? providers.value : null;
      const mo = models.status === "fulfilled" ? models.value : null;
      const activeId = (pr && pr.primary) ?? (mo && mo.selected && mo.selected.runtime) ?? null;
      const activeModel = (pr && pr.model) ?? (mo && mo.selected && mo.selected.model) ?? null;
      const activeRow = pr ? (pr.providers ?? []).find(p => p.id === activeId) : null;
      const card = document.getElementById("home-model-name");
      const detail = document.getElementById("home-model-detail");
      const dot = document.getElementById("home-model-dot");
      const qs = document.getElementById("home-quickstart");
      if (card) card.textContent = activeModel ? activeModel : "no model selected";
      if (detail) {
        const healthy = activeRow?.healthy;
        detail.textContent = !activeId ? "add a provider key or start a local runtime"
          : healthy === false ? activeId + " — unreachable right now"
          : healthy ? activeId + " — routing normally"
          : activeId + " — health unknown";
      }
      if (dot) dot.className = "dot " + (!activeId ? "warn" : activeRow?.healthy === false ? "err" : activeRow?.healthy ? "ok" : "warn");
      // Quick start shows ONLY while no route is actually configured.
      if (qs) qs.hidden = !!(activeId && activeModel);
    }
    if (mcp.status === "fulfilled") {
      const servers = mcp.value.servers ?? [];
      const enabled = servers.filter(s => s.enabled).length;
      document.getElementById("h-val-mcp").textContent = servers.length + " · " + enabled;
      document.getElementById("h-cell-mcp").className = "matrix-cell-status " + (servers.length ? (enabled ? "green" : "amber") : "");
    }

    // Load recent logs (audit entries carry created_at, not ts)
    const audit = await api("/api/audit?limit=5");
    const entries = audit.entries ?? [];
    document.getElementById("d-audit-list").innerHTML = entries.length
      ? entries.map(e => \`
          <div class="stat-row">
            <span class="stat-key">\${new Date(e.created_at).toLocaleTimeString()}</span>
            <span class="stat-val mono truncate xr-s-54">\${e.event}</span>
            <span class="stat-val mono">\${(e.hash ?? "").slice(0, 8)}</span>
          </div>\`).join("")
      : "<div class='muted'>No logs recorded yet.</div>";

    // Phase 01 — reuse the data already fetched in this load: no duplicate
    // /api/overview + /api/providers + /api/config round-trips per paint.
    const ovDone = ov.status === "fulfilled" ? ov.value : null;
    const providersDone = providers.status === "fulfilled" ? providers.value : null;
    await loadProviderChip(ovDone, providersDone);
    await loadTrustPanel();
    const cfg = await api("/api/config").catch(function () { return null; });
    loadComposerMeta(cfg);
    loadVoiceStatus(cfg);
    syncSettingsFromConfig(cfg);
  } catch(e) {
    toast("Dashboard load failed: " + e.message, "err");
  }
}

// XR 4.2 — Trust & Isolation status card (guarded; never breaks the dashboard).
async function loadTrustPanel() {
  try {
    const grid = document.getElementById("dashboard-health-matrix");
    if (!grid) return;
    let cell = document.getElementById("trust-matrix-cell");
    if (!cell) {
      cell = document.createElement("div");
      cell.className = "matrix-cell";
      cell.id = "trust-matrix-cell";
      cell.innerHTML =
        '<div class="matrix-cell-head"><span class="matrix-cell-title">Trust &amp; Isolation</span><div class="matrix-cell-status" id="h-cell-trust"></div></div>' +
        '<div class="matrix-cell-val" id="h-val-trust">…</div>' +
        '<div class="matrix-cell-sub">Risk-tiered placement · Tier-2 fail-closed</div>';
      grid.appendChild(cell);
    }
    const t = await api("/api/trust");
    const backends = (t && t.backends) || [];
    const avail = backends.filter(function (b) { return b.available; }).map(function (b) { return b.placement; });
    const hasTier2 = avail.indexOf("namespace_sandbox") >= 0 || avail.indexOf("container") >= 0;
    const valEl = document.getElementById("h-val-trust");
    const statusEl = document.getElementById("h-cell-trust");
    if (valEl) valEl.textContent = hasTier2 ? "Tier-2 sandbox ready" : (avail.length ? "Restricted only" : "In-process only");
    if (statusEl) statusEl.className = "matrix-cell-status " + (hasTier2 ? "green" : "red");
  } catch (e) {
    /* never break the dashboard */
  }
}

async function loadProviderChip(ovResult, providersResult) {
  try {
    // Phase 01 — reuse data already fetched by loadDashboard when available;
    // standalone callers (provider switch) still self-fetch.
    let ov, providers;
    if (ovResult && providersResult) { ov = ovResult; providers = providersResult; }
    else {
      const r = await Promise.all([api("/api/overview"), api("/api/providers")]);
      ov = r[0]; providers = r[1];
    }
    const budget = ov.budget?.perTaskUsd ?? 0;
    document.getElementById("chip-budget-label").textContent = budget > 0 ? "Cap $" + budget.toFixed(2) : "No cap";

    const activeId = providers.primary ?? ov.provider?.active ?? "ollama";
    const activeModel = providers.model ?? ov.provider?.model ?? "—";
    const activeRow = (providers.providers ?? []).find(p => p.id === activeId);
    document.getElementById("sidebar-provider-text").textContent = activeId + " · " + activeModel;
    document.getElementById("chip-provider-label").textContent = activeId + " / " + activeModel;
    document.getElementById("chip-provider").className = "status-chip " + (activeRow?.healthy === false ? "err" : activeRow?.healthy ? "ok" : "warn");
    document.getElementById("provider-dot").style.background = activeRow?.healthy === false ? "var(--red)" : activeRow?.healthy ? "var(--green)" : "var(--amber)";

    // Phase A · T5 — locality badge (LOCAL / CLOUD / OFFLINE / SETUP), fed by
    // the real route state: ov.provider.local mirrors isLocal() on the daemon.
    const localRoute = !!(ov.provider && ov.provider.local);
    const healthy = activeRow?.healthy;
    let locText = "SETUP", locTone = "setup";
    if (healthy === false) { locText = "OFFLINE"; locTone = "offline"; }
    else if (localRoute) { locText = "LOCAL"; locTone = "local"; }
    else if (healthy) { locText = "CLOUD"; locTone = "cloud"; }
    const chipLoc = document.getElementById("chip-locality");
    if (chipLoc) {
      chipLoc.className = "locality-badge " + locTone;
      chipLoc.textContent = locText;
      chipLoc.title = locTone === "local" ? "Runs on this machine — no data leaves it for this route."
        : locTone === "cloud" ? "Cloud route via your provider key — network and budget apply."
        : locTone === "offline" ? "Active route is unreachable." : "No working route yet — set up a model or provider.";
    }
    const sideLoc = document.getElementById("sidebar-locality");
    if (sideLoc) {
      sideLoc.className = "locality-badge " + locTone;
      sideLoc.textContent = locText;
      sideLoc.hidden = false;
    }
    const chatLabel = document.getElementById("chat-model-label");
    if (chatLabel) chatLabel.textContent = activeId + " / " + activeModel + " · " + locText;
  } catch {}
}

// ── Phase A · A-6 — composer transparency: real budget + honest context.
// The daemon chat route (src/daemon/routes/chat.routes.ts) keeps the last 10
// messages of history per reply; the client mirrors it with history.slice(-10)
// in streamChat(). We surface both facts honestly instead of pretending a
// "context window %" that no API provides.
async function loadComposerMeta(cfg) {
  const box = document.getElementById("composer-meta");
  if (!box) return;
  try {
    // Phase 01 — config is fetched once per dashboard load and shared.
    const [budget, config] = cfg ? [await api("/api/budget"), cfg] : await Promise.all([api("/api/budget"), api("/api/config")]);
    const usage = budget.usage || {};
    const dayUsd = Number(usage.dayUsd ?? 0);
    const taskCap = Number(budget.config && budget.config.perTaskUsd ? budget.config.perTaskUsd : 0);
    const memEnabled = !!(config.memory && config.memory.enabled);
    box.innerHTML = "";
    // DOM building only — the dashboard CSP is style-src 'self' (no inline
    // style attributes), so progress width is set through CSSOM.
    function item(text) {
      const s = document.createElement("span");
      s.className = "meta-item";
      s.textContent = text;
      box.appendChild(s);
      return s;
    }
    item("Context: last 10 messages");
    item("Memory: " + (memEnabled ? "on" : "off"));
    if (taskCap > 0) {
      const pct = Math.min(100, (dayUsd / taskCap) * 100);
      const tone = dayUsd >= taskCap ? "bad" : dayUsd >= taskCap * 0.8 ? "warn" : "";
      const wrap = document.createElement("span");
      wrap.className = "meta-item";
      wrap.appendChild(document.createTextNode("Today $" + dayUsd.toFixed(4) + " · task cap $" + taskCap.toFixed(2) + " "));
      const meter = document.createElement("span");
      meter.className = "meta-meter";
      const bar = document.createElement("span");
      bar.className = "meta-progress " + tone;
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", pct.toFixed(0));
      bar.title = pct.toFixed(0) + "% of per-task cap used today";
      const fill = document.createElement("i");
      fill.style.width = pct.toFixed(1) + "%";
      bar.appendChild(fill);
      meter.appendChild(bar);
      wrap.appendChild(meter);
      box.appendChild(wrap);
    } else {
      item("Today $" + dayUsd.toFixed(4) + " · no per-task cap");
    }
  } catch {
    const s = document.createElement("span");
    s.className = "meta-item";
    s.textContent = "Budget & context unavailable";
    box.appendChild(s);
  }
}

// ── Phase A · A-1 — honest voice panel state, from the real config.
async function loadVoiceStatus(cfg) {
  const el = document.getElementById("voice-config-state");
  const note = document.getElementById("voice-offline-note");
  if (!el) return;
  try {
    const config = cfg || await api("/api/config");
    const v = config.voice || {};
    const mode = v.mode || "off";
    const on = !!v.enabled;
    el.textContent = "Configured: " + (on ? "on" : "off") + " · mode: " + mode;
    el.className = "badge " + (on ? "badge-green" : "badge-gray");
    // bento cell 4 (voice runtime): real state, never a static "Ready"
    const voiceVal = document.getElementById("h-val-voice");
    if (voiceVal) voiceVal.textContent = on ? (mode === "off" ? "On" : mode) : "Off";
    const voiceCell = document.getElementById("h-cell-voice");
    if (voiceCell) voiceCell.className = "matrix-cell-status " + (on ? "green" : "");
    const stt = v.sttBackend || "auto";
    const tts = v.ttsBackend || "auto";
    el.title = "STT: " + stt + " · TTS: " + tts + (v.wakeWord ? " · wake: " + v.wakeWord : "") + " — the dashboard reflects this; the audio pipeline runs from the terminal (xr voice setup / start).";
    if (note) {
      // Honest offline path: STT/TTS adapters are local-first; network adapters
      // (groq/openai) are called out, not hidden.
      const netStt = stt === "groq" || stt === "openai" || stt === "http";
      const netTts = tts === "openai" || tts === "http";
      note.textContent = netStt || netTts
        ? "Offline note: your STT/TTS backends need network (" + stt + " / " + tts + "). Local adapters (whisper-cli, whispercpp) work offline."
        : "Offline note: these backends run locally — voice works without network.";
    }
  } catch {
    el.textContent = "Voice config unavailable";
  }
}

// ── Phase A · A-7 — settings panes are read-only in this build: reflect the
// real config values and never let the user believe a toggle persisted.
function syncSettingsFromConfig(cfg) {
  (cfg ? Promise.resolve(cfg) : api("/api/config")).then(function (config) {
    const voice = config.voice || {};
    const setPtt = document.getElementById("set-voice-ptt");
    if (setPtt) {
      setPtt.checked = voice.mode === "push-to-talk";
      setPtt.disabled = true;
      if (setPtt.closest) setPtt.closest(".toggle").title = "Read-only in the dashboard — configure with 'xr voice setup' in the terminal.";
    }
    const sec = config.security || {};
    const setAppr = document.getElementById("set-trust-approval");
    if (setAppr) {
      setAppr.checked = !!sec.requireApproval;
      setAppr.disabled = true;
      if (setAppr.closest) setAppr.closest(".toggle").title = "Read-only in the dashboard — enforced by the runtime policy gate.";
    }
    const setEgress = document.getElementById("set-trust-egress");
    if (setEgress) {
      setEgress.checked = !!(sec.egressAllowlist && sec.egressAllowlist.length);
      setEgress.disabled = true;
      if (setEgress.closest) setEgress.closest(".toggle").title = "Read-only in the dashboard — enforced by the runtime egress allow-list.";
    }
    const setDensity = document.getElementById("set-general-density");
    if (setDensity) {
      setDensity.disabled = true;
      setDensity.title = "Dashboard density is not persisted in this build — it is a shell/CLI preference.";
    }
    const setStartup = document.getElementById("set-general-startup");
    if (setStartup) {
      setStartup.disabled = true;
      if (setStartup.closest) setStartup.closest(".toggle").title = "Read-only in the dashboard — manage from your OS or the CLI.";
    }
  }).catch(function () {});
}

`;
