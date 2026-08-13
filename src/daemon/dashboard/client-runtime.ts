/**
 * XR Control Center served-client fragment — shell prefs, quick prompts, onboarding, route marker, initial sync, dispatcher, T4 IIFE.
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const RUNTIME = `// ── Phase B · B-2 — shell prefs: sidebar collapse + inspector toggle ─────
const SIDEBAR_KEY = "xr.sidebar.collapsed";
const INSPECTOR_KEY = "xr.inspector.hidden";
function toggleSidebar() {
  const app = document.querySelector(".app");
  if (!app) return;
  const collapsed = app.classList.toggle("sidebar-collapsed");
  const btn = document.getElementById("sidebar-toggle-btn");
  if (btn) btn.setAttribute("aria-pressed", collapsed ? "true" : "false");
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"); } catch (e) {}
}
function toggleInspector() {
  const wrap = document.querySelector(".chat-wrap");
  if (!wrap) return;
  const hidden = wrap.classList.toggle("inspector-hidden");
  const btn = document.getElementById("inspector-toggle-btn");
  if (btn) btn.setAttribute("aria-pressed", hidden ? "true" : "false");
  try { localStorage.setItem(INSPECTOR_KEY, hidden ? "1" : "0"); } catch (e) {}
}
function applyShellPrefs() {
  try {
    const app = document.querySelector(".app");
    if (app && localStorage.getItem(SIDEBAR_KEY) === "1") {
      app.classList.add("sidebar-collapsed");
      const b = document.getElementById("sidebar-toggle-btn");
      if (b) b.setAttribute("aria-pressed", "true");
    }
    const wrap = document.querySelector(".chat-wrap");
    if (wrap && localStorage.getItem(INSPECTOR_KEY) === "1") {
      wrap.classList.add("inspector-hidden");
      const b = document.getElementById("inspector-toggle-btn");
      if (b) b.setAttribute("aria-pressed", "true");
    }
  } catch (e) {}
}

// ── Phase B · B-3 — empty-state quick prompts (run real slash commands) ─
function quickPrompt(text) {
  const input = document.getElementById("chat-input");
  if (input) input.value = "";
  sendChatMessage(text);
}

// ── Phase B · B-1 — first-run onboarding (real engines, no fakes) ───────
const ONB_DISMISS_KEY = "xr.onboarding.dismissed";
const ONB_STEPS = ["welcome", "mode", "cloud", "local", "security", "budget", "done"];
let onb = { step: "welcome", mode: null, provider: null };

function onbShow() {
  const root = document.getElementById("onboarding-root");
  if (!root) return;
  root.hidden = false;
  onbGo("welcome");
}
function onbHide() {
  const root = document.getElementById("onboarding-root");
  if (root) root.hidden = true;
}
function onbGo(step) {
  if (ONB_STEPS.indexOf(step) < 0) { onbHide(); navigateTo(step); return; }
  onb.step = step;
  document.querySelectorAll(".onb-step").forEach(function (s) { s.hidden = s.dataset.step !== step; });
  const prog = document.getElementById("onb-progress");
  if (prog) {
    prog.innerHTML = "";
    const idx = ONB_STEPS.indexOf(step);
    ONB_STEPS.forEach(function (id, i) {
      const li = document.createElement("li");
      if (i < idx) li.className = "done";
      if (id === step) li.className = "active";
      li.setAttribute("aria-label", id);
      prog.appendChild(li);
    });
  }
  const backBtn = document.getElementById("onb-back-btn");
  if (backBtn) backBtn.hidden = step === "welcome";
  const skipBtn = document.getElementById("onb-skip-btn");
  if (skipBtn) skipBtn.textContent = step === "done" ? "Close" : "Skip setup";
  const foot = document.getElementById("onb-foot-status");
  if (foot) foot.textContent = "";
  if (step === "cloud") onbRenderCloud();
  if (step === "local") onbRenderLocal();
  if (step === "security") onbRenderSecurity();
  if (step === "done") onbRenderDone();
  // Deliberately NO auto-focus here: the overlay opens on page load for a
  // first-run, and yanking focus on load is an accessibility anti-pattern
  // (WCAG 2.4.3). Keyboard users Tab into the dialog naturally; pointer
  // users click its buttons directly.
}
function onbNext() {
  if (onb.step === "welcome") return onbGo("mode");
  if (onb.step === "mode") {
    if (onb.mode === "local") return onbGo("local");
    return onbGo("cloud"); // cloud or both
  }
  if (onb.step === "cloud") {
    if (onb.mode === "both") return onbGo("local");
    return onbGo("security");
  }
  if (onb.step === "local") return onbGo("security");
  if (onb.step === "security") return onbGo("budget");
  if (onb.step === "budget") return onbGo("done");
  onbGo("mode");
}
function onbBack() {
  const rev = ["welcome", "mode", "cloud", "local", "security", "budget", "done"];
  const i = rev.indexOf(onb.step);
  if (i <= 0) return;
  let prev = rev[i - 1];
  if (prev === "cloud" && onb.mode === "local") prev = "mode";
  onbGo(prev);
}
function onbPickMode(mode) { onb.mode = mode; onbNext(); }
function onbSkip() {
  onbHide();
  try { localStorage.setItem(ONB_DISMISS_KEY, "1"); } catch (e) {}
  toast("You can finish setup anytime — Settings or Providers.", "info");
}
async function onbRenderCloud() {
  const box = document.getElementById("onb-cloud-providers");
  if (!box) return;
  try {
    const [catalog, providers] = await Promise.all([api("/api/providers/catalog"), api("/api/providers")]);
    const hosted = (catalog.providers || []).filter(function (p) { return p.kind !== "local"; });
    if (!hosted.length) { box.innerHTML = '<div class="muted">No cloud providers available.</div>'; return; }
    const statusMap = {};
    (providers.providers || []).forEach(function (p) { statusMap[p.id] = p; });
    box.innerHTML = hosted.map(function (p) {
      const st = statusMap[p.id] || {};
      const cls = "onb-provider" + (onb.provider === p.id ? " sel" : "") + (st.hasKey ? " haskey" : "") + (st.healthy ? " ready" : "");
      const title = st.hasKey ? "A key is already stored" : "No key yet";
      return '<button type="button" class="' + cls + '" data-provider="' + escapeHtml(p.id) + '" data-xr-action="onbSelectProvider(\\'' + p.id + '\\')" title="' + title + '">' +
        '<span class="dot" aria-hidden="true"></span><span>' + escapeHtml(p.label) + '</span></button>';
    }).join("");
  } catch (e) {
    box.innerHTML = '<div class="muted">Could not load providers: ' + escapeHtml(e.message || e) + '</div>';
  }
}
function onbSelectProvider(id) {
  onb.provider = id;
  document.querySelectorAll("#onb-cloud-providers .onb-provider").forEach(function (b) {
    b.classList.toggle("sel", b.dataset.provider === id);
  });
}
async function onbConnectProvider() {
  const btn = document.getElementById("onb-connect-btn");
  const result = document.getElementById("onb-connect-result");
  const keyInput = document.getElementById("onb-api-key");
  if (!btn || !result) return;
  if (!onb.provider) { result.className = "onb-result warn"; result.textContent = "Pick a provider first."; return; }
  const key = (keyInput && keyInput.value || "").trim();
  if (!key) { result.className = "onb-result warn"; result.textContent = "Paste your API key."; return; }
  btn.disabled = true;
  result.className = "onb-result";
  result.textContent = "Saving & testing…";
  try {
    const j = await apiPost("/api/onboarding/provider", { providerId: onb.provider, apiKey: key, probe: true });
    const h = j.health;
    if (h && h.ok) {
      result.className = "onb-result ok";
      result.textContent = "Connected — " + onb.provider + " is reachable.";
    } else if (h) {
      result.className = "onb-result warn";
      result.textContent = "Key saved, but the live test failed: " + (h.detail || "unreachable") + ". You can retry in Providers.";
    } else {
      result.className = "onb-result ok";
      result.textContent = "Key saved.";
    }
    if (keyInput) keyInput.value = "";
    toast("Provider key saved securely", "ok");
    loadProviderChip();
    loadComposerMeta();
  } catch (e) {
    result.className = "onb-result err";
    result.textContent = e.message || "Failed to save the key.";
  } finally {
    btn.disabled = false;
  }
}
async function onbRenderLocal() {
  const box = document.getElementById("onb-local-content");
  if (!box) return;
  try {
    const m = await api("/api/models");
    const rec = m.recommendation || {};
    const current = m.current || {};
    const lines = [];
    lines.push('<div class="kv-line"><strong>Hardware:</strong> ' + escapeHtml(m.hardware && m.hardware.summary || "detected") + '</div>');
    if (rec.runtimeModel) {
      lines.push('<div class="kv-line"><strong>Recommended:</strong> ' + escapeHtml(rec.runtimeModel) + ' <span class="badge badge-gray">' + escapeHtml(rec.confidence || "unknown") + '</span></div>');
      if (rec.reason) lines.push('<div class="kv-line">' + escapeHtml(rec.reason) + '</div>');
    }
    const healthy = !!current.healthy;
    if (healthy) {
      lines.push('<div class="kv-line"><span class="badge badge-green">Running</span> ' + escapeHtml(current.id || current.runtime || "local model") + '</div>');
    } else if (current.installed) {
      lines.push('<div class="kv-line"><span class="badge badge-amber">Installed but not running</span> — start your local runtime (e.g. Ollama) then come back here.</div>');
    } else {
      lines.push('<div class="kv-line"><span class="badge badge-gray">Not running yet</span> — XR can set up the recommended model for you, or you can install it yourself from the terminal.</div>');
    }
    const actions = [];
    if (rec.runtimeModel && !healthy) {
      actions.push('<button type="button" class="btn btn-primary" data-xr-action="onbSetLocal(\\'' + rec.runtimeModel + '\\')">Use ' + escapeHtml(rec.runtimeModel) + '</button>');
      actions.push('<button type="button" class="btn btn-ghost" data-xr-action="copyText(\\'xr models install\\')">Copy install command</button>');
    }
    actions.push('<button type="button" class="btn btn-ghost" data-xr-action="onbGo(\\'models\\')">Open Models panel</button>');
    box.innerHTML = lines.join("") + '<div class="onb-actions">' + actions.join("") + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="muted">Could not detect local models: ' + escapeHtml(e.message || e) + '</div>';
  }
}
async function onbSetLocal(model) {
  try {
    const m = await api("/api/models");
    const runtime = m.selected && m.selected.runtime || "ollama";
    await apiPost("/api/models/select", { runtime, model });
    toast("Local route set to " + model, "ok");
    loadProviderChip();
    loadComposerMeta();
    onbRenderLocal();
  } catch (e) {
    toast(e.message || "Could not set the local model", "err");
  }
}
async function onbRenderSecurity() {
  const box = document.getElementById("onb-security-content");
  if (!box) return;
  try {
    const [config, trust] = await Promise.all([api("/api/config"), api("/api/trust")]);
    const sec = config.security || {};
    const items = [];
    const approvals = sec.requireApproval || [];
    if (approvals.length) items.push("XR will ask your permission before: <code>" + approvals.join("</code>, <code>") + "</code>.");
    else items.push("Approvals are currently off — consequential actions run without asking.");
    const egress = sec.egressAllowlist || [];
    if (egress.length) items.push("Outbound network is limited to: <code>" + egress.join("</code>, <code>") + "</code>.");
    else items.push("No outbound network allow-list is configured.");
    const backends = ((trust && trust.backends) || []).filter(function (b) { return b.available; }).map(function (b) { return b.placement; });
    if (backends.length) items.push("Isolation: <code>" + backends.join("</code>, <code>") + "</code> available (tier-2 fail-closed).");
    box.innerHTML = "<ul>" + items.map(function (i) { return "<li>" + i + "</li>"; }).join("") + "</ul>";
  } catch (e) {
    box.innerHTML = '<div class="muted">Security summary unavailable: ' + escapeHtml(e.message || e) + '</div>';
  }
}
async function onbSetBudget() {
  const input = document.getElementById("onb-budget-monthly");
  const result = document.getElementById("onb-budget-result");
  if (!input || !result) return;
  const val = parseFloat(input.value);
  if (!(val >= 0) || input.value.trim() === "") { result.className = "onb-result warn"; result.textContent = "Enter a number — or skip this step (leave empty)."; return; }
  try {
    await apiPost("/api/budget/set", { monthlyCap: val });
    result.className = "onb-result ok";
    result.textContent = "Monthly cap saved: $" + val.toFixed(2);
    loadComposerMeta();
  } catch (e) {
    result.className = "onb-result err";
    result.textContent = e.message || "Could not save the cap.";
  }
}
function onbRenderDone() {
  const sub = document.getElementById("onb-done-sub");
  if (!sub) return;
  const mode = onb.mode;
  const suffix = mode === "local" ? " with a local route." : mode === "cloud" ? " with your cloud provider." : " — local first, cloud when needed.";
  sub.textContent = "XR is set up" + suffix + " Your first task will be recorded in the audit log.";
}
async function onbComplete() {
  try { await apiPost("/api/onboarding/complete", {}); } catch (e) {}
  onbHide();
  try { localStorage.setItem(ONB_DISMISS_KEY, "1"); } catch (e) {}
  navigateTo("chat");
  toast("Welcome to XR — your first task is audit-logged.", "ok");
}
async function onboardingInit() {
  try {
    const status = await api("/api/onboarding/status");
    let dismissed = false;
    try { dismissed = localStorage.getItem(ONB_DISMISS_KEY) === "1"; } catch (e) {}
    if (status.needsSetup && !dismissed) onbShow();
  } catch (e) { /* onboarding is best-effort — never blocks the app */ }
}
// Esc closes the onboarding overlay (skip semantics), never the app.
document.addEventListener("keydown", function (ev) {
  if (ev.key !== "Escape") return;
  const root = document.getElementById("onboarding-root");
  if (root && !root.hidden) onbSkip();
});

