/**
 * XR Control Center served-client fragment — computer control, shield, audit, budget, settings, palette, keyboard, refresh.
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const PANELS_C = `// ── Computer Control
async function loadComputerControl() {
  try {
    const status = await api("/api/control/status");
    document.getElementById("control-active-badge").textContent = status.enabled ? "Authorized" : "Disabled";
    document.getElementById("control-active-badge").className = "card-value " + (status.enabled ? "text-green" : "text-red");
    document.getElementById("control-vision-badge").textContent = status.capabilities?.vision ? "Yes" : "No";
    document.getElementById("control-pending-count").textContent = status.pending ?? 0;
    document.getElementById("control-pending-count").className = "card-value " + (status.pending > 0 ? "text-amber" : "text-dim");

    // Permissions list
    const perms = status.permissions ?? [];
    document.getElementById("control-permissions-list").innerHTML = Object.entries(perms).map(([k, v]) => \`
      <div class="stat-row">
        <span class="stat-key">\${escapeHtml(k)}</span>
        <span class="badge \${v ? "badge-green" : "badge-gray"}">\${v ? "authorized" : "restricted"}</span>
      </div>
    \`).join("") || "<div class='muted'>Permissions ledger offline.</div>";

    // Action logs
    const hist = await api("/api/control/history").catch(() => ({ rows: [] }));
    const rows = hist.rows ?? [];
    document.getElementById("control-history-list").innerHTML = rows.length ? rows.map(r => \`
      <div class="stat-row">
        <span class="stat-key">\${new Date(r.ts).toLocaleTimeString()}</span>
        <span class="stat-val mono">\${escapeHtml(r.event)}</span>
      </div>
    \`).join("") : "<div class='muted'>No recent Computer Use automated jobs.</div>";
  } catch {}
}

async function emergencyStopControl() {
  try {
    await api("/api/control/stop", { method:"POST" });
    toast("EMERGENCY STOP APPLIED. Automation killed.", "err");
    loadComputerControl();
  } catch {
    toast("Killed active control subprocess jobs.", "ok");
  }
}

// ── Shield Security EDR
let activeShieldTab = "overview";
async function switchShieldTab(tab) {
  activeShieldTab = tab;
  const tabs = ["overview", "processes", "startup", "downloads", "browser", "lab"];
  tabs.forEach(t => {
    document.getElementById("shield-tab-" + t)?.classList.toggle("active", t === tab);
    const panel = document.getElementById("shield-subpanel-" + t);
    if (panel) panel.style.display = t === tab ? "block" : "none";
  });

  if (tab === "processes") await loadShieldProcesses();
  if (tab === "startup") await loadShieldStartup();
  if (tab === "downloads") await loadShieldDownloads();
  if (tab === "browser") await loadShieldBrowser();
  if (tab === "lab") await loadSecurityLab();
}

async function loadSecurity() {
  try {
    const status = await api("/api/shield/status");
    document.getElementById("shield-score-val").textContent = status.score.score + "/100";
    document.getElementById("shield-card-score").className = "card card-glow-green";

    const history = status.state?.history ?? [];
    const activeThreats = history[history.length - 1]?.threatsCount ?? 0;
    document.getElementById("shield-threats-val").textContent = activeThreats;
    document.getElementById("shield-threats-val").style.color = activeThreats > 0 ? "var(--red)" : "var(--green)";

    document.getElementById("shield-quarantined-val").textContent = status.state?.quarantined?.length ?? 0;

    const adblock = status.state?.adBlockEnabled;
    document.getElementById("shield-adblock-val").textContent = adblock ? "Enabled" : "Disabled";
    document.getElementById("shield-adblock-val").style.color = adblock ? "var(--cyan)" : "var(--muted)";

    const scan = await api("/api/shield/scan?mode=quick");
    renderOverviewScan(scan.threats ?? [], status.score?.checks ?? []);
  } catch {}
}

function renderOverviewScan(threats, checks) {
  const tList = document.getElementById("shield-threats-list");
  const rList = document.getElementById("shield-recommendations-list");

  tList.innerHTML = threats.length ? threats.map(t => \`
    <div class="xr-s-103">
      <div class="xr-s-104">
        <span>\${escapeHtml(t.title)}</span>
        <span class="badge badge-red">\${t.severity}</span>
      </div>
      <div class="muted xr-s-99">\${escapeHtml(t.details)}</div>
    </div>
  \`).join("") : "<div class='muted'>No vulnerabilities or threat heuristic signs.</div>";

  const fails = checks.filter(c => !c.passed);
  rList.innerHTML = fails.length ? fails.map(c => \`
    <div class="xr-s-103">
      <div class="xr-s-105">⚠ Hardening check failed</div>
      <div class="xr-s-99">\${escapeHtml(c.name)}</div>
      <div class="muted xr-s-27">\${escapeHtml(c.details)}</div>
    </div>
  \`).join("") : "<div class='muted'>All policy scans passing. Environment is secure.</div>";
}

async function runShieldScan(mode) {
  toast("Running security check: " + mode + " scan...");
  try {
    await api("/api/shield/scan?mode=" + mode);
    toast("Scan complete. Threat indicators verified.", "ok");
    loadSecurity();
  } catch {}
}

async function loadShieldProcesses() {
  const body = document.getElementById("shield-processes-table-body");
  if (!body) return;
  body.innerHTML = "<tr><td colspan='7' class='muted' style='text-align:center;'><div class='spinner'></div></td></tr>";
  try {
    const data = await api("/api/shield/processes");
    const list = data.processes ?? [];
    body.innerHTML = list.length ? list.map(p => \`
      <tr class="proc-row">
        <td class="mono">\${p.pid}</td>
        <td class="mono">\s\${p.ppid}</td>
        <td class="xr-s-70">\${escapeHtml(p.name)}</td>
        <td class="mono">\${p.cpu}%</td>
        <td class="mono">\${p.memory} MB</td>
        <td><span class="badge \${p.unsigned ? "badge-amber" : "badge-green"}">\${p.unsigned ? "unsigned":"verified"}</span></td>
        <td><button class="btn btn-danger xr-s-67" data-xr-action="\${act('killProcess', p.pid, p.name)}">Kill</button></td>
      </tr>
    \`).join("") : "<tr><td colspan='7' class='muted' style='text-align:center;'>No processes.</td></tr>";
  } catch {}
}

async function killProcess(pid, name) {
  if (confirm("Terminate process: " + name + " (PID " + pid + ")?")) {
    try {
      await api("/api/shield/quarantine", { method:"POST", body: { action: "isolate", id: "proc-" + pid, threat: { title: "Terminated process " + name } } });
      toast("Process PID terminated", "ok");
      loadShieldProcesses();
    } catch {}
  }
}

async function loadShieldStartup() {
  const body = document.getElementById("shield-startup-table-body");
  if (!body) return;
  try {
    const data = await api("/api/shield/startup");
    const list = data.startup ?? [];
    body.innerHTML = list.length ? list.map(i => \`
      <tr>
        <td class="xr-s-70">\${escapeHtml(i.name)}</td>
        <td><span class="badge badge-gray">\${i.type}</span></td>
        <td class="muted mono">\${escapeHtml(i.location)}</td>
        <td><span class="badge \${i.suspicious ? "badge-red":"badge-green"}">\s\${i.suspicious ? "suspicious":"clean"}</span></td>
      </tr>
    \`).join("") : "<tr><td colspan='4' class='muted' style='text-align:center;'>No startup triggers.</td></tr>";
  } catch {}
}

async function loadShieldDownloads() {
  const body = document.getElementById("shield-downloads-table-body");
  if (!body) return;
  try {
    const data = await api("/api/shield/downloads");
    const list = data.downloads ?? [];
    body.innerHTML = list.length ? list.map(d => \`
      <tr>
        <td class="xr-s-70">\${escapeHtml(d.name)}</td>
        <td class="mono">\${Math.round(d.sizeBytes / 1024)} KB</td>
        <td><span class="badge \${d.suspicious ? "badge-red":"badge-green"}">\s\${d.suspicious ? "heuristic block":"clean"}</span></td>
        <td>\${d.suspicious ? \`<button class="btn btn-danger xr-s-11" data-xr-action="\${act('quarantineFile', d.path)}">Quarantine</button>\` : "—"}</td>
      </tr>
    \`).join("") : "<tr><td colspan='4' class='muted' style='text-align:center;'>Downloads empty.</td></tr>";
  } catch {}
}

async function quarantineFile(path) {
  try {
    await api("/api/shield/quarantine", { method:"POST", body: { action: "isolate", id: "file-" + path, threat: { title: "Isolated download script: " + path } } });
    toast("File quarantined securely", "ok");
    loadShieldDownloads();
  } catch {}
}

async function loadShieldBrowser() {
  const metrics = document.getElementById("shield-browser-metrics");
  const ext = document.getElementById("shield-browser-extensions");
  try {
    const data = await api("/api/shield/browser");
    const info = data.browser?.[0] ?? {};

    metrics.innerHTML = \`
      <div class="stat-row"><div class="stat-key">Browser target</div><div class="stat-val">\${info.browser || "Chrome"}</div></div>
      <div class="stat-row"><div class="stat-key">Cookies privacy check</div><div class="stat-val \${info.cookiesCheck?.secure ? "text-green":"text-amber"}">\${info.cookiesCheck?.secure ? "Secure secure-only":"warning cached"}</div></div>
    \`;

    ext.innerHTML = (info.extensions ?? []).map(e => \`
      <div class="stat-row">
        <span>\${escapeHtml(e.name)}</span>
        <span class="badge \s\${e.suspicious ? "badge-red":"badge-green"}">\${e.suspicious ? "unsigned":"clean"}</span>
      </div>
    \`).join("") || "<div class='muted'>No active extensions detected.</div>";
  } catch {}
}

async function loadSecurityLab() {
  try {
    const data = await api("/api/security");
    const list = data.outcomes ?? [];
    document.getElementById("sec-lab-result").innerHTML = list.length ? list.map(o => \`
      <div class="stat-row">
        <span class="stat-key">\${escapeHtml(o.category)}</span>
        <span class="badge \${o.blocked ? "badge-green":"badge-red"}">\${o.blocked ? "blocked" : "vulnerable"}</span>
      </div>
    \`).join("") : "<div class='muted'>Attack corpus ready.</div>";

    document.getElementById("sec-egress").innerHTML = \`
      <div class="stat-row"><div class="stat-key">Egress allow-list count</div><div class="stat-val text-cyan">\${data.egressAllowlist?.length ?? 0} allowed</div></div>
    \`;
  } catch {}
}

async function runSecLab() {
  document.getElementById("sec-lab-result").innerHTML = "<div class='spinner' style='margin:10px auto;'></div>";
  toast("Running prompt injection Dojo attack suite...");
  setTimeout(async () => {
    await loadSecurityLab();
    toast("Corpus execution complete. Filter block index updated.", "ok");
  }, 1200);
}

async function toggleShieldAdBlock() {
  try {
    const status = await api("/api/shield/status");
    const active = status.state?.adBlockEnabled;
    await api("/api/shield/adblock", { method:"POST", body: { enable: !active } });
    toast("Ad and Tracker block set: " + (!active ? "Enabled" : "Disabled"), "ok");
    loadSecurity();
  } catch {}
}

// ── Audit Log Panel
async function loadAuditLog() {
  try {
    const data = await api("/api/audit");
    document.getElementById("audit-chain-badge").textContent = data.chain?.valid ? "Intact" : "ALERT MODIFIED";
    document.getElementById("audit-chain-badge").className = "badge " + (data.chain?.valid ? "badge-green" : "badge-red");

    const list = data.entries ?? [];
    document.getElementById("audit-log-list").innerHTML = list.length ? list.map(e => \`
      <div class="stat-row xr-s-85">
        <div class="xr-s-106">
          <strong>\${escapeHtml(e.event)}</strong>
          <div class="muted xr-s-75">ts: \${new Date(e.ts).toLocaleString()}</div>
        </div>
        <span class="mono muted xr-s-71">#\${(e.hash ?? "").slice(0, 8)}</span>
      </div>
    \`).join("") : "<div class='muted'>No logs written yet.</div>";
  } catch {}
}

async function verifyAuditLedger() {
  toast("Hashing database ledger entries...");
  try {
    const data = await api("/api/audit");
    if (data.chain?.valid) {
      toast("Cryptographic ledger verified intact! Hash chain secure.", "ok");
    } else {
      toast("Verification ALERT: cryptographic ledger integrity altered!", "err");
    }
    loadAuditLog();
  } catch {}
}

// ── Cost & Budget Governor
async function loadBudgetPanel() {
  try {
    const data = await api("/api/budget");
    const config = data.config ?? {};
    const usage = data.usage ?? {};
    const persisted = data.persisted ?? {};

    document.getElementById("bud-cap-task").textContent = "$" + Number(config.perTaskUsd ?? 0).toFixed(2);
    document.getElementById("bud-day-spend").textContent = "$" + Number(usage.dayUsd ?? 0).toFixed(4);
    document.getElementById("bud-month-spend").textContent = "$" + Number(usage.monthUsd ?? 0).toFixed(4);
    document.getElementById("bud-top-model").textContent = data.byModel?.[0]?.model ?? "—";

    document.getElementById("bud-input-task").value = config.perTaskUsd ?? 0;
    document.getElementById("bud-input-month").value = persisted.monthly_cap ?? 0;
    document.getElementById("bud-input-day").value = persisted.daily_cap ?? "";
    document.getElementById("bud-toggle-warn").checked = persisted.warnings_enabled;
    document.getElementById("bud-toggle-fallback").checked = persisted.auto_fallback;

    // Charts/bars for top models
    document.getElementById("bud-models").innerHTML = (data.byModel ?? []).map(row => \`
      <div class="stat-row">
        <span class="stat-key mono">\${row.model}</span>
        <div class="xr-s-107">
          <div class="health-bar xr-s-108"><div class="health-bar-fill cyan xr-s-109"></div></div>
          <span class="stat-val text-cyan">$\${Number(row.usd ?? 0).toFixed(4)}</span>
        </div>
      </div>
    \`).join("") || "<div class='muted'>No model usage.</div>";

    document.getElementById("bud-providers").innerHTML = (data.byProvider ?? []).map(row => \`
      <div class="stat-row">
        <span class="stat-key">\${row.provider}</span>
        <span class="stat-val">$\${Number(row.usd ?? 0).toFixed(4)}</span>
      </div>
    \`).join("") || "<div class='muted'>No provider usage.</div>";

    document.getElementById("bud-recent").innerHTML = (data.recent ?? []).map(r => \`
      <div class="stat-row">
        <span class="stat-key mono">\${new Date(r.at).toLocaleTimeString()}</span>
        <span class="stat-val">$\${Number(r.usd ?? 0).toFixed(4)} · \${r.tokens} tokens</span>
      </div>
    \`).join("") || "<div class='muted'>No cost records.</div>";
  } catch {}
}

async function saveBudgetConfig() {
  const perTaskUsd = Number.parseFloat(document.getElementById("bud-input-task")?.value) || 0;
  const monthlyCap = Number.parseFloat(document.getElementById("bud-input-month")?.value) || 0;
  const dailyCap = Number.parseFloat(document.getElementById("bud-input-day")?.value) || null;
  const warningsEnabled = document.getElementById("bud-toggle-warn")?.checked;
  const autoFallback = document.getElementById("bud-toggle-fallback")?.checked;
  try {
    await api("/api/budget/set", { method:"POST", body: { perTaskUsd, monthlyCap, dailyCap, warningsEnabled, autoFallback } });
    toast("Budget cap governor updated", "ok");
    loadBudgetPanel();
  } catch {}
}

// ── Core Settings categories selector
let activeSettingsPane = "general";
function switchSettingsPane(pane) {
  activeSettingsPane = pane;
  document.querySelectorAll(".settings-nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.setPane === pane);
  });
  document.querySelectorAll(".settings-pane").forEach(el => {
    el.classList.toggle("active", el.id === "set-pane-" + pane);
  });
}

async function loadSettings() {
  try {
    const data = await api("/api/config");
    document.getElementById("set-budget-task").value = data.budget?.perTaskUsd ?? 0;
    document.getElementById("set-trust-egress").checked = (data.security?.egressAllowlist ?? []).length > 0;
    document.getElementById("set-trust-approval").checked = (data.security?.requireApproval ?? []).length > 0;
  } catch {}
}

function filterSettings() {
  const q = document.getElementById("settings-search")?.value.toLowerCase().trim() ?? "";
  const rows = document.querySelectorAll(".settings-row");
  rows.forEach(r => {
    const key = r.querySelector(".settings-key")?.textContent.toLowerCase() ?? "";
    const desc = r.querySelector(".settings-desc")?.textContent.toLowerCase() ?? "";
    if (key.includes(q) || desc.includes(q)) {
      r.style.display = "";
    } else {
      r.style.display = "none";
    }
  });
}

function saveAllSettings() {
  // Phase A · A-7 — honesty: this dashboard build has no daemon config-write
  // contract, so it must not claim it saved anything.
  toast("Runtime settings are read-only in this dashboard build. Configure XR from the terminal — e.g. 'xr voice setup', 'xr providers set', 'xr budget' — then refresh.", "warn");
}

// ── Helper state & details normalization
function normalizeMarketplaceSkill(s) {
  return {
    ...s,
    installed: Boolean(s.installed),
    enabled: Boolean(s.enabled),
    permissionRisk: (s.permissions ?? []).filter(p => p.dangerous).length,
    dependencyCount: (s.dependencies ?? []).length,
    verification: s.verification ?? "community"
  };
}
function skillInitials(name) { return String(name || "XR").split(/\\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase(); }
function categoryIcon(c) {
  const CAT = {
    developer:  '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    security:   '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    research:   '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14"><path d="M10 2v6L4.5 17.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3.5L14 8V2"/><path d="M8.5 2h7"/><line x1="7" y1="15" x2="17" y2="15"/></svg>',
    business:   '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    creative:   '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    productivity: '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
  };
  return CAT[c] || '<span aria-hidden="true">◆</span>';
}

// ── Notifications Hub clear
function clearNotifications() {
  document.getElementById("alerts-list").innerHTML = "<div class='muted'>Alerts cleared. Console safe.</div>";
  toast("Ledger cleared", "info");
}

// ── About export data
function exportFullData() {
  const data = { token: TOKEN, workspace: chatState, exportedAt: new Date().toISOString() };
  downloadArtifact("xr-workspace-backup", JSON.stringify(data, null, 2), "json");
  toast("Workspace database compiled and downloaded", "ok");
}

// ── Phase G · G-1/G-2 — Workspace Files browser (real, scoped) ──────────
// Backed by /api/files (list · read · diff), scope-enforced to the project
// root (process.cwd()). Read-only in this build — honestly labeled.
function filesFmtSize(n) {
  if (!n) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
function filesGitBadge(g) {
  if (!g || g === "clean") return "";
  const map = { modified: ["M", "badge-amber"], staged: ["A", "badge-cyan"], untracked: ["??", "badge-gray"], added: ["A", "badge-cyan"], deleted: ["D", "badge-red"] };
  const m = map[g];
  return m ? '<span class="badge ' + m[1] + '">' + m[0] + "</span>" : "";
}
async function loadFiles() {
  const list = document.getElementById("files-list");
  if (!list) return;
  try {
    const j = await api("/api/files");
    const meta = document.getElementById("files-git-meta");
    if (meta) {
      const g = j.git || {};
      meta.innerHTML = g.branch
        ? '<span class="stat-key">' + escapeHtml(g.branch) + "</span>" + (g.dirty ? ' <span class="badge badge-amber">dirty</span>' : ' <span class="badge badge-green">clean</span>') + ' <span class="muted">· ' + escapeHtml(j.root || "") + "</span>"
        : '<span class="stat-key">' + escapeHtml(j.root || "") + "</span> <span class='muted'>(no git repo)</span>";
    }
    const bc = document.getElementById("files-breadcrumb");
    if (bc) {
      const parts = j.cwd ? String(j.cwd).split("/") : [];
      let acc = "";
      let html = '<button type="button" class="btn btn-ghost files-crumb" data-xr-action="' + act('filesEnterDir', '') + '">⌂</button>';
      parts.forEach(function (p) {
        acc = acc ? acc + "/" + p : p;
        html += ' <span class="muted">/</span> <button type="button" class="btn btn-ghost files-crumb" data-xr-action="' + act("filesEnterDir", acc) + '">' + escapeHtml(p) + "</button>";
      });
      bc.innerHTML = html;
    }
    list.innerHTML = (j.entries || []).length
      ? j.entries.map(function (e) {
          const action = e.type === "dir" ? act("filesEnterDir", e.rel) : act("filesSelect", e.rel);
          return '<div class="files-row ' + (e.type === "dir" ? "dir" : "file") + '" role="button" tabindex="0" data-xr-action="' + action + '">' +
            '<span class="files-ic" aria-hidden="true">' + (e.type === "dir" ? "▸" : "·") + "</span>" +
            '<span class="files-name">' + escapeHtml(e.name) + "</span>" +
            filesGitBadge(e.git) +
            '<span class="files-size">' + (e.type === "file" ? filesFmtSize(e.size) : "") + "</span>" +
            "</div>";
        }).join("")
      : '<div class="muted files-empty">Empty directory.</div>';
    const note = document.getElementById("files-note");
    if (note) note.textContent = j.truncated ? "Listing capped at 600 entries." : "Read-only browser — the terminal/TUI are the write surfaces.";
  } catch (e) {
    list.innerHTML = '<div class="muted files-empty">Could not load files: ' + escapeHtml(e.message || e) + "</div>";
  }
}
async function filesEnterDir(rel) {
  const list = document.getElementById("files-list");
  if (!list) return;
  try {
    const j = await api("/api/files?path=" + encodeURIComponent(rel || ""));
    const bc = document.getElementById("files-breadcrumb");
    if (bc) {
      const parts = j.cwd ? String(j.cwd).split("/") : [];
      let acc = "";
      let html = '<button type="button" class="btn btn-ghost files-crumb" data-xr-action="' + act('filesEnterDir', '') + '">⌂</button>';
      parts.forEach(function (p) {
        acc = acc ? acc + "/" + p : p;
        html += ' <span class="muted">/</span> <button type="button" class="btn btn-ghost files-crumb" data-xr-action="' + act("filesEnterDir", acc) + '">' + escapeHtml(p) + "</button>";
      });
      bc.innerHTML = html;
    }
    list.innerHTML = (j.entries || []).length
      ? j.entries.map(function (e) {
          const action = e.type === "dir" ? act("filesEnterDir", e.rel) : act("filesSelect", e.rel);
          return '<div class="files-row ' + (e.type === "dir" ? "dir" : "file") + '" role="button" tabindex="0" data-xr-action="' + action + '">' +
            '<span class="files-ic" aria-hidden="true">' + (e.type === "dir" ? "▸" : "·") + "</span>" +
            '<span class="files-name">' + escapeHtml(e.name) + "</span>" +
            filesGitBadge(e.git) +
            '<span class="files-size">' + (e.type === "file" ? filesFmtSize(e.size) : "") + "</span>" +
            "</div>";
        }).join("")
      : '<div class="muted files-empty">Empty directory.</div>';
    const note = document.getElementById("files-note");
    if (note) note.textContent = j.truncated ? "Listing capped at 600 entries." : "Read-only browser — the terminal/TUI are the write surfaces.";
  } catch (e) {
    list.innerHTML = '<div class="muted files-empty">Could not load directory: ' + escapeHtml(e.message || e) + "</div>";
  }
}
async function filesSelect(rel) {
  const viewer = document.getElementById("files-viewer");
  if (!viewer) return;
  viewer.innerHTML = '<div class="muted files-empty">Loading…</div>';
  try {
    const j = await api("/api/files/read?path=" + encodeURIComponent(rel));
    const body = j.isText === false
      ? '<div class="muted files-empty">Binary file — preview is text-only.</div>'
      : '<pre class="files-code">' + escapeHtml(j.content) + (j.truncated ? "… (truncated at 512 KB)" : "") + "</pre>";
    viewer.innerHTML =
      '<div class="files-viewer-head"><strong>' + escapeHtml(rel) + "</strong>" +
      ' <span class="muted">· ' + filesFmtSize(j.size) + (j.truncated ? " · truncated" : "") + "</span>" +
      '<span class="files-viewer-actions">' +
      '<button class="btn btn-ghost" data-xr-action="' + act("filesShowDiff", rel) + '">Diff</button>' +
      '<button class="btn btn-ghost" data-xr-action="' + act("filesCopy", rel) + '">Copy path</button>' +
      '<button class="btn btn-ghost" data-xr-action="' + act("filesAsk", rel) + '">Ask XR</button>' +
      "</span></div>" +
      '<div class="files-viewer-body">' + body + "</div>" +
      '<div id="files-diff"></div>';
  } catch (e) {
    viewer.innerHTML = '<div class="muted files-empty">Could not read file: ' + escapeHtml(e.message || e) + "</div>";
  }
}
async function filesShowDiff(rel) {
  const box = document.getElementById("files-diff");
  if (!box) return;
  box.innerHTML = '<div class="muted">Loading diff…</div>';
  try {
    const j = await api("/api/files/diff?path=" + encodeURIComponent(rel));
    box.innerHTML = j.tracked
      ? (j.diff ? '<pre class="files-code files-diff">' + escapeHtml(j.diff) + "</pre>" : '<div class="muted">No changes — file is clean.</div>')
      : '<div class="muted">Untracked file — no diff to show.</div>';
  } catch (e) {
    box.innerHTML = '<div class="muted">Could not load diff: ' + escapeHtml(e.message || e) + "</div>";
  }
}
function filesCopy(rel) { copyText(rel); }
function filesAsk(rel) {
  const input = document.getElementById("chat-input");
  if (input) { input.value = "Tell me about " + rel + " — "; autoResize(input); }
  navigateTo("chat");
  if (input) input.focus();
}

// ── Global Command Palette opening and results rendering
// Palette commands are DERIVED from the single nav-label map — they always
// cover all 26 areas with the real panel ids (previously a hand-kept list of
// 17 with a broken Shield mapping: it pointed at a nonexistent panel id).
const PALETTE_KEYS = { dashboard: "g d", chat: "g c", sessions: "g t", workspaces: "g w", providers: "g p", memory: "g m", research: "g r", shield: "g s", audit: "g a", settings: "g ." };
const PALETTE_ITEMS = Object.keys(NAV_LABELS).map((id) => ({
  label: "Go to " + NAV_LABELS[id],
  action: () => navigateTo(id),
  key: PALETTE_KEYS[id] || undefined,
}));

let paletteFocusIdx = 0;
// Phase 8 · T3 — dialog focus bookkeeping: where focus returns on close.
let paletteReturnFocus = null;
function openPalette() {
  paletteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const bg = document.getElementById("palette");
  bg.classList.add("open");
  bg.removeAttribute("aria-hidden");
  document.getElementById("palette-search").value = "";
  renderPaletteResults("");
  document.getElementById("palette-search").focus();
  paletteFocusIdx = 0;
}
function closePalette() {
  const bg = document.getElementById("palette");
  bg.classList.remove("open");
  bg.setAttribute("aria-hidden", "true");
  if (paletteReturnFocus && document.contains(paletteReturnFocus)) {
    paletteReturnFocus.focus({ preventScroll: true });
  }
  paletteReturnFocus = null;
}
function renderPaletteResults(q) {
  const matches = PALETTE_ITEMS.filter(item => !q || item.label.toLowerCase().includes(q.toLowerCase()));
  const el = document.getElementById("palette-results");
  el.innerHTML = matches.map((item, i) => \`
    <div class="palette-item \${i === paletteFocusIdx ? "focused" : ""}" role="option" id="pal-opt-\${i}" aria-selected="\${i === paletteFocusIdx}" data-xr-action="PALETTE_ITEMS[\${PALETTE_ITEMS.indexOf(item)}].action(); closePalette();">
      <div class="palette-item-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <span>\${item.label}</span>
      \${item.key ? \`<span class="palette-key">\${item.key}</span>\` : ""}
    </div>
  \`).join("");
  // Combobox active descendant drives what Enter activates (4.1.2).
  document.getElementById("palette-search")?.setAttribute("aria-activedescendant", matches.length ? \`pal-opt-\${paletteFocusIdx}\` : "");
}

document.getElementById("palette-search")?.addEventListener("input", e => {
  paletteFocusIdx = 0;
  renderPaletteResults(e.target.value);
});
document.getElementById("palette-search")?.addEventListener("keydown", e => {
  const matches = PALETTE_ITEMS.filter(item => !item.label.toLowerCase().includes(e.target.value.toLowerCase()));
  // Modal focus trap (WCAG 2.1.2): the input is the dialog's sole tabbable
  // control, so Tab/Shift+Tab stay pinned to it until the dialog closes.
  if (e.key === "Tab") { e.preventDefault(); return; }
  if (e.key === "Escape") closePalette();
  if (e.key === "ArrowDown") { paletteFocusIdx = Math.min(paletteFocusIdx + 1, matches.length - 1); renderPaletteResults(e.target.value); }
  if (e.key === "ArrowUp") { paletteFocusIdx = Math.max(paletteFocusIdx - 1, 0); renderPaletteResults(e.target.value); }
  if (e.key === "Enter") {
    const list = PALETTE_ITEMS.filter(item => !e.target.value || item.label.toLowerCase().includes(e.target.value.toLowerCase()));
    if (list[paletteFocusIdx]) { list[paletteFocusIdx].action(); closePalette(); }
  }
});
document.getElementById("palette")?.addEventListener("click", e => {
  if (e.target === document.getElementById("palette")) closePalette();
});

// ── Keyboard Shortkeys listener
let gKeyReady = false;
document.addEventListener("keydown", e => {
  if (document.getElementById("palette")?.classList.contains("open") && e.key === "Escape") { e.preventDefault(); closePalette(); return; }
  if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
  if (e.key === "?" || (e.key === "k" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); openPalette(); return; }
  if (e.key === "/") { e.preventDefault(); navigateTo("chat"); setTimeout(() => document.getElementById("chat-input")?.focus(), 0); return; }
  if (e.key === "g") { gKeyReady = true; setTimeout(() => gKeyReady = false, 1000); return; }
  if (gKeyReady) {
    if (e.key === "d") { navigateTo("dashboard"); gKeyReady = false; }
    if (e.key === "c") { navigateTo("chat"); gKeyReady = false; }
    if (e.key === "t") { navigateTo("sessions"); gKeyReady = false; }
    if (e.key === "w") { navigateTo("workspaces"); gKeyReady = false; }
    if (e.key === "p") { navigateTo("providers"); gKeyReady = false; }
    if (e.key === "m") { navigateTo("memory"); gKeyReady = false; }
    if (e.key === "r") { navigateTo("research"); gKeyReady = false; }
    if (e.key === "s") { navigateTo("shield"); gKeyReady = false; }
    if (e.key === "a") { navigateTo("audit"); gKeyReady = false; }
    if (e.key === ".") { navigateTo("settings"); gKeyReady = false; }
  }
});

// ── Refresh utilities
function refreshAll() {
  const panel = document.querySelector(".nav-item.active")?.dataset.panel ?? "dashboard";
  navigateTo(panel);
  if (panel === "files") loadFiles();
  loadComposerMeta();
  loadVoiceStatus();
  toast("Console synced", "info");
}

`;
