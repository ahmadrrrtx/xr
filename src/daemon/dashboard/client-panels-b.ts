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

// ── MCP Servers
async function loadMcp() {
  try {
    const list = await api("/api/mcp").catch(() => []);
    document.getElementById("mcp-servers-list").innerHTML = list.length ? list.map(s => \`
      <div class="stat-row">
        <div><strong>\${escapeHtml(s.id)}</strong><br><span class="muted mono">\${escapeHtml(s.cmd)} \${escapeHtml(s.args.join(" "))}</span></div>
        <button class="btn btn-danger xr-s-60" data-xr-action="\${act('removeMcp', s.id)}">✕</button>
      </div>
    \`).join("") : "<div class='muted'>No Model Context Protocol connections registered.</div>";
  } catch {}
}
async function registerMcp() {
  const id = document.getElementById("mcp-create-id")?.value.trim();
  const cmd = document.getElementById("mcp-create-cmd")?.value.trim();
  const argsRaw = document.getElementById("mcp-create-args")?.value.trim();
  if(!id || !cmd) return toast("ID and Command required", "warn");
  const args = argsRaw ? argsRaw.split(/\\s+/) : [];
  try {
    await api("/api/mcp/add", { method:"POST", body: { id, cmd, args } });
    toast("MCP Server added successfully", "ok");
    document.getElementById("mcp-create-id").value = "";
    document.getElementById("mcp-create-cmd").value = "";
    document.getElementById("mcp-create-args").value = "";
    loadMcp();
  } catch(e) { toast(e.message, "err"); }
}

`;
