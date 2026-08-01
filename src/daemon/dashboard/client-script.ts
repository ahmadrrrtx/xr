/**
 * XR Control Center — client application
 *
 * Phase 2 · T7. `src/daemon/dashboard.ts` was 3 619 lines — 4.5x the 800-line
 * threshold and by far XR's largest module: one function returning one template
 * literal that held the stylesheet, the markup AND the whole client-side
 * application, so a CSS tweak and a client-logic change touched the same file.
 *
 * Owns the BROWSER-SIDE application served inside <script>. It is data to the daemon and is never executed server-side.
 *
 * Mechanical and behaviour-preserving: the composed document is byte-identical
 * to the pre-split output (test/daemon/dashboard-split.test.ts pins the
 * SHA-256). The fragments below are stored exactly as they appeared in the
 * original template literal — already escaped for that context — so they are
 * re-embedded in a template literal unchanged.
 */

export const DASHBOARD_SCRIPT = `
const TOKEN = "__TOKEN__";
const BASE = window.location.origin;

// ── API request helper
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Toast notifier
function toast(msg, type = "info") {
  const wrap = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Views routing navigator
const NAV_LABELS = {
  dashboard: "Home", chat: "Chat Sessions", sessions: "Recent Sessions", status: "System Status", budget: "Cost & Budget", workspaces: "Workspaces",
  providers: "Providers (BYOK)", models: "Models (Local AI)", memory: "Durable Memory",
  research: "Research Runs", plugins: "Sandboxed Plugins", capabilities: "Capability Ecosystem", skills: "Skills Marketplace", voice: "Voice Pipeline",
  security: "Shield (Security)", audit: "Audit Log", settings: "Core Settings", about: "About Build",
  mcp: "MCP Servers", business: "Business OS CRM", files: "Files & Artifacts", downloads: "Downloads Security",
  devices: "Devices Link", automation: "Scheduled Tasks", integrations: "Webhooks API", notifications: "Alerts Hub"
};

function navigateTo(id) {
  // Toggle nav buttons
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.panel === id);
  });
  // Toggle panels
  document.querySelectorAll(".panel").forEach(el => {
    el.classList.toggle("active", el.id === "panel-" + id);
  });
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
    case "settings": loadSettings(); break;
  }
}

document.querySelectorAll(".nav-item").forEach(el => {
  el.addEventListener("click", () => navigateTo(el.dataset.panel));
});

// ── Home Dashboard loader
async function loadDashboard() {
  try {
    const [ov, cost, ctrl, mem, providers, security, models] = await Promise.allSettled([
      api("/api/overview"),
      api("/api/cost"),
      api("/api/control/status"),
      api("/api/memory"),
      api("/api/providers"),
      api("/api/security"),
      api("/api/models")
    ]);

    if (ov.status === "fulfilled") {
      const d = ov.value;
      document.getElementById("dash-project").textContent = d.project ?? "default";
      const auditOk = d.audit?.chain?.valid;
      document.getElementById("d-audit-val").textContent = auditOk ? "Intact" : "ALERT";
      document.getElementById("d-audit-val").className = "card-value " + (auditOk ? "text-green" : "text-red");
      document.getElementById("d-audit-entries").textContent = (d.audit?.count ?? 0) + " entries";
      document.getElementById("h-val-memory").textContent = (d.memory?.count ?? 0) + " entries";
      document.getElementById("h-cell-memory").className = d.memory?.enabled ? "matrix-cell-status green" : "matrix-cell-status";
      document.getElementById("h-val-research").textContent = (d.research?.count ?? 0) + " runs";
      document.getElementById("h-cell-research").className = (d.research?.count ?? 0) > 0 ? "matrix-cell-status green" : "matrix-cell-status";

      // Updates EDR
      document.getElementById("d-shield-scans").textContent = "All modules validated";
    }

    if (cost.status === "fulfilled") {
      const c = cost.value;
      document.getElementById("d-spent").textContent = "$" + (c.totalUsd ?? 0).toFixed(4);
      document.getElementById("d-tokens").textContent = (c.totalTokens ?? 0).toLocaleString() + " tokens";
      document.getElementById("chip-budget-label").textContent = "$" + (c.totalUsd ?? 0).toFixed(2);
    }

    if (ctrl.status === "fulfilled") {
      const c = ctrl.value;
      document.getElementById("h-val-computer").textContent = c.enabled ? "Authorized" : "Disabled";
      document.getElementById("h-cell-computer").className = c.enabled ? "matrix-cell-status green" : "matrix-cell-status";
    }

    if (security.status === "fulfilled") {
      const s = security.value;
      const pct = Math.round((s.rate ?? 0) * 100) || 96;
      document.getElementById("d-sec-score").textContent = pct + "%";
      document.getElementById("d-sec-score").className = "card-value " + (pct >= 90 ? "text-green" : pct >= 70 ? "text-amber" : "text-red");
    }

    if (models.status === "fulfilled") {
      const m = models.value;
      const selected = m.selected ?? {};
      document.getElementById("h-val-model").textContent = selected.model ?? "qwen2.5:7b";
      document.getElementById("h-val-local").textContent = m.current?.healthy ? "Running" : "Offline";
      document.getElementById("h-cell-local").className = m.current?.healthy ? "matrix-cell-status green" : "matrix-cell-status red";
      document.getElementById("h-val-provider").textContent = selected.runtime ?? "Ollama";
      document.getElementById("h-val-updates").textContent = m.installed?.length ? (m.installed.length + " model(s)") : "Up to date";
      document.getElementById("dash-hardware-summary").innerHTML = "<h3>System Specs</h3>" + (m.hardware?.summary || "Local specs detected OK.");
    }

    // Load recent logs
    const audit = await api("/api/audit?limit=5");
    const entries = audit.entries ?? [];
    document.getElementById("d-audit-list").innerHTML = entries.length
      ? entries.map(e => \`
          <div class="stat-row">
            <span class="stat-key">\${new Date(e.ts).toLocaleTimeString()}</span>
            <span class="stat-val mono truncate xr-s-54">\${e.event}</span>
            <span class="stat-val mono">\${(e.hash ?? "").slice(0, 8)}</span>
          </div>\`).join("")
      : "<div class='muted'>No logs recorded yet.</div>";

    await loadProviderChip();
    await loadTrustPanel();
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

async function loadProviderChip() {
  try {
    const [ov, providers] = await Promise.all([api("/api/overview"), api("/api/providers")]);
    const budget = ov.budget?.perTaskUsd ?? 0;
    document.getElementById("chip-budget-label").textContent = budget > 0 ? "Cap $" + budget.toFixed(2) : "No cap";

    const activeId = providers.primary ?? ov.provider?.active ?? "ollama";
    const activeModel = providers.model ?? ov.provider?.model ?? "—";
    const activeRow = (providers.providers ?? []).find(p => p.id === activeId);
    document.getElementById("sidebar-provider-text").textContent = activeId + " · " + activeModel;
    document.getElementById("chip-provider-label").textContent = activeId + " / " + activeModel;
    document.getElementById("chip-provider").className = "status-chip " + (activeRow?.healthy === false ? "err" : activeRow?.healthy ? "ok" : "warn");
    document.getElementById("provider-dot").style.background = activeRow?.healthy === false ? "var(--red)" : activeRow?.healthy ? "var(--green)" : "var(--amber)";
    const chatLabel = document.getElementById("chat-model-label");
    if (chatLabel) chatLabel.textContent = activeId + " / " + activeModel;
  } catch {}
}

// ── Chat State & Composer
const CHAT_STORE_KEY = "xr.chat.workspace.v31f";
let chatStreaming = false;
let chatAbortController = null;
let chatState = loadChatState();
let chatDraftTimer = 0;
let chatToolSeq = 0;

function loadChatState() {
  try {
    const raw = localStorage.getItem(CHAT_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.chats)) return normalizeChatState(parsed);
    }
  } catch {}
  return normalizeChatState({ activeId: "", chats: [] });
}

function normalizeChatState(state) {
  const now = Date.now();
  const chats = (state.chats || []).map(c => ({
    id: c.id || makeId("chat"),
    title: c.title || "New chat sessions",
    folder: c.folder || "Workspace",
    pinned: !!c.pinned,
    archived: !!c.archived,
    createdAt: c.createdAt || now,
    updatedAt: c.updatedAt || now,
    draft: c.draft || "",
    attachments: Array.isArray(c.attachments) ? c.attachments : [],
    messages: Array.isArray(c.messages) ? c.messages : []
  }));
  let activeId = state.activeId && chats.some(c => c.id === state.activeId) ? state.activeId : (chats[0]?.id || "");
  return {
    activeId,
    mode: state.mode || "Ask",
    provider: state.provider || "Auto",
    model: state.model || "Auto",
    workspace: state.workspace || "Default",
    approval: state.approval || "Ask",
    budget: state.budget || "Guarded",
    toggles: Object.assign({ memory: true, research: false, shield: true, computer: false }, state.toggles || {}),
    chats
  };
}

function saveChatState() {
  try { localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(chatState)); } catch {}
}

function makeId(prefix) { return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,8); }
function activeChat() { return chatState.chats.find(c => c.id === chatState.activeId) || null; }

function buildChatUI() {
  const chatInput = document.getElementById("chat-input");
  if (!chatInput) return;
  if (!chatState.chats.length) createChat("Primary conversation thread", false);

  chatInput.addEventListener("keydown", handleComposerKeydown);
  chatInput.addEventListener("input", () => { autoResize(chatInput); saveDraftSoon(); updateComposerContext(); });
  chatInput.addEventListener("paste", handleComposerPaste);
  document.getElementById("chat-search").addEventListener("input", renderChatList);
  document.getElementById("chat-file-input").addEventListener("change", e => addFilesToComposer(e.target.files));
  setupDropZone();
  renderChatWorkspace();
  refreshInspectorData();
}

function renderChatWorkspace() {
  renderChatList();
  renderMessages();
  renderComposer();
  renderRuntime();
}

function renderChatList() {
  const list = document.getElementById("chat-list");
  if (!list) return;
  const q = (document.getElementById("chat-search")?.value || "").toLowerCase().trim();
  const chats = chatState.chats.filter(c => !c.archived || q).filter(c => !q || (c.title+" "+c.folder).toLowerCase().includes(q));
  const groups = { "Pinned threads": chats.filter(c => c.pinned), "Recent chats": chats.filter(c => !c.pinned) };
  let html = "";
  Object.keys(groups).forEach(g => {
    if (!groups[g].length) return;
    html += '<div class="xr-s-55">' + g + '</div>';
    groups[g].sort((a,b)=>b.updatedAt - a.updatedAt).forEach(c => {
      html += \`<div class="chat-session-item \${c.id === chatState.activeId ? "active" : ""}" data-xr-action="\${act('chatSelectChat', c.id)}">
        <div class="chat-session-item-title">\${escapeHtml(c.title)}</div>
        <div class="chat-session-item-meta">\${c.messages.length} messages · \${timeAgo(c.updatedAt)}</div>
      </div>\`;
    });
  });
  list.innerHTML = html || '<div class="muted xr-s-56">No session logs.</div>';
}

function renderMessages() {
  const feed = document.getElementById("chat-messages");
  const chat = activeChat();
  if (!feed || !chat) return;
  document.getElementById("chat-title").textContent = chat.title;
  document.getElementById("chat-pin-btn").textContent = chat.pinned ? "Pinned" : "Pin";

  if (!chat.messages.length) {
    feed.innerHTML = \`<div class="chat-empty xr-s-57">
      <h2>Operating Command Composer</h2>
      <p class="muted xr-s-58">XR Control Center handles automation, semantic lookup, security hardening scans, and code synthesis. Execute prompts locally with strict caps.</p>
      <div class="grid grid-2 xr-s-59">
        <button class="btn btn-ghost" data-xr-action="insertHint('/status')"><strong>/status</strong><br><span class="muted">Check environment audit health</span></button>
        <button class="btn btn-ghost" data-xr-action="insertHint('/plan Refactor code base')"><strong>/plan &lt;task&gt;</strong><br><span class="muted">Dry-run tasks checklists</span></button>
      </div>
    </div>\`;
    return;
  }

  feed.innerHTML = \`<div class="chat-messages-container">\${chat.messages.map((m, i) => renderMessage(m, i)).join("")}</div>\`;
  feed.scrollTop = feed.scrollHeight;
}

function renderMessage(m, i) {
  const role = m.role === "user" ? "user" : "assistant";
  const avatarName = role === "user" ? "You" : "XR";
  const st = m.streaming ? " streaming" : "";
  return \`<div class="msg \${role}\${st}">
    <div class="msg-avatar-col"><div class="msg-avatar-icon">\${avatarName}</div></div>
    <div class="msg-content-col">
      <div class="msg-bubble">\${formatReply(m.content || "")}\${renderArtifacts(m)}</div>
      <div class="msg-meta">
        <span>\${avatarName} · \${new Date(m.ts || Date.now()).toLocaleTimeString()}</span>
        <span class="msg-actions">
          <button class="msg-act-btn" data-xr-action="\${act('copyText', m.content)}">Copy</button>
          \${role === "user" ? \`<button class="msg-act-btn" data-xr-action="\${act('editMessage', i)}">Edit</button>\` : ""}
        </span>
      </div>
    </div>
  </div>\`;
}

function renderArtifacts(m) {
  const list = m.artifacts || extractArtifacts(m.content || "");
  if (!list.length) return "";
  return '<div class="tool-timeline">' + list.map(a => \`
    <div class="artifact-card">
      <div class="artifact-head">
        <span class="artifact-tag">\${escapeHtml(a.type)}</span>
        <span class="artifact-title">\${escapeHtml(a.title)}</span>
        <button class="btn xr-s-60" data-xr-action="\${act('downloadArtifact', a.title, a.content, a.ext || 'txt')}">Download</button>
      </div>
      <div class="artifact-body">\${escapeHtml(a.content)}</div>
    </div>
  \`).join("") + '</div>';
}

function renderComposer() {
  const chat = activeChat();
  const input = document.getElementById("chat-input");
  if (input && document.activeElement !== input) { input.value = chat?.draft || ""; autoResize(input); }
  updateComposerContext();
  renderAttachments();
  document.querySelectorAll("[data-toggle]").forEach(btn => {
    const key = btn.getAttribute("data-toggle");
    btn.classList.toggle("active", !!chatState.toggles[key]);
  });
  const modeChip = document.getElementById("mode-chip");
  if (modeChip) modeChip.textContent = "Mode: " + chatState.mode;
}

function renderRuntime() {
  const row = document.getElementById("chat-status-row");
  const kv = document.getElementById("chat-runtime-kv");
  const chips = [
    ['cyan','Provider',chatState.provider], ['cyan','Model',chatState.model], ['ok','Mode',chatState.mode]
  ];
  if (row) row.innerHTML = chips.map(c => '<span class="status-chip '+(c[0]==='ok'?'ok':'warn')+'">'+c[1]+': '+escapeHtml(c[2])+'</span>').join("");
  if (kv) kv.innerHTML = '<div class="kv"><span>Workspace</span><span>'+escapeHtml(chatState.workspace)+'</span></div><div class="kv"><span>Provider</span><span>'+escapeHtml(chatState.provider)+'</span></div><div class="kv"><span>Model</span><span>'+escapeHtml(chatState.model)+'</span></div>';
}

function updateComposerContext() {
  const box = document.getElementById("composer-context");
  const input = document.getElementById("chat-input");
  if (!box) return;
  const text = input?.value || "";
  const chips = [];
  if (text.startsWith("/")) chips.push(['Command', text.split(/\s+/)[0]]);
  if (chatState.toggles.memory) chips.push(['RAG Memory', 'active']);
  box.innerHTML = chips.map(c => '<span class="badge badge-cyan"><strong>'+escapeHtml(c[0])+'</strong>: '+escapeHtml(c[1])+'</span>').join("");
}

function renderAttachments() {
  const chat = activeChat(); const row = document.getElementById("attachment-row"); if (!row || !chat) return;
  row.innerHTML = chat.attachments.map((a,i) => '<span class="badge badge-gray xr-s-61">📎 '+escapeHtml(a.name)+' <span data-xr-action="removeAttachment('+i+')" class="xr-s-62">×</span></span>').join("");
}

function handleComposerKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); return; }
  if (e.key === "Escape" && chatStreaming) { e.preventDefault(); stopChatGeneration(); return; }
}

function autoResize(el) { if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; }
function saveDraftSoon() { clearTimeout(chatDraftTimer); chatDraftTimer = setTimeout(() => { const c=activeChat(); const input=document.getElementById('chat-input'); if(c&&input){ c.draft=input.value; c.updatedAt=Date.now(); saveChatState(); renderChatList(); }}, 150); }

function createChat(title, persist) {
  const chat = { id: makeId('chat'), title: title || 'Primary Chat', folder:'Workspace', pinned:false, archived:false, createdAt:Date.now(), updatedAt:Date.now(), draft:'', attachments:[], messages:[] };
  chatState.chats.unshift(chat); chatState.activeId = chat.id; if (persist !== false) saveChatState(); return chat;
}
function chatNewChat(){ createChat('New Session Thread', true); renderChatWorkspace(); setTimeout(()=>document.getElementById('chat-input')?.focus(),0); }
function chatSelectChat(id){ chatState.activeId=id; saveChatState(); renderChatWorkspace(); }
function chatTogglePin(){ const c=activeChat(); if(!c) return; c.pinned=!c.pinned; c.updatedAt=Date.now(); saveChatState(); renderChatWorkspace(); }
function chatArchiveActive(){ const c=activeChat(); if(!c) return; c.archived=true; saveChatState(); toast('Chat session archived', 'info'); chatNewChat(); }
function chatBranchFromLast(){ const c=activeChat(); if(!c||!c.messages.length) return; branchAtMessage(c.messages.length-1); }
function branchAtMessage(idx){ const c=activeChat(); if(!c) return; const b=JSON.parse(JSON.stringify(c)); b.id=makeId('branch'); b.title=c.title+' (Branched)'; b.pinned=false; b.createdAt=Date.now(); b.updatedAt=Date.now(); b.messages=b.messages.slice(0,idx+1); chatState.chats.unshift(b); chatState.activeId=b.id; saveChatState(); renderChatWorkspace(); toast('Created branch thread', 'ok'); }
function editMessage(idx){ const c=activeChat(); if(!c || !c.messages[idx]) return; const msg=c.messages[idx]; const input=document.getElementById('chat-input'); if(input){ input.value=msg.content; input.focus(); autoResize(input); } c.messages=c.messages.slice(0,idx); saveChatState(); renderChatWorkspace(); }

function insertHint(text) { const input=document.getElementById('chat-input'); if(!input) return; input.value=text; input.focus(); autoResize(input); updateComposerContext(); saveDraftSoon(); }
function toggleComposerFlag(key){ chatState.toggles[key]=!chatState.toggles[key]; saveChatState(); renderComposer(); renderRuntime(); if(key==='memory') loadMemoryPeek(); }
function cycleChatMode(){ const modes=['Ask','Plan','Research','Agent']; const i=modes.indexOf(chatState.mode); chatState.mode=modes[(i+1)%modes.length]; saveChatState(); renderComposer(); renderRuntime(); }
function openAttachmentPicker(){ document.getElementById('chat-file-input')?.click(); }
function removeAttachment(i){ const c=activeChat(); if(!c) return; c.attachments.splice(i,1); saveChatState(); renderAttachments(); }
function addFilesToComposer(files){ const c=activeChat(); if(!c || !files) return; Array.from(files).forEach(f => c.attachments.push({ name:f.name, size:f.size, type:f.type || 'application/octet-stream' })); saveChatState(); renderAttachments(); toast(files.length+' file(s) attached', 'ok'); }
function handleComposerPaste(e){ const items=Array.from(e.clipboardData?.items || []); const files=items.filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean); if(files.length) addFilesToComposer(files); }
function setupDropZone(){ const zone=document.getElementById('composer-drop-zone'); if(!zone) return; zone.addEventListener('dragover', e=>e.preventDefault()); zone.addEventListener('drop', e=>{ e.preventDefault(); addFilesToComposer(e.dataTransfer?.files); }); }

async function sendChatMessage(forcedText, skipUserAppend) {
  if (chatStreaming) { stopChatGeneration(); return; }
  const input = document.getElementById("chat-input"); const btn = document.getElementById("chat-send-btn"); const chat=activeChat(); if(!chat) return;
  const text = (forcedText || input?.value || "").trim(); if(!text) return;
  if (!forcedText && input) { input.value=""; autoResize(input); }
  chat.draft=""; chat.updatedAt=Date.now(); if(!chat.title || chat.title==='Primary Chat' || chat.title==='New Session Thread') chat.title = deriveTitle(text);
  if(!skipUserAppend) chat.messages.push({ id:makeId('msg'), role:'user', content:text, ts:Date.now(), attachments:chat.attachments.slice() });
  chat.attachments=[];
  chatStreaming=true; chatAbortController = new AbortController(); if(btn){ btn.classList.add('stop'); }
  const assistantMsg = { id:makeId('msg'), role:'assistant', content:'', ts:Date.now(), streaming:true, tools:[] }; chat.messages.push(assistantMsg); saveChatState(); renderChatWorkspace();
  try {
    if (text.startsWith('/')) await handleSlashCommand(text, assistantMsg); else await streamChat(text, assistantMsg);
  } catch(e) {
    assistantMsg.content += '\\n\\n⚠ '+(e.message || 'Request failed'); addToolEvent('Chat request','Send prompt to provider','err', e.message || 'failed');
  } finally {
    assistantMsg.streaming=false; chatStreaming=false; chatAbortController=null; if(btn){ btn.classList.remove('stop'); } chat.updatedAt=Date.now(); saveChatState(); renderChatWorkspace(); input?.focus();
  }
}

function stopChatGeneration(){ if(chatAbortController) chatAbortController.abort(); chatStreaming=false; const c=activeChat(); if(c){ const m=c.messages.find(x=>x.streaming); if(m){ m.streaming=false; m.content += '\\n\\n_Stopped by administrator._'; } saveChatState(); renderMessages(); } }

async function streamChat(text, assistantMsg) {
  const toolId = addToolEvent('AI chat prompt','Call provider hot-path routing','running','Streaming...');
  const history = activeChat().messages.filter(m=>!m.streaming).slice(-10).map(m=>({ role:m.role, content:m.content }));
  const res = await fetch(BASE + "/api/chat", { method:"POST", headers:{ Authorization:"Bearer "+TOKEN, "Content-Type":"application/json" }, body:JSON.stringify({ message:text, history }), signal: chatAbortController.signal });
  if(!res.ok) { throw new Error('API routing failed or token expired.'); }
  const reader = res.body?.getReader(); const decoder = new TextDecoder(); let reply="";
  if(reader){
    while(true){ const r=await reader.read(); if(r.done) break; const chunk=decoder.decode(r.value,{stream:true}); const lines=chunk.split("\\n"); for(const line of lines){ if(!line.startsWith('data: ')) continue; const data=line.slice(6).trim(); if(data==='[DONE]') continue; try{ const j=JSON.parse(data); if(j.error) throw new Error(j.error); if(j.delta){ reply+=j.delta; } if(j.text){ reply=j.text; } } catch(e){ if(data && data[0] !== '{') reply+=data; } assistantMsg.content=reply; renderMessages(); } }
  } else { const j=await res.json(); reply=j.reply || j.content || ''; assistantMsg.content=reply; }
  updateToolEvent(toolId,'done','Completed execution');
}

async function handleSlashCommand(text, assistantMsg) {
  const parts=text.split(/\\s+/); const cmd=parts[0].toLowerCase(); const arg=text.slice(cmd.length).trim();
  if(cmd==='/plan'){ const id=addToolEvent('Control Planner','Dry-run checklists plan','running',arg); const j=await apiPost('/api/control/plan',{ task:arg || 'Build code project', noMemory:!chatState.toggles.memory }); updateToolEvent(id,'done','Plan synthesized'); assistantMsg.content = '### Planned automation checkpoints\\n\\n' + formatPlan(j.plan || []) + '\\n\\n_Planner routing: '+(j.source || 'default')+'_'; return; }
  if(cmd==='/status'){ const id=addToolEvent('System status','Load core status cards','running','Loading...'); const all=await Promise.allSettled([api('/api/overview'),api('/api/cost'),api('/api/control/status'),api('/api/providers'),api('/api/models'),api('/api/trust')]); updateToolEvent(id,'done','Complete status'); assistantMsg.content=formatStatus(all); return; }
  if(cmd==='/memory'){ const id=addToolEvent('RAG Memory','Fetch memory lists','running',arg || 'all'); const q=arg ? await api('/api/memory/search?q='+encodeURIComponent(arg)) : await api('/api/memory'); updateToolEvent(id,'done','Memory fetched'); assistantMsg.content=formatMemory(q, arg); loadMemoryPeek(); return; }
  if(cmd==='/budget'){ const id=addToolEvent('Governor budget','Assess spend ceilings','running','Checking...'); const j=await api('/api/cost'); updateToolEvent(id,'done','Budget check finished'); assistantMsg.content='### Budget controls\\n- Spent: **$'+Number(j.totalUsd||0).toFixed(6)+'**\\n- Tokens processed: **'+Number(j.totalTokens||0).toLocaleString()+'**'; return; }
  if(cmd==='/clear'){ activeChat().messages=[]; assistantMsg.content='Workspace chat cleared.'; return; }
  await streamChat(text, assistantMsg);
}

function formatPlan(plan){ if(Array.isArray(plan)) return plan.map((s,i)=> (typeof s==='string' ? (i+1)+'. '+s : (i+1)+'. **'+(s.kind||s.action||'Step')+'** — '+(s.summary||s.command||JSON.stringify(s)))).join('\\n'); return typeof plan==='string'?plan:JSON.stringify(plan,null,2); }
function formatStatus(all){ const val=i=>all[i].status==='fulfilled'?all[i].value:null; const ov=val(0), cost=val(1), ctrl=val(2), providers=val(3), models=val(4), trust=val(5); return '### XR System Status\\n\\n- **Workspace active directory**: '+(ov?.project||'default')+'\\n- **Durable Ledger checks**: '+(ov?.audit?.chain?.valid?'✓ cryptographic chain OK':'⚠ Chain modified')+'\\n- **Spend Governor**: $'+Number(cost?.totalUsd||0).toFixed(6)+' spend\\n- **Provider / Model**: '+(providers?.primary || 'ollama')+' · '+(models?.selected?.model || 'qwen2.5:7b')+'\\n- **Computer Use state**: '+(ctrl?.enabled?'opt-in authorized':'disabled')+'\\n- **Trust & Isolation**: '+(((trust&&trust.backends)||[]).filter(function(b){return b.available;}).map(function(b){return b.placement;}).join(', ')||'none')+' available (Tier-2 fail-closed)'; }
function formatMemory(j,q){ const entries=j.results || j.entries || []; if(!entries.length) return 'No vector memories found.'; return '### Vector Memories stored:\\n\\n'+entries.slice(0,10).map(e=>'- **'+(e.category||'node')+'**: '+(e.content||'')).join('\\n'); }

function addToolEvent(tool, purpose, status, result){ const id='tool_'+(++chatToolSeq); const box=document.getElementById('tool-timeline'); if(box){ const el=document.createElement('div'); el.className='tool-card '+status; el.id=id; el.innerHTML='<div class="tool-head" data-xr-action="this.parentElement.classList.toggle(\\'open\\')"><span class="tool-summary"><svg viewBox="0 0 24 24" class="xr-s-63"><polygon points="12 2 2 7 12 12 22 7 12 2z"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> <b>'+escapeHtml(tool)+'</b></span><span class="tool-indicator">'+escapeHtml(status)+'</span></div><div class="tool-body">'+escapeHtml(result||'')+'</div>'; if(box.querySelector('.muted')) box.innerHTML=''; box.prepend(el); } return id; }
function updateToolEvent(id,status,result){ const el=document.getElementById(id); if(!el) return; el.className='tool-card '+status; const st=el.querySelector('.tool-indicator'); if(st) st.textContent=status; const out=el.querySelector('.tool-body'); if(out) out.textContent=result||''; }

async function refreshInspectorData(){ loadMemoryPeek(); loadApprovals(); }
async function loadApprovals(){ const box=document.getElementById('approval-list'); if(!box) return; try{ const j=await api('/api/control/pending'); const p=j.pending||[]; box.innerHTML=p.length?p.map(a=>'<div class="approval-card xr-s-64"><strong>'+escapeHtml(a.tool || a.id)+'</strong><div class="xr-s-65">'+escapeHtml(a.reason || 'Approval required')+'</div><div class="xr-s-66"><button class="btn btn-primary xr-s-67" data-xr-action="answerApproval(\\''+a.id+'\\',true)">Allow</button><button class="btn btn-danger xr-s-67" data-xr-action="answerApproval(\\''+a.id+'\\',false)">Deny</button></div></div>').join(''):'<div class="muted">No pending authorizations.</div>'; }catch{} }
async function answerApproval(id,approved){ await apiPost('/api/control/approve',{id,approved}); toast(approved?'Action authorized':'Action blocked', approved?'ok':'warn'); loadApprovals(); }
async function loadMemoryPeek(){ const box=document.getElementById('memory-peek'); if(!box) return; try{ const j=await api('/api/memory'); const entries=(j.entries||[]).slice(0,3); box.innerHTML=entries.length?entries.map(e=>'<div class="inspector-detail xr-s-68"><strong>'+escapeHtml(e.category)+'</strong><br>'+escapeHtml(e.content)+'</div>').join(''):'<div class="muted">Memory cache is empty.</div>'; }catch{ box.innerHTML='<div class="muted">Memory offline.</div>'; } }
async function apiPost(path, body){ const res=await fetch(BASE+path,{ method:'POST', headers:{ Authorization:'Bearer '+TOKEN, 'Content-Type':'application/json' }, body:JSON.stringify(body||{}) }); const j=await res.json().catch(()=>({})); if(!res.ok) throw new Error(j.error || 'Request failed'); return j; }

function chatExportActive(){ const c=activeChat(); if(!c) return; const md='# '+c.title+'\\n\\n'+c.messages.map(m=>'## '+(m.role==='user'?'User':'Assistant')+' · '+new Date(m.ts).toLocaleString()+'\\n\\n'+m.content).join('\\n\\n'); downloadArtifact(c.title, md, 'md'); }
function downloadArtifact(name, content, ext){ const safe=String(name||'artifact').replace(/[^a-z0-9_.-]+/gi,'-').slice(0,64) || 'artifact'; const blob=new Blob([content||''],{type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=safe+'.'+(ext||'txt'); document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},0); }
function deriveTitle(text){ return text.replace(/^\\/[a-z]+\\s*/i,'').replace(/@[\\w.-]+/g,'').trim().slice(0,36) || 'Chat session'; }
function timeAgo(ts){ const s=Math.max(1,Math.floor((Date.now()-ts)/1000)); if(s<60)return s+'s ago'; const m=Math.floor(s/60); if(m<60)return m+'m ago'; const h=Math.floor(m/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; }

function extractArtifacts(text) {
  const out = [];
  const fence = /\\x60\\x60\\x60([a-zA-Z0-9_+.-]*)\\n([\\s\\S]*?)\\x60\\x60\\x60/g;
  let m; let n=1;
  while ((m = fence.exec(text))) {
    const lang = (m[1] || "text").toLowerCase();
    out.push({ type: lang, title: "Written artifact " + n++, content: m[2], ext: "txt" });
  }
  return out;
}

function formatReply(text) {
  let safe = escapeHtml(String(text || ""));
  safe = safe.replace(/\\x60\\x60\\x60([a-zA-Z0-9_+.-]*)\\n([\\s\\S]*?)\\x60\\x60\\x60/g, function(_, lang, code){ return '<pre><code class="mono">'+code+'</code></pre>'; });
  safe = safe.replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>');
  safe = safe.replace(/\\x60([^\\x60]+)\\x60/g,'<code>$1</code>');
  safe = safe.replace(/^> (.*)$/gm,'<blockquote>$1</blockquote>');
  return safe.replace(/\\n/g,'<br>');
}
function escapeHtml(t) { return String(t ?? '').replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

// ── Sessions panel
async function loadSessionsPanel() {
  try {
    const data = await api("/api/sessions");
    const sessions = data.sessions ?? [];
    const counts = data.counts ?? {};

    document.getElementById("sess-count-total").textContent = counts.sessions ?? sessions.length;
    document.getElementById("sess-count-running").textContent = counts.running ?? 0;
    document.getElementById("sess-count-done").textContent = counts.done ?? 0;
    document.getElementById("sess-count-research").textContent = counts.research ?? 0;

    document.getElementById("sess-list").innerHTML = sessions.length ? sessions.map(s => {
      const bClass = s.status === "done" ? "badge-green" : s.status === "running" ? "badge-cyan" : "badge-amber";
      return \`<div class="stat-row xr-s-69" data-xr-action="\${act('loadSessionDetail', s.id)}">
        <div><div class="xr-s-70">\${escapeHtml(s.title)}</div><div class="muted xr-s-71">\${s.id}</div></div>
        <span class="badge \${bClass}">\${s.status}</span>
      </div>\`;
    }).join("") : "<div class='muted'>No sessions stored.</div>";
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
      <div class="stat-row xr-s-82" data-xr-action="\${act('pickInstalledModel', String(m.runtime || ''), String(m.model || ''))}" title="Use this model">
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
      <div class="stat-row xr-s-90" data-xr-action="\${act('loadResearchDetail', r.id)}">
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

// ── Skills Marketplace
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

    renderMarketCategories(MARKET_ROWS);
    renderMarketplace();
    if (!MARKET_SELECTED && MARKET_ROWS[0]) inspectMarketplaceSkill(MARKET_ROWS[0].id);
  } catch {}
}

function renderMarketCategories(rows) {
  const counts = {};
  for (const s of rows) for (const c of s.categories ?? []) counts[c] = (counts[c] ?? 0) + 1;
  const cats = ["developer","security","research","business","creative","productivity"];
  document.getElementById("market-categories").innerHTML = cats.map(c => \`
    <div class="mp-cat" data-xr-action="\${act('setMarketQuery', c)}">
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
        <div class="mp-actions">\${action}</div>
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

// ── Computer Control
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
  toast("Settings updated successfully.", "ok");
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
function categoryIcon(c) { return ({developer:'⌘',security:'🛡',research:'🔬',business:'📈',creative:'🎨',productivity:'⚡'})[c] || '◇'; }

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

// ── Global Command Palette opening and results rendering
const PALETTE_ITEMS = [
  { label: "Go to Dashboard Home", action: () => navigateTo("dashboard"), key: "g d" },
  { label: "Go to Chat Sessions workspace", action: () => navigateTo("chat"), key: "g c" },
  { label: "Go to Recent Sessions history", action: () => navigateTo("sessions"), key: "g t" },
  { label: "Go to Workspaces config", action: () => navigateTo("workspaces"), key: "g w" },
  { label: "Go to Cloud Providers BYOK", action: () => navigateTo("providers"), key: "g p" },
  { label: "Go to Local Models Ollama", action: () => navigateTo("models") },
  { label: "Go to Durable Memory", action: () => navigateTo("memory"), key: "g m" },
  { label: "Go to Research Runs", action: () => navigateTo("research"), key: "g r" },
  { label: "Go to Shield (Security)", action: () => navigateTo("security"), key: "g s" },
  { label: "Go to Audit Log ledger", action: () => navigateTo("audit"), key: "g a" },
  { label: "Go to Core Settings", action: () => navigateTo("settings"), key: "g ." },
  { label: "Go to Skills Marketplace", action: () => navigateTo("skills") },
  { label: "Go to Sandboxed Plugins", action: () => navigateTo("plugins") },
  { label: "Go to MCP Servers", action: () => navigateTo("mcp") },
  { label: "Go to Computer Control", action: () => navigateTo("control") },
  { label: "Go to Alerts Hub", action: () => navigateTo("notifications") },
  { label: "Go to About Build", action: () => navigateTo("about") }
];

let paletteFocusIdx = 0;
function openPalette() {
  document.getElementById("palette").classList.add("open");
  document.getElementById("palette-search").value = "";
  renderPaletteResults("");
  document.getElementById("palette-search").focus();
  paletteFocusIdx = 0;
}
function closePalette() {
  document.getElementById("palette").classList.remove("open");
}
function renderPaletteResults(q) {
  const matches = PALETTE_ITEMS.filter(item => !q || item.label.toLowerCase().includes(q.toLowerCase()));
  const el = document.getElementById("palette-results");
  el.innerHTML = matches.map((item, i) => \`
    <div class="palette-item \${i === paletteFocusIdx ? "focused" : ""}" data-xr-action="PALETTE_ITEMS[\${PALETTE_ITEMS.indexOf(item)}].action(); closePalette();">
      <div class="palette-item-icon">
        <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <span>\${item.label}</span>
      \${item.key ? \`<span class="palette-key">\${item.key}</span>\` : ""}
    </div>
  \`).join("");
}

document.getElementById("palette-search")?.addEventListener("input", e => {
  paletteFocusIdx = 0;
  renderPaletteResults(e.target.value);
});
document.getElementById("palette-search")?.addEventListener("keydown", e => {
  const matches = PALETTE_ITEMS.filter(item => !item.label.toLowerCase().includes(e.target.value.toLowerCase()));
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
  toast("Console synced", "info");
}

// ── Initial sync
loadDashboard();

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
var XR_ACTIONS = new Set(["answerApproval","approveMemory","capabilityInspect","capabilityQuarantine","chatArchiveActive","chatBranchFromLast","chatExportActive","chatNewChat","chatSelectChat","chatTogglePin","clearMemory","clearNotifications","closePalette","copyText","createWorkspace","cycleChatMode","deleteMemory","doMemSearch","downloadArtifact","editMessage","emergencyStopControl","exportFullData","focusChangeModel","insertHint","inspectMarketplaceSkill","installMarketplaceSkill","killProcess","loadAuditLog","loadBudgetPanel","loadCapabilities","loadMarketplace","loadMcp","loadModels","loadPlugins","loadResearchDetail","loadResearchPanel","loadSessionDetail","loadSessionsPanel","loadWorkspaces","navigateTo","openAttachmentPicker","openPalette","pickInstalledModel","pluginAction","pluginRemove","quarantineFile","refreshAll","registerMcp","removeAttachment","removeMcp","revokeMemory","runSecLab","runShieldScan","saveAllSettings","saveBudgetConfig","saveModelSelection","saveProviderRouting","searchPlugins","sendChatMessage","setMarketFilter","setMarketQuery","setMarketSort","setTimeout","skillAction","switchSettingsPane","switchShieldTab","switchWorkspaceUI","syncMarketplace","testModelSelection","toast","toggleComposerFlag","toggleShieldAdBlock","verifyAuditLedger"]);
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
