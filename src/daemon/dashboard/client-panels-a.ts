/**
 * XR Control Center served-client fragment — sessions, workspaces, providers, models, memory, research panels.
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const PANELS_A = `// ── Sessions panel
// Phase C · C-4 — sessions: client-side search + copy-id + honest resume
// (opening a session shows its real steps in the inspector; there is no
// daemon "continue session" API for these CLI/daemon runs, so nothing fake
// is offered).
let sessCache = [];
let sessSearchWired = false;
function renderSessionList() {
  const box = document.getElementById("sess-list");
  if (!box) return;
  const q = (document.getElementById("sess-search") ? document.getElementById("sess-search").value : "").trim().toLowerCase();
  const rows = sessCache.filter(s => !q
    || (s.title || "").toLowerCase().indexOf(q) !== -1
    || (s.id || "").toLowerCase().indexOf(q) !== -1
    || (s.status || "").toLowerCase().indexOf(q) !== -1);
  box.innerHTML = rows.length ? rows.map(s => {
    const bClass = s.status === "done" ? "badge-green" : s.status === "running" ? "badge-cyan" : "badge-amber";
    // Phase G a11y fix — the Copy button must be a SIBLING of the row, never
    // nested inside the role=button container (axe nested-interactive).
    return \`<div class="sess-row">
      <div class="stat-row xr-s-69 sess-open" role="button" tabindex="0" data-xr-action="\${act('loadSessionDetail', s.id)}" title="Open session steps">
        <div><div class="xr-s-70">\${escapeHtml(s.title)}</div><div class="muted xr-s-71">\${s.id}</div></div>
        <span class="badge \${bClass}">\${s.status}</span>
      </div>
      <button type="button" class="btn btn-ghost sess-copy" data-xr-action="\${act('copyText', s.id)}" title="Copy session id">Copy id</button>
    </div>\`;
  }).join("") : (q ? '<div class="muted">No sessions match "' + escapeHtml(q) + '".</div>' : "<div class='muted'>No sessions stored.</div>");
}
async function loadSessionsPanel() {
  try {
    const data = await api("/api/sessions");
    sessCache = data.sessions ?? [];
    const counts = data.counts ?? {};

    document.getElementById("sess-count-total").textContent = counts.sessions ?? sessCache.length;
    document.getElementById("sess-count-running").textContent = counts.running ?? 0;
    document.getElementById("sess-count-done").textContent = counts.done ?? 0;
    document.getElementById("sess-count-research").textContent = counts.research ?? 0;

    renderSessionList();
    if (!sessSearchWired) {
      sessSearchWired = true;
      const inp = document.getElementById("sess-search");
      if (inp) inp.addEventListener("input", renderSessionList);
    }
  } catch(e) {
    document.getElementById("sess-list").innerHTML = "<div class='muted'>API check failed.</div>";
  }
}

async function loadSessionDetail(id) {
  try {
    const data = await api("/api/sessions/" + encodeURIComponent(id));
    const s = data.session;
    const steps = data.steps ?? [];
    document.getElementById("sess-detail").innerHTML = \`
      <div class="xr-s-72"><strong>\${escapeHtml(s.title)}</strong><br><span class="muted">\${s.id} · \${s.status}</span></div>
      <div class="xr-s-73">
        \${steps.map(st => \`<div class="xr-s-74">
          <div class="mono xr-s-70">\${st.phase} \${st.tool ? '· ' + st.tool : ''}</div>
          <div class="muted xr-s-75">\${escapeHtml(st.detail).slice(0, 160)}</div>
        </div>\`).join("")}
      </div>
    \`;
  } catch{}
}

// ── Workspaces panel
async function loadWorkspaces() {
  try {
    const data = await api("/api/workspaces");
    document.getElementById("ws-active").textContent = data.active;
    const list = data.workspaces ?? [];
    const activeWs = list.find(w => w.id === data.active);
    document.getElementById("ws-active-path").textContent = activeWs?.rootDir ?? "/home/user";

    document.getElementById("ws-list").innerHTML = list.length ? list.map(w => \`
      <div class="stat-row xr-s-76">
        <div><strong>\${escapeHtml(w.id)}</strong><br><span class="muted mono">\${escapeHtml(w.rootDir)}</span></div>
        \${w.id === data.active ? '<span class="badge badge-green">active</span>' : \`<button class="btn btn-ghost xr-s-60" data-xr-action="\${act('switchWorkspaceUI', w.id)}">Switch</button>\`}
      </div>
    \`).join("") : "<div class='muted'>No workspaces configured.</div>";
  } catch {}
}

async function createWorkspace() {
  const id = document.getElementById("ws-create-id")?.value.trim();
  const name = document.getElementById("ws-create-name")?.value.trim();
  if (!id) return toast("Workspace id required", "warn");
  try {
    await api("/api/workspaces/create", { method: "POST", body: { id, name } });
    toast("Workspace created", "ok");
    document.getElementById("ws-create-id").value = "";
    document.getElementById("ws-create-name").value = "";
    loadWorkspaces();
  } catch (e) { toast(e.message, "err"); }
}

async function switchWorkspaceUI(id) {
  try {
    await api("/api/workspaces/switch", { method: "POST", body: { id } });
    toast("Workspace switched: " + id, "ok");
    loadWorkspaces();
    loadDashboard();
  } catch (e) { toast(e.message, "err"); }
}

// ── Providers (BYOK) Panel
async function loadProviders() {
  try {
    const [ov, data] = await Promise.all([api("/api/overview"), api("/api/providers")]);
    document.getElementById("prov-routing").innerHTML = \`
      <div class="stat-row"><div class="stat-key">Primary default route</div><div class="stat-val val-cyan">\${data.primary} · \${data.model}</div></div>
      <div class="stat-row"><div class="stat-key">Fallback route</div><div class="stat-val val-muted">\${data.fallback ? data.fallback + " · " + data.fallbackModel : "No fallback set"}</div></div>
    \`;

    const grid = document.getElementById("prov-grid");
    const list = data.providers ?? [];
    grid.innerHTML = list.map(p => \`
      <div class="card \${p.id === data.primary ? "card-glow-cyan" : ""} xr-s-77">
        <div class="xr-s-78">\${p.label}</div>
        <div class="xr-s-79">\${p.id}</div>
        <div class="xr-s-80"><span class="badge \${p.healthy ? "badge-green" : (p.hasKey ? "badge-amber" : "badge-gray")}">\s
          \${p.healthy ? "online" : (p.hasKey ? "inactive" : "no key")}
        </span></div>
      </div>
    \`).join("");

    const selects = ["prov-set-provider", "prov-set-fallback"];
    selects.forEach(selId => {
      const el = document.getElementById(selId);
      if (el) {
        el.innerHTML = list.map(p => \`<option value="\${p.id}">\${p.label} (\${p.id})</option>\`).join("");
      }
    });
    document.getElementById("prov-set-provider").value = data.primary ?? "";
    document.getElementById("prov-set-fallback").value = data.fallback ?? "";
    document.getElementById("prov-set-model").value = data.model ?? "";
    document.getElementById("prov-set-fallback-model").value = data.fallbackModel ?? "";
  } catch {}
}

async function saveProviderRouting() {
  const provider = document.getElementById("prov-set-provider")?.value;
  const model = document.getElementById("prov-set-model")?.value.trim();
  const fallbackProvider = document.getElementById("prov-set-fallback")?.value;
  const fallbackModel = document.getElementById("prov-set-fallback-model")?.value.trim();
  try {
    await api("/api/providers/set", { method: "POST", body: { provider, model, fallbackProvider: fallbackProvider || null, fallbackModel: fallbackModel || null } });
    toast("Primary model updated — active route saved", "ok");
    loadProviders();
    loadDashboard();
  } catch (e) { toast(e.message, "err"); }
}

// ── Models (Local AI)
function focusChangeModel() {
  navigateTo("models");
  const card = document.getElementById("models-change-card");
  const input = document.getElementById("models-select-model");
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.style.boxShadow = "var(--glow-c)";
    card.style.borderColor = "var(--cyan)";
    setTimeout(() => {
      card.style.boxShadow = "";
      card.style.borderColor = "";
    }, 1800);
  }
  if (input) {
    setTimeout(() => { input.focus(); input.select?.(); }, 120);
  }
}

function pickInstalledModel(runtime, model) {
  const rt = document.getElementById("models-select-runtime");
  const md = document.getElementById("models-select-model");
  if (rt && runtime) rt.value = runtime;
  if (md && model) md.value = model;
  focusChangeModel();
  toast("Selected " + (model || "") + " — click Save & apply model", "ok");
}

async function loadModels() {
  try {
    const [data, providers] = await Promise.all([
      api("/api/models"),
      api("/api/providers").catch(() => ({})),
    ]);
    const selected = data.selected ?? {};
    const specs = data.hardware?.specs ?? {};
    const rec = data.recommendation ?? {};
    const primaryId = providers.primary ?? selected.provider ?? selected.runtime ?? "ollama";
    const primaryModel = providers.model ?? selected.model ?? "—";

    const activeDisplay = document.getElementById("models-active-display");
    if (activeDisplay) activeDisplay.textContent = primaryId + " / " + primaryModel;
    const activeSub = document.getElementById("models-active-sub");
    if (activeSub) {
      activeSub.textContent = "Primary route · local runtime " + (selected.runtime ?? "ollama")
        + " · routing " + (selected.routing ?? "hybrid")
        + " — change below or via CLI / Shell Alt+P";
    }

    document.getElementById("models-selected-runtime").textContent = selected.runtime ?? "—";
    document.getElementById("models-selected-model").textContent = selected.model ?? "—";
    document.getElementById("models-recommended").textContent = rec.runtimeModel ?? "—";
    document.getElementById("models-healthy-count").textContent = (data.runtimes ?? []).filter(r => r.healthy).length;

    // Hardware Specs
    document.getElementById("models-hardware").innerHTML = \`
      <div class="stat-row"><div class="stat-key">CPU core units</div><div class="stat-val">\${specs.cores ?? "—"}</div></div>
      <div class="stat-row"><div class="stat-key">Total RAM memory</div><div class="stat-val">\${specs.ramGb ? specs.ramGb.toFixed(1) + " GB" : "—"}</div></div>
      <div class="stat-row"><div class="stat-key">VRAM GPU indicators</div><div class="stat-val">\${specs.vramGb ? specs.vramGb.toFixed(1) + " GB" : "0.0 GB"}</div></div>
      <div class="stat-row xr-s-81"><div class="stat-key">Confidence rec</div><div class="stat-val text-cyan">\${rec.confidence ?? "unsupported"}</div></div>
    \`;

    // Local runtimes
    document.getElementById("models-local").innerHTML = (data.runtimes ?? []).map(r => \`
      <div class="stat-row">
        <div><strong>\${r.label}</strong><br><span class="muted">\${r.baseUrl}</span></div>
        <span class="badge \${r.healthy ? "badge-green" : "badge-gray"}">\${r.healthy ? "healthy" : "offline"}</span>
      </div>
    \`).join("") || '<div class="muted">No runtimes detected. Install Ollama or enable a local API server.</div>';

    // Model list — clickable to select
    const installed = data.installed ?? [];
    document.getElementById("models-list").innerHTML = installed.length
      ? installed.map(m => \`
      <div class="stat-row xr-s-82" role="button" tabindex="0" data-xr-action="\${act('pickInstalledModel', String(m.runtime || ''), String(m.model || ''))}" title="Use this model">
        <span class="stat-key mono">\${m.model}</span>
        <span class="badge badge-gray">\${m.runtime}</span>
      </div>
    \`).join("")
      : '<div class="muted">No downloaded models recorded. Use <span class="mono">xr models install</span> or pull via Ollama, then Refresh.</div>';

    // Select defaults
    const select = document.getElementById("models-select-runtime");
    if (select) {
      select.innerHTML = (data.runtimes ?? []).map(r => \`<option value="\${r.id}">\${r.label}</option>\`).join("");
      select.value = selected.runtime ?? "ollama";
    }
    document.getElementById("models-select-model").value = selected.model ?? "";
    document.getElementById("models-select-routing").value = selected.routing ?? "hybrid";
  } catch (e) {
    toast("Failed to load models: " + (e.message || e), "err");
  }
}

async function saveModelSelection() {
  const runtime = document.getElementById("models-select-runtime")?.value;
  const model = document.getElementById("models-select-model")?.value.trim();
  const routing = document.getElementById("models-select-routing")?.value;
  if (!model) {
    toast("Enter a model tag ID (e.g. qwen2.5:7b)", "err");
    focusChangeModel();
    return;
  }
  try {
    await api("/api/models/select", { method: "POST", body: { runtime, model, routing } });
    toast("Model applied: " + runtime + " / " + model, "ok");
    loadModels();
    loadDashboard();
    loadProviderChip();
  } catch (e) { toast(e.message, "err"); }
}

async function testModelSelection() {
  const runtime = document.getElementById("models-select-runtime")?.value;
  const model = document.getElementById("models-select-model")?.value.trim();
  if (!model) {
    toast("Select or enter a model first", "err");
    focusChangeModel();
    return;
  }
  toast("Smoke testing latency...");
  try {
    const data = await api("/api/models/test", { method: "POST", body: { runtime, model } });
    if (data.result?.ok) {
      toast("Smoke test passed: " + data.result.latencyMs + "ms", "ok");
    } else {
      toast("Test failed: " + (data.result?.detail || "Offline"), "err");
    }
  } catch (e) { toast(e.message, "err"); }
}

// ── Durable memory
// XR 4.5 — consent/trust labels. Symbols carry the meaning, never colour
// alone, so the panel stays readable for screen readers and monochrome.
function consentBadge(state) {
  const map = {
    approved:       ["[ok]",       "badge-green",  "You approved retaining this"],
    limited:        ["[ok]",       "badge-green",  "Approved within a narrower scope"],
    proposed:       ["[?]",        "badge-yellow", "Awaiting your decision — not used for recall"],
    quarantined:    ["[!]",        "badge-red",    "Held for review after a safety signature matched"],
    revoked:        ["[revoked]",  "badge-red",    "You withdrew consent"],
    deleted:        ["[deleted]",  "badge-red",    "Deleted"],
    legacy_unknown: ["[legacy]",   "badge-yellow", "Created before XR 4.5 — consent history unknown, not assumed"],
  };
  const [glyph, cls, title] = map[state] || ["[?]", "badge-yellow", "Unknown consent state"];
  return \`<span class="badge \${cls}" title="\${escapeHtml(title)}">\${glyph} \${escapeHtml(state || "unknown")}</span>\`;
}

function trustBadge(trust) {
  const map = {
    trusted_instruction: "trusted instruction",
    approved_memory:     "user-approved",
    source_evidence:     "source-linked",
    generated_synthesis: "model-generated",
    untrusted_external:  "untrusted",
    unknown:             "trust unknown",
  };
  if (!trust) return "";
  return \`<span class="badge" title="Trust status — only trusted instructions may direct behavior">\${escapeHtml(map[trust] || trust)}</span>\`;
}

async function loadMemory() {
  try {
    const mem = await api("/api/memory");
    document.getElementById("mem-h-total").textContent = mem.health?.total ?? mem.count;
    document.getElementById("mem-h-expired").textContent = mem.health?.expired ?? 0;
    document.getElementById("mem-h-never").textContent = mem.health?.neverAccessed ?? 0;

    // XR 4.5 consent summary + pending review queue.
    let consent = {};
    try {
      const ctx = await api("/api/context");
      consent = ctx.memory?.consent ?? {};
      document.getElementById("mem-c-approved").textContent =
        (consent.approved ?? 0) + (consent.limited ?? 0);
      document.getElementById("mem-c-proposed").textContent = consent.proposed ?? 0;
      document.getElementById("mem-c-legacy").textContent = consent.legacy_unknown ?? 0;
    } catch {}

    try {
      const pending = await api("/api/context/pending");
      const items = [...(pending.proposed ?? []), ...(pending.quarantined ?? [])];
      const card = document.getElementById("mem-pending-card");
      if (items.length) {
        card.style.display = "";
        document.getElementById("mem-pending-list").innerHTML = items.map(e => \`
          <div class="stat-row xr-s-83">
            <div>
              \${consentBadge(e.consentState)} \${trustBadge(e.trustStatus)}
              <p class="xr-s-84">\${escapeHtml(e.content)}</p>
              <div class="muted xr-s-27">from \${escapeHtml(e.provenanceKind || "unknown")}\${e.actorName ? " · " + escapeHtml(e.actorName) : ""}</div>
            </div>
            <div class="xr-s-66">
              <button class="btn btn-primary xr-s-60" data-xr-action="\${act('approveMemory', e.id)}">Approve</button>
              <button class="btn btn-danger xr-s-60" data-xr-action="\${act('revokeMemory', e.id)}">Reject</button>
            </div>
          </div>
        \`).join("");
      } else {
        card.style.display = "none";
      }
    } catch {}

    const list = mem.entries ?? [];
    document.getElementById("mem-list").innerHTML = list.length ? list.map(e => \`
      <div class="stat-row xr-s-85">
        <div>
          <span class="badge badge-cyan xr-s-86">\${escapeHtml(e.category)}</span>
          <p class="xr-s-84">\${escapeHtml(e.content)}</p>
        </div>
        <div class="xr-s-66">
          <button class="btn xr-s-60" data-xr-action="\${act('revokeMemory', e.id)}" title="Stop XR using this, but keep the record">Revoke</button>
          <button class="btn btn-danger xr-s-11" data-xr-action="\${act('deleteMemory', e.id)}" title="Delete permanently">✕</button>
        </div>
      </div>
    \`).join("") : "<div class='muted'>Durable vector memory is empty.</div>";
  } catch {}
}

async function approveMemory(id) {
  try {
    await apiPost("/api/context/approve/" + encodeURIComponent(id), {});
    loadMemory();
  } catch {}
}

// Revoke is distinct from delete: it stops future use but keeps the record so
// the action stays auditable and reversible-by-inspection.
async function revokeMemory(id) {
  if (!confirm("Revoke consent for this entry?\\n\\nXR will stop using it and its cached embedding will be destroyed. The record stays visible so you can still inspect or export it.")) return;
  try {
    const res = await apiPost("/api/context/revoke/" + encodeURIComponent(id), {});
    if (res?.residual?.length) {
      alert("Revoked.\\n\\nWhat this does and does not remove:\\n\\n· " + res.residual.join("\\n· "));
    }
    loadMemory();
  } catch {}
}

async function doMemSearch() {
  const q = document.getElementById("mem-search")?.value.trim();
  if (!q) return;
  try {
    const data = await api("/api/memory/search?q=" + encodeURIComponent(q));
    const list = data.results ?? [];
    document.getElementById("mem-search-results").innerHTML = list.length ? list.map(e => \`
      <div class="stat-row xr-s-87">
        <span class="badge badge-cyan xr-s-88">\${e.category}</span>
        <span class="xr-s-84">\${escapeHtml(e.content)}</span>
      </div>
    \`).join("") : "<div class='muted'>No entries found.</div>";
  } catch {}
}

async function deleteMemory(id) {
  try {
    await api("/api/memory/" + encodeURIComponent(id), { method: "DELETE" });
    toast("Memory node forgotten", "ok");
    loadMemory();
  } catch {}
}

async function clearMemory() {
  if (confirm("Permanently delete ALL vector memories?")) {
    try {
      await api("/api/memory/*", { method: "DELETE" });
      toast("Memory ledger purged", "ok");
      loadMemory();
    } catch {}
  }
}

// ── Research Runs
async function loadResearchPanel() {
  try {
    const data = await api("/api/research");
    const recent = data.recent ?? [];
    const latest = data.latest ?? {};

    document.getElementById("research-count").textContent = data.count;
    document.getElementById("research-latest-status").textContent = latest.status ?? "None";
    document.getElementById("research-latest-sources").textContent = latest.sources?.length ?? 0;
    document.getElementById("research-latest-contradictions").textContent = latest.contradictions?.length ?? 0;

    document.getElementById("research-latest").innerHTML = latest.topic ? \`
      <strong>\${escapeHtml(latest.topic)}</strong>
      <p class="muted xr-s-89">\${escapeHtml(latest.synthesis?.shortAnswer || latest.summary || "Draft synthesized OK")}</p>
    \` : "<div class='muted'>No active research runs.</div>";

    document.getElementById("research-list").innerHTML = recent.length ? recent.map(r => \`
      <div class="stat-row xr-s-90" role="button" tabindex="0" data-xr-action="\${act('loadResearchDetail', r.id)}">
        <div><strong>\${escapeHtml(r.topic)}</strong><br><span class="muted">\${r.id}</span></div>
        <span class="badge \${r.status === "done" ? "badge-green" : "badge-gray"}">\${r.status}</span>
      </div>
    \`).join("") : "<div class='muted'>No previous research logs.</div>";
  } catch {}
}

async function loadResearchDetail(id) {
  try {
    const data = await api("/api/research/" + encodeURIComponent(id));
    const s = data.session;
    document.getElementById("research-latest").innerHTML = \`
      <div class="xr-s-91"><strong>\${escapeHtml(s.topic)}</strong><br><span class="muted">\${s.id} · \${s.status}</span></div>
      <p class="xr-s-92">\${escapeHtml(s.synthesis?.shortAnswer || s.summary || "Report verified intact.")}</p>
      <div class="stat-row"><div class="stat-key">Citations found</div><div class="stat-val">\${s.sources?.length ?? 0}</div></div>
      <div class="stat-row"><div class="stat-key">Cross-verifications</div><div class="stat-val">\${s.claims?.length ?? 0}</div></div>
    \`;
  } catch {}
}

`;