// ── Initial sync
// Phase B · B-2 — honor the route marker served by /chat and /dashboard
// (the client app is an external CSP asset, so routes signal intent on the
// <body> element instead of inline script).
const routeMarker = document.body && document.body.dataset ? (document.body.dataset.route || "") : "";
if (routeMarker === "chat" || routeMarker === "dashboard") navigateTo(routeMarker);
loadDashboard();
applyShellPrefs();
onboardingInit();

// ── Interval syncing
setInterval(() => {
  const active = document.querySelector(".nav-item.active")?.dataset.panel;
  if (active === "dashboard") loadDashboard();
  if (active === "sessions") loadSessionsPanel();
  if (active === "providers") loadProviders();
  if (active === "models") loadModels();
  if (active === "budget") loadBudgetPanel();
}, 20_000);


// Phase 4 · T5 — build a safely-quoted data-xr-action value for runtime
// generated elements: single-quoted args with quotes/backslashes escaped, so
// the attribute can never break out of its value (CSP-safe + injection-safe).
// Backslash is built via fromCharCode(92) to keep this block free of
// backslash-escape ambiguity inside the outer template.
function act(fn) {
  var BS = String.fromCharCode(92);
  var args = Array.prototype.slice.call(arguments, 1);
  var out = fn + '(';
  for (var i = 0; i < args.length; i++) {
    if (i > 0) out += ', ';
    var a = args[i];
    if (typeof a === 'number' || typeof a === 'boolean') { out += String(a); continue; }
    out += "'" + String(a).split(BS).join(BS + BS).split("'").join(BS + "'") + "'";
  }
  return out + ')';
}
// ── Phase 4 · T5 — CSP-safe action dispatcher ──────────────────────────────
// Inline event handlers are forbidden by the strict CSP (script-src 'self',
// no unsafe-inline). UI actions are declared as data-xr-action="fn('arg')"
// attributes and dispatched here through a STRICT PARSER + ALLOWLIST — never
// eval, never a dynamic call outside the allowlist. Unknown functions or
// malformed expressions are ignored (fail closed).
var XR_ACTIONS = new Set(["answerApproval","approveMemory","capabilityInspect","capabilityQuarantine","chatArchiveActive","chatBranchFromLast","chatExportActive","chatNewChat","chatSelectChat","chatTogglePin","clearMemory","clearNotifications","closePalette","copyText","createWorkspace","cycleChatMode","deleteMemory","doMemSearch","downloadArtifact","editMessage","emergencyStopControl","exportFullData","focusChangeModel","insertHint","inspectMarketplaceSkill","installMarketplaceSkill","killProcess","loadAuditLog","loadBudgetPanel","loadCapabilities","loadMarketplace","loadMcp","loadModels","loadPlugins","loadResearchDetail","loadResearchPanel","loadSessionDetail","loadSessionsPanel","loadWorkspaces","navigateTo","openAttachmentPicker","openPalette","pickInstalledModel","pluginAction","pluginRemove","quarantineFile","refreshAll","registerMcp","removeAttachment","removeMcp","revokeMemory","runSecLab","runShieldScan","saveAllSettings","saveBudgetConfig","saveModelSelection","saveProviderRouting","searchPlugins","sendChatMessage","setMarketFilter","setMarketQuery","setMarketSort","setTimeout","skillAction","switchSettingsPane","switchShieldTab","switchWorkspaceUI","syncMarketplace","testModelSelection","toast","toggleComposerFlag","toggleShieldAdBlock","verifyAuditLedger","toggleSidebar","toggleInspector","quickPrompt","onbGo","onbNext","onbBack","onbPickMode","onbSelectProvider","onbConnectProvider","onbSetLocal","onbSetBudget","onbComplete","onbSkip","loadFiles","filesEnterDir","filesSelect","filesShowDiff","filesCopy","filesAsk"]);
document.addEventListener('click', function (ev) {
  var el = ev.target && ev.target.closest ? ev.target.closest('[data-xr-action]') : null;
  if (!el) return;
  var expr = el.getAttribute('data-xr-action');
  if (!expr) return;
  runXrAction(expr, ev);
});
// keyup actions (e.g. the settings search box): dispatched through the same
// allowlist parser.
// Phase 8 · T3 — keyboard activation bridge: elements upgraded with
// role="button" (rows, cards, list items) activate on Enter/Space exactly
// like native buttons. Native controls are ignored (they activate themselves).
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  var el = ev.target && ev.target.closest ? ev.target.closest('[role="button"]') : null;
  if (!el) return;
  var tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  ev.preventDefault();
  if (el.hasAttribute('data-xr-action')) runXrAction(el.getAttribute('data-xr-action'), ev);
  else el.click();
});
// Tool timeline accordion: toggles the card open/closed and mirrors state
// into aria-expanded (fixes the Phase 4 no-op stub — the CSP dispatcher must
// stay allowlist-only, so expansion lives in this dedicated handler).
document.addEventListener('click', function (ev) {
  var head = ev.target && ev.target.closest ? ev.target.closest('.tool-head') : null;
  if (!head || !head.parentElement) return;
  var open = head.parentElement.classList.toggle('open');
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.addEventListener('keyup', function (ev) {
  var el = ev.target;
  if (!el || !el.getAttribute || !el.getAttribute('data-xr-keyup')) return;
  var expr = el.getAttribute('data-xr-keyup');
  if (!expr) return;
  runXrAction(expr, ev);
});
function runXrAction(expr, ev) {
  var stmts = expr.split(';');
  var stop = false;
  for (var i = 0; i < stmts.length; i++) {
    var s = stmts[i].trim();
    if (!s) continue;
    if (s === 'return false' || s === 'event.stopPropagation()') { stop = stop || s === 'event.stopPropagation()'; continue; }
    var m = s.match(/^([A-Za-z_$][\\w$]*)\\(([^)]*)\\)$/);
    if (!m) { if (!execSpecial(s)) return; continue; }
    var fnName = m[1];
    if (!XR_ACTIONS.has(fnName)) return;
    var fn = window[fnName];
    if (typeof fn !== 'function') return;
    var argv = parseArgs(m[2]);
    if (argv === null) return;
    try { fn.apply(null, argv); } catch (e) { console.error('action failed:', fnName, e); }
  }
  if (stop && ev && ev.stopPropagation) ev.stopPropagation();
}
function parseArgs(raw) {
  var a = raw.trim();
  if (!a) return [];
  var out = [];
  var i = 0;
  while (i < a.length) {
    while (i < a.length && (a[i] === ' ' || a[i] === ',')) i++;
    if (i >= a.length) break;
    var c = a[i];
    if (c === "'" || c === '"') {
      var end = a.indexOf(c, i + 1);
      if (end < 0) return null;
      out.push(a.slice(i + 1, end));
      i = end + 1;
    } else if (c === String.fromCharCode(96)) {
      var end2 = a.indexOf(String.fromCharCode(96), i + 1);
      if (end2 < 0) return null;
      out.push(a.slice(i + 1, end2));
      i = end2 + 1;
    } else {
      var m = a.slice(i).match(/^(true|false|-?\\d+)/);
      if (!m) return null;
      out.push(m[1] === 'true' ? true : m[1] === 'false' ? false : Number(m[1]));
      i += m[1].length;
    }
  }
  return out;
}
function execSpecial(s) {
  // PALETTE_ITEMS[N].action() — fixed app data, index-checked.
  var pm = s.match(/^PALETTE_ITEMS\\[(\\d+)\\]\\.action\\(\\)$/);
  if (pm && window.PALETTE_ITEMS) {
    var idx = Number(pm[1]);
    var item = window.PALETTE_ITEMS[idx];
    if (item && typeof item.action === 'function') { item.action(); return true; }
    return false;
  }
  // this.parentElement.classList.toggle('open') — tool-card header; the
  // delegated click handler already targets the card, so no-op here.
  var cm = s.match(/^this\\.parentElement\\.classList\\.toggle\\('open'\\)$/);
  if (cm) { return true; }
  // document.getElementById('id')?.focus()
  var dm = s.match(/^document\\.getElementById\\('([A-Za-z0-9_-]+)'\\)\\?\\.focus\\(\\)$/);
  if (dm) { var e = document.getElementById(dm[1]); if (e && e.focus) e.focus(); return true; }
  // setTimeout(ident, num) — allowlisted identifier reference.
  var tm = s.match(/^setTimeout\\(([A-Za-z_$][\\w$]*), (\\d+)\\)$/);
  if (tm && XR_ACTIONS.has(tm[1])) {
    var f = window[tm[1]];
    if (typeof f === 'function') { setTimeout(f, Number(tm[2])); return true; }
    return false;
  }
  return false;
}
/* __XR_DISPATCHER_END__ */




// ── Phase 8 · T4 — Progressive disclosure, honest readiness, undo, toned badges
// All client-side (the composed HTML stays source-of-truth for the shell):
//   A. A compact "Start here" area + every other area collapsed until opened —
//      state persists in localStorage; opening any panel auto-reveals its area.
//   B. An honest readiness banner on Overview, computed from live endpoints
//      (never a static claim): Ready / Setup required / Degraded + ONE action.
//   C. Undo as a first-class action on Durable Memory (UndoLedger via daemon).
//   D. Standardized capability badges (works-now/setup-required/experimental/
//      unsupported-here) rendered from real lifecycle data, with WHY tooltips.
(function () {
  var AREA_KEY = "xr.nav.areas.v1";
  function loadAreas() { try { return JSON.parse(localStorage.getItem(AREA_KEY) || "{}"); } catch (e) { return {}; } }
  function areaIdFor(label) { return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"); }

  function applyAreaState(sec, open) {
    var t = sec.querySelector(":scope > .area-toggle");
    if (!t) return;
    t.setAttribute("aria-expanded", open ? "true" : "false");
    var caret = t.querySelector(".area-caret");
    if (caret) caret.textContent = open ? "▾" : "▸";
    Array.prototype.slice.call(sec.querySelectorAll(":scope > .nav-item")).forEach(function (el) {
      el.style.display = open ? "" : "none";
    });
  }
  function saveArea(id, open) { var m = loadAreas(); m[id] = open; localStorage.setItem(AREA_KEY, JSON.stringify(m)); }
  function revealAreaFor(panelId) {
    var item = document.querySelector('.sidebar .nav-item[data-panel="' + panelId + '"]');
    var sec = item && item.closest ? item.closest(".sidebar-section") : null;
    if (sec) {
      var t = sec.querySelector(":scope > .area-toggle");
      if (t && t.getAttribute("aria-expanded") !== "true") {
        applyAreaState(sec, true);
        if (sec.dataset.area) saveArea(sec.dataset.area, true);
      }
    }
  }

  function initDisclosure() {
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar || sidebar.dataset.disclosure === "1") return;
    sidebar.dataset.disclosure = "1";
    // A. "Start here": the four first-run essentials (real nav clones).
    var start = document.createElement("div");
    start.className = "sidebar-section";
    start.dataset.area = "start-here";
    var startLabel = document.createElement("button");
    startLabel.type = "button";
    startLabel.className = "sidebar-label area-toggle";
    startLabel.setAttribute("aria-expanded", "true");
    startLabel.innerHTML = 'Start here <span class="area-caret" aria-hidden="true">▾</span>';
    start.appendChild(startLabel);
    ["dashboard", "chat", "models", "settings"].forEach(function (pid) {
      var src = sidebar.querySelector('.nav-item[data-panel="' + pid + '"]');
      if (!src) return;
      var clone = src.cloneNode(true);
      clone.addEventListener("click", function () { navigateTo(pid); });
      start.appendChild(clone);
    });
    var first = sidebar.querySelector(":scope > .sidebar-section");
    sidebar.insertBefore(start, first);

    var saved = loadAreas();
    Array.prototype.slice.call(sidebar.querySelectorAll(":scope > .sidebar-section")).forEach(function (sec) {
      var label = sec.querySelector(":scope > .sidebar-label");
      if (!label) return;
      if (!sec.dataset.area) sec.dataset.area = areaIdFor(label.textContent);
      var id = sec.dataset.area;
      if (label.tagName !== "BUTTON") {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sidebar-label area-toggle";
        btn.innerHTML = label.textContent.trim() + ' <span class="area-caret" aria-hidden="true"></span>';
        sec.replaceChild(btn, label);
        label = btn;
      }
      // Default: only "Start here" is expanded (progressive disclosure);
      // everything the user opens stays open (localStorage).
      var open = id in saved ? !!saved[id] : id === "start-here";
      label.addEventListener("click", function () {
        var nowOpen = label.getAttribute("aria-expanded") !== "true";
        applyAreaState(sec, nowOpen);
        saveArea(id, nowOpen);
      });
      applyAreaState(sec, open);
    });
  }

  // Panels reached via palette/shortcut/chips reveal their area automatically.
  var _navigateTo = navigateTo;
  navigateTo = function (id) {
    revealAreaFor(id);
    return _navigateTo(id);
  };

  // B. Honest readiness — computed from the same live endpoints, never static.
  function readinessEl() {
    var el = document.getElementById("readiness-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "readiness-banner";
      el.setAttribute("role", "status");
      el.className = "card xr-s-6";
      var anchor = document.querySelector("#panel-dashboard .section-header");
      if (anchor) anchor.insertAdjacentElement("afterend", el);
    }
    return el;
  }
  async function updateReadiness() {
    var el = readinessEl();
    try {
      var ov = await api("/api/overview");
      var models = await api("/api/models");
      var ctx = null;
      try { ctx = await api("/api/context"); } catch (e) { /* context may be disabled — readiness stays honest without it */ }
      var auditOk = ov.audit && ov.audit.chain && ov.audit.chain.valid;
      var provider = (ov.provider && ov.provider.active) || "?";
      var model = (ov.provider && ov.provider.model) || "?";
      var local = !!(ov.provider && ov.provider.local);
      var running = !!(models.current && models.current.healthy);
      var pending = ctx && ctx.memory && ctx.memory.consent ? (ctx.memory.consent.proposed || 0) : 0;
      var verdict;
      if (!auditOk) {
        verdict = { tone: "err", word: "Degraded", text: "The audit chain failed verification — investigate before trusting history.", action: ["Open audit log", "audit"] };
      } else if (local && !running) {
        verdict = { tone: "warn", word: "Setup required", text: "The active route is a local model but no local model is running yet.", action: ["Set up a model", "models"] };
      } else if (pending > 0) {
        verdict = { tone: "warn", word: "Your call needed", text: pending + " memor" + (pending === 1 ? "y awaits" : "ies await") + " your consent decision — XR will not use them first.", action: ["Review memory", "memory"] };
      } else {
        verdict = { tone: "ok", word: "Ready", text: "Everything on this page is live from the local daemon — nothing staged.", action: null };
      }
      var facts = "provider " + provider + " · model " + model + " · " + (local ? "local-first" : "cloud route") + (running ? " · model running" : "");
      var badgeCls = verdict.tone === "ok" ? "badge-green" : verdict.tone === "warn" ? "badge-amber" : "badge-red";
      el.innerHTML =
        '<div class="card-header"><span class="card-title">Readiness</span>' +
        '<span class="badge ' + badgeCls + '">' + escapeHtml(verdict.word) + "</span></div>" +
        '<div class="muted xr-s-9">' + escapeHtml(verdict.text) + " " + escapeHtml(facts) + ".</div>" +
        (verdict.action ? '<div class="xr-s-31"><button type="button" class="btn btn-primary"></button></div>' : "");
      if (verdict.action) {
        var btn = el.querySelector("button");
        btn.textContent = verdict.action[0] + " →";
        (function (target) { btn.addEventListener("click", function () { navigateTo(target); }); })(verdict.action[1]);
      }
    } catch (e) {
      el.innerHTML = '<div class="card-header"><span class="card-title">Readiness</span><span class="badge badge-red">Unreachable</span></div><div class="muted xr-s-9">Could not compute readiness: ' + escapeHtml(String(e && e.message ? e.message : e)) + "</div>";
    }
  }
  var _loadDashboard = loadDashboard;
  loadDashboard = async function () {
    var r = _loadDashboard.apply(this, arguments);
    try { await r; } catch (e) { /* original handles its own errors */ }
    await updateReadiness();
  };

  // C. Undo on Durable Memory (restore data, never authority).
  function initUndoButton() {
    var header = document.querySelector("#panel-memory .section-header");
    if (!header || document.getElementById("mem-undo-btn")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "mem-undo-btn";
    btn.className = "btn btn-ghost";
    btn.title = "Undo the most recent memory/context mutation (restores the exact prior state)";
    btn.textContent = "↶ Undo last change";
    btn.addEventListener("click", async function () {
      try {
        var res = await apiPost("/api/context/undo", {});
        toast(res.ok ? "Undone — restored " + res.restoredTarget.table + " " + res.restoredTarget.id : "Nothing to undo", res.ok ? "ok" : "info");
        loadMemory();
      } catch (e) {
        toast("Nothing to undo", "info");
      }
    });
    header.appendChild(btn);
  }

  // D. Standardized capability badges from real lifecycle data.
  function capabilityBadge(c) {
    var state = (c.lifecycle && c.lifecycle.state) || "unknown";
    var enabled = !!(c.lifecycle && c.lifecycle.enabled);
    var cert = (c.certification && c.certification.status) || "unknown";
    if (state === "quarantined") return ["unsupported-here", "badge-red", "Quarantined — blocked from running in this workspace"];
    if (state === "experimental" || cert === "self-tested") return ["experimental", "badge-violet", "Experimental — unverified; evaluate before relying on it"];
    if (!enabled) return ["setup-required", "badge-amber", "Installed but not enabled — finish setup before it can run"];
    return ["works-now", "badge-green", "Enabled and verified to work in this workspace (" + cert + ")"];
  }
  window.__xrT4 = { capabilityBadge: capabilityBadge, updateReadiness: updateReadiness, revealAreaFor: revealAreaFor };
  initDisclosure();
  initUndoButton();
  // The wrapper above only sees LATER dashboard loads — compute readiness for
  // the initial paint as well (updateReadiness has its own failure path).
  updateReadiness();
})();

`;
