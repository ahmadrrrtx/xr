/**
 * XR Control Center served-client fragment — skills marketplace, capabilities, plugins, MCP panels.
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const PANELS_B = `// ── Skills Marketplace
let MARKET_FILTER = "all";
let MARKET_SORT = "relevance";
let MARKET_ROWS = [];
let MARKET_SELECTED = null;

function setMarketFilter(filter) {
  MARKET_FILTER = filter;
  document.querySelectorAll("[data-market-filter]").forEach(el => el.classList.toggle("active", el.dataset.marketFilter === filter));
  renderMarketplace();
}
function setMarketSort(sort) {
  MARKET_SORT = sort;
  document.querySelectorAll("[data-market-sort]").forEach(el => el.classList.toggle("active", el.dataset.marketSort === sort));
  renderMarketplace();
}
function setMarketQuery(q) {
  document.getElementById("market-search").value = q;
  loadMarketplace();
}

async function loadMarketplace() {
  try {
    const q = document.getElementById("market-search")?.value ?? "";
    const data = await api("/api/skills/marketplace" + (q ? "?q=" + encodeURIComponent(q) : ""));
    MARKET_ROWS = (data.skills ?? []).map(normalizeMarketplaceSkill);
    const stats = data.stats ?? {};

    document.getElementById("market-installed").textContent = stats.installed;
    document.getElementById("market-verified").textContent = stats.verified;
    document.getElementById("market-updates").textContent = stats.updates;
    // sandbox indexes: OK only when the registry actually responded
    document.getElementById("market-runtime").textContent = "OK";

    renderMarketCategories(MARKET_ROWS);
    renderMarketplace();
    if (!MARKET_SELECTED && MARKET_ROWS[0]) inspectMarketplaceSkill(MARKET_ROWS[0].id);
  } catch {
    document.getElementById("market-runtime").textContent = "—";
  }
}

function renderMarketCategories(rows) {
  const counts = {};
  for (const s of rows) for (const c of s.categories ?? []) counts[c] = (counts[c] ?? 0) + 1;
  const cats = ["developer","security","research","business","creative","productivity"];
  document.getElementById("market-categories").innerHTML = cats.map(c => \`
    <div class="mp-cat" role="button" tabindex="0" data-xr-action="\${act('setMarketQuery', c)}">
      <b>\${categoryIcon(c)} \${c}</b>
      <span>\${counts[c] ?? 0}</span>
    </div>
  \`).join("");
}

function filteredMarketplaceRows() {
  let rows = [...MARKET_ROWS];
  if (MARKET_FILTER === "installed") rows = rows.filter(s => s.installed);
  if (MARKET_FILTER === "verified") rows = rows.filter(s => ["official","verified"].includes(s.verification));
  if (MARKET_FILTER === "updates") rows = rows.filter(s => s.updateAvailable);
  return rows;
}

function renderMarketplace() {
  const rows = filteredMarketplaceRows();
  const grid = document.getElementById("market-grid");
  if (!grid) return;
  grid.innerHTML = rows.length ? rows.map(s => {
    const sel = MARKET_SELECTED === s.id ? " selected" : "";
    const action = s.installed
      ? (s.enabled ? \`<button class="btn btn-ghost" data-xr-action="event.stopPropagation(); \${act('skillAction', s.id, 'disable')}">Disable</button>\` : \`<button class="btn" data-xr-action="event.stopPropagation(); \${act('skillAction', s.id, 'enable')}">Enable</button>\`)
      : \`<button class="btn btn-primary" data-xr-action="event.stopPropagation(); \${act('installMarketplaceSkill', s.id)}">Install</button>\`;
    return \`
      <div class="mp-skill-card\${sel}" data-xr-action="\${act('inspectMarketplaceSkill', s.id)}">
        <div class="mp-skill-top">
          <div class="mp-skill-icon">\${skillInitials(s.name)}</div>
          <div class="xr-s-93">
            <div class="mp-skill-name">\${escapeHtml(s.name)}</div>
            <div class="mp-skill-id">\s\${s.id}</div>
          </div>
        </div>
        <div class="mp-desc">\${escapeHtml(s.description || "")}</div>
        <div class="mp-actions"><button class="btn btn-ghost" aria-label="Details for \${escapeHtml(s.name)}" data-xr-action="event.stopPropagation(); \${act('inspectMarketplaceSkill', s.id)}">Details</button>\${action}</div>
      </div>
    \`;
  }).join("") : "<div class='mp-panel-empty'>No matching Skills available in registry.</div>";
}

async function inspectMarketplaceSkill(id) {
  MARKET_SELECTED = id;
  renderMarketplace();
  try {
    const data = await api("/api/skills/" + encodeURIComponent(id) + "/inspect");
    const s = normalizeMarketplaceSkill(data.skill);
    const perms = data.permissions;
    const permRows = ([...(perms?.safe ?? []), ...(perms?.dangerous ?? [])]).map(p => \`
      <div class="mp-perm">
        <div class="mp-perm-head"><b>\${escapeHtml(p.scope)}</b> <span class="text-cyan">\${p.granted ? 'granted':'approval required'}</span></div>
        <p class="muted">\${escapeHtml(p.reason)}</p>
      </div>
    \`).join("") || "<div class='muted'>No specialized local permissions needed.</div>";

    document.getElementById("market-inspector").innerHTML = \`
      <div class="xr-s-94">
        <div class="mp-skill-icon xr-s-95">\${skillInitials(s.name)}</div>
        <div>
          <h4 class="xr-s-96">\${escapeHtml(s.name)}</h4>
          <div class="mp-inspector-sub">\${s.id} · v\${s.version}</div>
        </div>
      </div>
      <p class="muted xr-s-97">\${escapeHtml(s.description)}</p>
      <div class="mp-section-title">Security Sandboxing</div>
      \${permRows}
    \`;
  } catch {}
}

async function installMarketplaceSkill(id) {
  try {
    await api("/api/skills/marketplace/install", { method:"POST", body: { id } });
    toast("Skill deployment initiated", "ok");
    loadMarketplace();
  } catch(e) { toast(e.message, "err"); }
}
async function skillAction(id, action) {
  try {
    await api("/api/skills/" + encodeURIComponent(id) + "/" + action, { method:"POST" });
    toast("Skill updated: " + action + "d", "ok");
    loadMarketplace();
  } catch {}
}
async function syncMarketplace() {
  try {
    await api("/api/skills/marketplace/sync", { method:"POST" });
    toast("Synchronized online registries", "ok");
    loadMarketplace();
  } catch {}
}

// ── Capability Ecosystem
async function loadCapabilities(searchMode=false) {
  try {
    const q = searchMode ? (document.getElementById("cap-search")?.value || "") : "";
    const url = q ? "/api/capabilities?task=" + encodeURIComponent(q) : "/api/capabilities";
    const data = await api(url);
    const health = data.health || {};
    const list = data.capabilities || [];
    document.getElementById("cap-total").textContent = health.total ?? list.length;
    document.getElementById("cap-enabled").textContent = health.enabled ?? list.filter(c => c.lifecycle && c.lifecycle.enabled).length;
    document.getElementById("cap-certified").textContent = health.certified ?? list.filter(c => c.certification && ["verified","xr-tested","self-tested"].includes(c.certification.status)).length;
    document.getElementById("cap-quarantined").textContent = health.quarantined ?? list.filter(c => c.lifecycle && c.lifecycle.state === "quarantined").length;
    document.getElementById("capabilities-list").innerHTML = list.length ? list.slice(0,100).map(c => \`
      <div class="stat-row xr-s-98">
        <div>
          <strong>\${escapeHtml(c.name)}</strong> <span class="mono text-cyan">\${escapeHtml(c.id)}</span>
          <div class="muted xr-s-99">\${escapeHtml(c.type)} · \${escapeHtml(c.version)} · risk \${escapeHtml(c.placement?.riskTier || "unknown")} · cert \${escapeHtml(c.certification?.status || "unknown")}</div>
          <div class="muted xr-s-99">effective: \${escapeHtml((c.permissions?.effective?.effective || []).join(", ") || "none")}</div>
        </div>
        <div class="xr-s-100">
          \${(() => { const b = window.__xrT4.capabilityBadge(c); return '<span class="badge ' + b[1] + '" title="' + escapeHtml(b[2]) + '">' + b[0] + "</span>"; })()}
          <span class="badge badge-gray">\${escapeHtml(c.lifecycle?.state || "unknown")}</span>
          <button class="btn btn-ghost" data-xr-action="\${act('capabilityInspect', c.id)}">Inspect</button>
          \${c.lifecycle?.state === "quarantined" ? "" : \`<button class="btn btn-danger" data-xr-action="\${act('capabilityQuarantine', c.id)}">Quarantine</button>\`}
        </div>
      </div>
    \`).join("") : "<div class='muted'>No capabilities match the current constraints.</div>";
  } catch (e) {
    document.getElementById("capabilities-list").innerHTML = "<div class='muted'>Capability inspection unavailable.</div>";
  }
}
async function capabilityInspect(id) {
  try {
    const c = await api("/api/capabilities/inspect?id=" + encodeURIComponent(id));
    alert(c.id + "\\npublisher: " + (c.publisher?.name || "unknown") + "\\neffective: " + ((c.permissions?.effective?.effective || []).join(", ") || "none") + "\\nsignature: " + (c.package?.signatureStatus || "unknown") + "\\ncertification: " + (c.certification?.status || "unknown"));
  } catch {}
}
async function capabilityQuarantine(id) {
  const reason = prompt("Quarantine reason", "manual dashboard quarantine");
  if (!reason) return;
  try {
    await api("/api/capabilities/quarantine", { method:"POST", body:{ id, reason } });
    toast("Capability quarantined", "ok");
    loadCapabilities();
  } catch {}
}

// ── Sandboxed Plugins
async function loadPlugins() {
  try {
    const data = await api("/api/plugins");
    const list = data.plugins ?? [];
    document.getElementById("plug-installed").textContent = list.length;
    document.getElementById("plug-enabled").textContent = list.filter(p => p.enabled).length;

    document.getElementById("plugins-list").innerHTML = list.length ? list.map(p => \`
      <div class="stat-row xr-s-101">
        <div>
          <strong>\${escapeHtml(p.name)}</strong> <span class="mono text-cyan">\${p.id}</span>
          <div class="muted xr-s-99">v\${p.version} · \${p.type}</div>
        </div>
        <div class="xr-s-17">
          \s\${p.enabled ? \`<button class="btn btn-ghost" data-xr-action="\${act('pluginAction', p.id, 'disable')}">Disable</button>\` : \`<button class="btn" data-xr-action="\${act('pluginAction', p.id, 'enable')}">Enable</button>\`}
          <button class="btn btn-danger" data-xr-action="\${act('pluginRemove', p.id)}">Remove</button>
        </div>
      </div>
    \`).join("") : "<div class='muted'>No deep integration plugins active.</div>";
  } catch {}
}

async function searchPlugins() {
  const q = document.getElementById("plugin-search")?.value ?? "";
  try {
    const data = await api("/api/plugins/catalog?q=" + encodeURIComponent(q));
    const list = data.plugins ?? [];
    document.getElementById("plugins-catalog").innerHTML = list.length ? list.map(p => \`
      <div class="stat-row xr-s-102">
        <div><strong>\${escapeHtml(p.name)}</strong><br><span class="muted">\${escapeHtml(p.description)}</span></div>
        <span class="badge badge-gray">Install via CLI</span>
      </div>
    \`).join("") : "<div class='muted'>No plugins match search query.</div>";
  } catch {}
}

async function pluginAction(id, action) {
  try {
    await api("/api/plugins/" + encodeURIComponent(id) + "/" + action, { method:"POST" });
    toast("Plugin state saved: " + action + "d", "ok");
    loadPlugins();
  } catch {}
}
async function pluginRemove(id) {
  if (confirm("Uninstall plugin " + id + "?")) {
    try {
      await api("/api/plugins/" + encodeURIComponent(id) + "/remove", { method:"DELETE" });
      toast("Plugin deleted", "ok");
      loadPlugins();
    } catch {}
  }
}

// ── MCP Servers — the SAME registry the xr mcp CLI persists
// (~/.xr/mcp/registry.json). Before Phase 2 these calls hit endpoints that did
// not exist and the panel silently showed an empty list forever.
async function loadMcp() {
  try {
    const data = await api("/api/mcp").catch(() => ({ servers: [] }));
    const servers = data.servers ?? [];
    document.getElementById("mcp-servers-list").innerHTML = servers.length ? servers.map(s => \`
      <div class="stat-row">
        <div class="xr-s-106">
          <strong>\${escapeHtml(s.id)}</strong>
          <span class="muted mono xr-s-85">\${escapeHtml(s.transport === "stdio" ? ((s.command ?? "?") + " " + (s.args ?? []).join(" ")) : (s.url ?? "?"))}</span>
        </div>
        <span class="badge \${s.enabled ? "badge-green" : "badge-gray"}">\${s.enabled ? "enabled" : "disabled"}</span>
        <div class="xr-s-37">
          \${s.enabled
            ? \`<button class="btn btn-ghost xr-s-2" data-xr-action="\${act('disableMcp', s.id)}">Disable</button>\`
            : \`<button class="btn btn-ghost xr-s-2" data-xr-action="\${act('enableMcp', s.id)}">Enable</button>\`}
          <button class="btn btn-danger xr-s-2" data-xr-action="\${act('removeMcp', s.id)}">Remove</button>
        </div>
      </div>
    \`).join("") : "<div class='muted'>No MCP servers registered — add one here or with <span class=\\\"mono\\\">xr mcp add</span>.</div>";
  } catch {}
}
async function registerMcp() {
  const id = document.getElementById("mcp-create-id")?.value.trim();
  const url = document.getElementById("mcp-create-url")?.value.trim();
  const cmd = document.getElementById("mcp-create-cmd")?.value.trim();
  const enable = !!(document.getElementById("mcp-create-enable")?.checked);
  if (!id) return toast("Server id is required", "warn");
  if (!url && !cmd) return toast("Give a command (stdio) or a URL (remote)", "warn");
  const body = url
    ? { id, transport: "http", url, enabled: enable }
    : { id, transport: "stdio", cmd, enabled: enable };
  try {
    await api("/api/mcp/add", { method: "POST", body });
    toast("MCP server registered", "ok");
    document.getElementById("mcp-create-id").value = "";
    document.getElementById("mcp-create-url").value = "";
    document.getElementById("mcp-create-cmd").value = "";
    loadMcp();
  } catch (e) { toast(e.message, "err"); }
}
async function enableMcp(id) {
  try { await api("/api/mcp/enable", { method: "POST", body: { id } }); toast(id + " enabled", "ok"); loadMcp(); } catch (e) { toast(e.message, "err"); }
}
async function disableMcp(id) {
  try { await api("/api/mcp/disable", { method: "POST", body: { id } }); toast(id + " disabled", "ok"); loadMcp(); } catch (e) { toast(e.message, "err"); }
}
async function removeMcp(id) {
  try { await api("/api/mcp/remove", { method: "POST", body: { id } }); toast(id + " removed", "ok"); loadMcp(); } catch (e) { toast(e.message, "err"); }
}
async function probeMcpHealth() {
  const el = document.getElementById("mcp-health-report");
  if (!el) return;
  el.innerHTML = "<div class='spinner'></div>";
  try {
    const data = await api("/api/mcp/health");
    const reports = data.reports ?? [];
    el.innerHTML = reports.length ? reports.map(r => \`
      <div class="stat-row">
        <span class="stat-val mono">\${escapeHtml(r.id ?? r.serverId ?? "?")}</span>
        <span class="badge \${r.ok || r.status === "ok" || r.health === "ok" ? "badge-green" : "badge-red"}">\${escapeHtml(String(r.status ?? r.health ?? (r.ok ? "ok" : "unreachable")))}</span>
        <span class="stat-key truncate">\${escapeHtml(r.detail ?? r.reason ?? "")}</span>
      </div>\`).join("") : "<div class='muted'>No registered servers to probe.</div>";
  } catch (e) {
    el.innerHTML = "<div class='muted'>Health probe failed: " + escapeHtml(e.message) + "</div>";
  }
}

// ── Automation — the live trigger registry (/api/triggers). The old panel
// was a static "no jobs" card that never contacted the daemon.
async function loadAutomation() {
  try {
    const data = await api("/api/triggers").catch(() => ({ triggers: [] }));
    const triggers = data.triggers ?? [];
    document.getElementById("auto-count").textContent = String(triggers.length);
    document.getElementById("auto-enabled").textContent = String(triggers.filter(t => t.enabled).length);
    document.getElementById("auto-inflight").textContent = String(data.inflight ?? 0);
    const pausedEl = document.getElementById("auto-paused");
    pausedEl.textContent = data.pauseAll ? "Paused" : "Active";
    pausedEl.className = "card-value " + (data.pauseAll ? "text-amber" : "text-green");
    const specText = (t) => {
      const s = t.spec ?? {};
      if (s.kind === "cron") return "cron " + (s.expr ?? s.nl ?? "?");
      if (s.kind === "event") return "on " + s.event;
      if (s.kind === "watch") return "watch " + s.path;
      return s.kind ?? "?";
    };
    document.getElementById("auto-trigger-list").innerHTML = triggers.length ? triggers.map(t => \`
      <div class="stat-row">
        <span class="stat-val mono">\${escapeHtml(t.id ?? "?")}</span>
        <span class="stat-key truncate">\${escapeHtml(specText(t))} — \${escapeHtml(t.taskTemplate ?? "")}</span>
        <span class="badge \${t.enabled ? "badge-green" : "badge-gray"}">\${t.enabled ? "enabled" : "paused"}</span>
        <span class="mono muted xr-s-71">\${t.spentUsd ? "$" + Number(t.spentUsd).toFixed(4) : "$0"}</span>
      </div>\`).join("") : "<div class='muted'>No triggers registered. Create one below or with <span class=\\\"mono\\\">xr cron add</span>.</div>";
  } catch (e) {
    const el = document.getElementById("auto-trigger-list");
    if (el) el.innerHTML = "<div class='muted'>Trigger registry unreachable: " + escapeHtml(e.message) + "</div>";
  }
}
async function createTrigger() {
  const expr = document.getElementById("auto-new-expr")?.value.trim();
  const task = document.getElementById("auto-new-task")?.value.trim();
  const consent = document.getElementById("auto-new-consent")?.value.trim();
  if (!expr || !task) return toast("Cron expression and task are required", "warn");
  try {
    await api("/api/triggers", { method: "POST", body: {
      kind: "cron", spec: { kind: "cron", expr },
      taskTemplate: task, budget: {}, consentRef: consent || "daemon:dashboard"
    } });
    toast("Trigger created", "ok");
    document.getElementById("auto-new-expr").value = "";
    document.getElementById("auto-new-task").value = "";
    loadAutomation();
  } catch (e) { toast(e.message, "err"); }
}
async function toggleTriggersPause() {
  try {
    const cur = await api("/api/triggers");
    await api("/api/triggers/pause", { method: "POST", body: { pauseAll: !cur.pauseAll, actor: "dashboard" } });
    toast(!cur.pauseAll ? "All triggers paused" : "Triggers resumed", "ok");
    loadAutomation();
  } catch (e) { toast(e.message, "err"); }
}

// ── Agents — live workflows + honestly-labelled built-in roles
// (/api/agents). The old route returned three hardcoded "agents" that were
// really static product roles dressed up as instances.
async function loadAgents() {
  try {
    const data = await api("/api/agents");
    const wf = data.workflows ?? [];
    const health = data.health ?? { workflows: {} };
    document.getElementById("agents-wf-total").textContent = String(health.workflows?.total ?? wf.length);
    document.getElementById("agents-wf-running").textContent = String(health.workflows?.running ?? 0);
    const blocked = (health.workflows?.blocked ?? 0) + (health.workflows?.failed ?? 0);
    document.getElementById("agents-wf-blocked").textContent = String(blocked);
    document.getElementById("agents-roles-count").textContent = String((data.roles ?? []).length);
    document.getElementById("agents-wf-list").innerHTML = wf.length ? wf.map(w => \`
      <div class="stat-row">
        <span class="stat-val truncate">\${escapeHtml(w.goal ?? w.id ?? "?")}</span>
        <span class="badge \${w.status === "completed" ? "badge-green" : w.status === "running" ? "badge-cyan" : "badge-amber"}">\${escapeHtml(w.status ?? "?")}</span>
        <span class="stat-key mono">\${(w.tasks?.completed ?? 0)}/\${(w.tasks?.total ?? 0)} tasks</span>
        <span class="stat-key">\${new Date(w.updatedAt ?? w.createdAt ?? 0).toLocaleString()}</span>
      </div>\`).join("") : "<div class='muted'>No multi-agent workflows yet. Start one from the terminal: <span class=\\\"mono\\\">xr agents run \\\"goal\\\"</span>.</div>";
    document.getElementById("agents-roles-list").innerHTML = (data.roles ?? []).map(r => \`
      <div class="stat-row">
        <span class="stat-val"><strong>\${escapeHtml(r.name)}</strong> <span class="badge badge-violet">built-in</span></span>
        <span class="stat-key truncate">\${escapeHtml(r.purpose ?? "")}</span>
      </div>\`).join("");
  } catch (e) {
    const el = document.getElementById("agents-wf-list");
    if (el) el.innerHTML = "<div class='muted'>Agent store unreachable: " + escapeHtml(e.message) + "</div>";
  }
}

// ── Approvals panel — the durable cross-surface queue (/api/approvals).
// Decisions POST to the canonical /api/approvals/:id/decision endpoint and
// release the waiting run, exactly like answering in the terminal.
async function loadApprovalsPanel() {
  try {
    const data = await api("/api/approvals");
    const pending = data.pending ?? [];
    const countEl = document.getElementById("approvals-count");
    if (countEl) {
      countEl.textContent = pending.length + " pending";
      countEl.className = "badge " + (pending.length ? "badge-amber" : "badge-green");
    }
    const badge = document.getElementById("nav-approvals-badge");
    if (badge) {
      badge.hidden = !pending.length;
      badge.textContent = String(pending.length);
    }
    document.getElementById("approvals-list").innerHTML = pending.length ? pending.map(a => \`
      <div class="approval-card" role="group" aria-label="Approval: \${escapeHtml(a.tool ?? "action")}">
        <div class="approval-what"><strong>\${escapeHtml(a.tool ?? "action")}</strong> <span class="badge badge-violet">\${escapeHtml(a.surface ?? "agent")}</span></div>
        <div class="approval-why">\${escapeHtml(a.preview || a.reason || 'This action needs your permission.')}</div>
        <div class="approval-risk">
          <span class="badge \${a.riskTier === "destructive" ? "badge-red" : a.riskTier === "sensitive" ? "badge-amber" : "badge-green"}">\${escapeHtml((a.riskTier ?? "standard").toUpperCase())}</span>
          <span class="approval-risk-reason">requested \${new Date(a.requestedAt ?? 0).toLocaleTimeString()} · expires \${new Date(a.expiresAt ?? 0).toLocaleTimeString()}</span>
        </div>
        <div class="approval-btns">
          <button class="btn btn-primary" data-xr-action="decideApproval('\${a.id}', true)">Allow</button>
          <button class="btn btn-danger" data-xr-action="decideApproval('\${a.id}', false)">Deny</button>
        </div>
      </div>\`).join("") : "<div class='muted'>Nothing is waiting on you. Approvals raised by any surface (CLI, chat, triggers) appear here.</div>";
  } catch (e) {
    const el = document.getElementById("approvals-list");
    if (el) el.innerHTML = "<div class='muted'>Approval store unreachable: " + escapeHtml(e.message) + "</div>";
  }
}
async function decideApproval(id, approved) {
  try {
    await api("/api/approvals/" + encodeURIComponent(id) + "/decision", { method: "POST", body: { approved } });
    toast(approved ? "Action authorized" : "Action blocked", approved ? "ok" : "warn");
    loadApprovalsPanel();
  } catch (e) { toast(e.message, "err"); }
}

`;
