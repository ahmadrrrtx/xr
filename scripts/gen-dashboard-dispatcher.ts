/**
 * XR Phase 4 · T5 — generate the CSP-safe action dispatcher for the dashboard.
 *
 * The strict CSP (script-src 'self') forbids inline event handlers, so every
 * `data-xr-action="fn('arg')"` attribute is dispatched by a WHITELIST parser:
 *   · the function name must be in the allowlist below (plus a typeof check);
 *   · arguments must be single-quoted literals, template literals (content),
 *     booleans or integers — anything else is ignored (fail closed);
 *   · a tiny set of fixed no-ops / member calls is recognized by exact pattern.
 *
 * NEVER eval. Deterministic grammar, fixed allowlist.
 *
 * The block is embedded inside the DASHBOARD_SCRIPT template literal, so this
 * generator escapes the block for that context (backslash → `\\`, backtick →
 * `\``, `${` → `\${`) — the written file is exactly what the template must
 * contain to yield the runtime code below.
 *
 * Usage: bun run scripts/gen-dashboard-dispatcher.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

/** Every function referenced by data-xr-action in the dashboard (static +
 *  runtime-generated). Adding a new action REQUIRES adding it here — that is
 *  the point: the dashboard's interactive surface is an explicit allowlist. */
const XR_ACTIONS = [
  "answerApproval", "approveMemory", "capabilityInspect", "capabilityQuarantine",
  "chatArchiveActive", "chatBranchFromLast", "chatExportActive", "chatNewChat",
  "chatSelectChat", "chatTogglePin", "clearMemory", "clearNotifications",
  "closePalette", "copyText", "createWorkspace", "cycleChatMode", "deleteMemory",
  "doMemSearch", "downloadArtifact", "editMessage", "emergencyStopControl",
  "exportFullData", "focusChangeModel", "insertHint", "inspectMarketplaceSkill",
  "installMarketplaceSkill", "killProcess", "loadAuditLog", "loadBudgetPanel",
  "loadCapabilities", "loadMarketplace", "loadMcp", "loadModels", "loadPlugins",
  "loadResearchDetail", "loadResearchPanel", "loadSessionDetail",
  "loadSessionsPanel", "loadWorkspaces", "navigateTo", "openAttachmentPicker",
  "openPalette", "pickInstalledModel", "pluginAction", "pluginRemove",
  "quarantineFile", "refreshAll", "registerMcp", "removeAttachment",
  "removeMcp", "revokeMemory", "runSecLab", "runShieldScan", "saveAllSettings",
  "saveBudgetConfig", "saveModelSelection", "saveProviderRouting",
  "searchPlugins", "sendChatMessage", "setMarketFilter", "setMarketQuery",
  "setMarketSort", "setTimeout", "skillAction", "switchSettingsPane",
  "switchShieldTab", "switchWorkspaceUI", "syncMarketplace",
  "testModelSelection", "toast", "toggleComposerFlag", "toggleShieldAdBlock",
  "verifyAuditLedger",
];

/** The RUNTIME code exactly as the browser must receive it. */
const RUNTIME_BLOCK = `
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
var XR_ACTIONS = new Set(${JSON.stringify(XR_ACTIONS)});
document.addEventListener('click', function (ev) {
  var el = ev.target && ev.target.closest ? ev.target.closest('[data-xr-action]') : null;
  if (!el) return;
  var expr = el.getAttribute('data-xr-action');
  if (!expr) return;
  runXrAction(expr, ev);
});
// keyup actions (e.g. the settings search box): dispatched through the same
// allowlist parser.
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
`;

/** Escape the runtime block for embedding in the DASHBOARD_SCRIPT template. */
function escapeForTemplate(block: string): string {
  let out = "";
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (c === "\\") out += "\\\\";
    else if (c === "`") out += "\\`";
    else if (c === "$" && block[i + 1] === "{") {
      out += "\\${";
      i++;
    } else out += c;
  }
  return out;
}

const TARGET = "src/daemon/dashboard/client-script.ts";
const MARKER_START = "// Phase 4 · T5 — build a safely-quoted data-xr-action";
const MARKER_END = "/* __XR_DISPATCHER_END__ */";

export function generate(): void {
  const src = readFileSync(TARGET, "utf8");
  const block = escapeForTemplate(RUNTIME_BLOCK);
  let out: string;
  const start = src.indexOf(MARKER_START);
  const end = src.indexOf(MARKER_END);
  if (start >= 0 && end >= 0) {
    out = src.slice(0, start) + block + src.slice(end + MARKER_END.length);
  } else {
    const idx = src.lastIndexOf("`;");
    if (idx < 0) throw new Error("cannot locate DASHBOARD_SCRIPT closing delimiter");
    out = src.slice(0, idx) + block + "\n" + src.slice(idx);
  }
  writeFileSync(TARGET, out);
  console.log(`dispatcher regenerated with ${XR_ACTIONS.length} allowlisted actions`);
}

if (import.meta.main) generate();
