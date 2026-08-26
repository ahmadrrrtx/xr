/**
 * XR Control Center served-client fragment — chat workspace (state, renderers, composer, stream, slash commands, approvals, tool timeline).
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const CHAT = `// ── Chat State & Composer
const CHAT_STORE_KEY = "xr.chat.workspace.v31f";
let chatStreaming = false;
let chatAbortController = null;
let chatState = loadChatState();
let chatDraftTimer = 0;
let chatToolSeq = 0;
// Phase 12 · Phase D — the canonical run status of the in-flight chat run,
// straight from the shared vocabulary in src/core/ux-status.ts (interpolated
// into this served script as xrStatusLabel/xrStatusTone). null when idle.
let chatRunStatus = null;
let chatRunStatusDetail = null;
// Maps a canonical tool_call event id to the timeline card rendering it, so a
// tool_result lands on the SAME card instead of creating a second one.
let chatToolCards = {};

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
    // Phase 12 · Phase G — mode is the ONE piece of run state the browser owns,
    // because the user picks it. It is validated against the real Mode union
    // (src/core/types.ts: "agent" | "plan" | "ask") and now actually SENT with
    // the request. The default mirrors the server's own default: safe read-only.
    mode: ["agent", "plan", "ask"].indexOf(state.mode) >= 0 ? state.mode : "ask",
    // provider / model / workspace are DAEMON state, not browser state. They are
    // hydrated by syncChatRuntime(). Until then they are empty and render as
    // "detecting…" — never as a plausible-looking fake ("Auto"/"Default") that
    // silently contradicts what the CLI and the Shell report.
    provider: "",
    model: "",
    workspace: "",
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
  // Phase 12 · Phase G — the header reads the daemon's real provider/model/
  // workspace, not a localStorage guess. Async and non-blocking: the shell
  // paints first and the values land when they arrive.
  void syncChatRuntime();
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
      html += \`<div class="chat-session-item \${c.id === chatState.activeId ? "active" : ""}" role="button" tabindex="0" data-xr-action="\${act('chatSelectChat', c.id)}">
        <div class="chat-session-item-title">\${escapeHtml(c.title)}</div>
        <div class="chat-session-item-meta">\${c.messages.length} messages · \${timeAgo(c.updatedAt)}</div>
      </div>\`;
    });
  });
  list.innerHTML = html || '<div class="muted xr-s-56">No session logs.</div>';
}

// Phase E · E-1 — avatar state orb: communicates the REAL agent state.
//   idle    — no run in flight
//   thinking— a chat completion is streaming
//   working — a tool/step is currently executing (timeline has a running card)
// Speaking/listening states are NOT shown: the dashboard does not drive the
// audio pipeline (honest — see the Voice panel), so faking them is banned.
function setAvatarState(kind) {
  const tone = kind === "thinking" ? "thinking" : kind === "working" ? "working" : "idle";
  const label = tone === "thinking" ? "XR is thinking" : tone === "working" ? "XR is running a tool" : "XR is idle";
  const orb = document.getElementById("chat-state-orb");
  if (orb) {
    orb.className = "chat-state-orb " + tone;
    orb.setAttribute("aria-label", label);
  }
  const empty = document.getElementById("chat-empty-orb");
  if (empty) {
    empty.className = "chat-empty-orb " + tone;
    empty.setAttribute("aria-label", label);
  }
}
function applyAvatarState() {
  const running = !!(document.querySelector(".tool-card.running"));
  if (running) setAvatarState("working");
  else if (chatStreaming) setAvatarState("thinking");
  else setAvatarState("idle");
}

// Phase C · C-3 — streaming transparency: a polite live-region announcer
// (start/end/error/stops — never per-token) and an inline marker when the
// stream is mid-code-block.
function announceStream(msg) {
  const el = document.getElementById("xr-stream-announcer");
  if (el) el.textContent = msg;
}
/**
 * Phase 12 · Phase D — one truthful status line for the run.
 *
 * The Control Center used to swallow every status except the two provider ones,
 * so during a long run it showed nothing but a fabricated "Streaming..." card.
 * This renders the canonical label instead, in the existing status row, and
 * mirrors it to the polite live region (never a focus-stealing one).
 *
 * Pass null to clear it when the run ends.
 */
function setChatRunStatus(status, detail) {
  chatRunStatus = status || null;
  chatRunStatusDetail = detail || null;
  if (chatRunStatus) {
    announceStream(xrStatusLabel(chatRunStatus, chatRunStatusDetail));
    if (xrStatusTone(chatRunStatus) === "wait") setAvatarState("idle");
    else setAvatarState("working");
  }
  renderRuntime();
}
/** Human-readable one-line summary of tool arguments.
 *  Tool args are untrusted data and can be huge or secret-bearing, so the card
 *  shows a bounded summary; the full value stays in the collapsible body. */
function summarizeToolArgs(args) {
  if (args === null || args === undefined) return "";
  try {
    const s = typeof args === "string" ? args : JSON.stringify(args);
    return s.length > 120 ? s.slice(0, 120) + "\\u2026" : s;
  } catch (e) { return ""; }
}
function renderStreamNote(m) {
  if (!m.streaming) return "";
  const content = m.content || "";
  const fences = (content.match(/\`\`\`/g) || []).length;
  if (fences % 2 === 1) return '<div class="msg-streaming-note">…streaming code…</div>';
  return "";
}
function renderMessages() {
  const feed = document.getElementById("chat-messages");
  const chat = activeChat();
  if (!feed || !chat) return;
  document.getElementById("chat-title").textContent = chat.title;
  document.getElementById("chat-pin-btn").textContent = chat.pinned ? "Pinned" : "Pin";

  // Phase B · B-3 — the empty-state hero is static markup (#chat-empty-state);
  // toggle it against the message feed instead of stamping a thin placeholder.
  const emptyState = document.getElementById("chat-empty-state");
  if (!chat.messages.length) {
    if (emptyState) emptyState.hidden = false;
    feed.innerHTML = "";
    return;
  }
  if (emptyState) emptyState.hidden = true;

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
      <div class="msg-bubble">\${formatReply(m.content || "")}\${renderArtifacts(m)}\${renderStreamNote(m)}</div>
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
    ['cyan','Provider',chatState.provider || 'detecting\u2026'], ['cyan','Model',chatState.model || 'detecting\u2026'], ['ok','Mode',chatState.mode]
  ];
  // Phase 12 · Phase D — the run's canonical status rides alongside the
  // provider/model/mode chips, so the header says what XR is doing right now
  // in the same words the Shell uses. Tone comes from the shared vocabulary.
  if (chatRunStatus) {
    const tone = xrStatusTone(chatRunStatus);
    chips.push([tone === "ok" ? "ok" : tone === "error" ? "err" : "warn", "Status", xrStatusLabel(chatRunStatus, chatRunStatusDetail)]);
  }
  if (row) row.innerHTML = chips.map(c => '<span class="status-chip '+(c[0]==='ok'?'ok':c[0]==='err'?'err':'warn')+'">'+escapeHtml(c[1])+': '+escapeHtml(c[2])+'</span>').join("");
  if (kv) kv.innerHTML = '<div class="kv"><span>Workspace</span><span>'+escapeHtml(chatState.workspace || 'detecting\u2026')+'</span></div><div class="kv"><span>Provider</span><span>'+escapeHtml(chatState.provider || 'detecting\u2026')+'</span></div><div class="kv"><span>Model</span><span>'+escapeHtml(chatState.model || 'detecting\u2026')+'</span></div>';
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
  row.innerHTML = chat.attachments.map((a,i) => '<span class="badge badge-gray xr-s-61"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="12" height="12"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> '+escapeHtml(a.name)+' <button type="button" data-xr-action="removeAttachment('+i+')" class="badge-x" aria-label="Remove attachment '+escapeHtml(a.name)+'">×</button></span>').join("");
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
// Phase 12 · Phase G — only the three REAL modes. "Research" was a fourth
// option mapping to nothing: the server has no research mode, and the value was
// never sent at all, so cycling it changed a label and nothing else.
function cycleChatMode(){ const modes=['ask','plan','agent']; const i=modes.indexOf(chatState.mode); chatState.mode=modes[(i+1)%modes.length]; saveChatState(); renderComposer(); renderRuntime(); }
/**
 * Phase 12 · Phase G — hydrate the chat header from the daemon.
 *
 * Provider, model and workspace used to be localStorage strings defaulting to
 * "Auto"/"Auto"/"Default", so the header could name a provider the CLI and the
 * Shell had never heard of — precisely the "CLI says one model, dashboard says
 * another" divergence. One agent must read the same from every window.
 *
 * Failure is silent on purpose: if the daemon is unreachable the fields stay
 * empty and render as "detecting…". Inventing a value would be worse than
 * admitting we do not know.
 */
async function syncChatRuntime() {
  try {
    const p = await api("/api/providers");
    if (p && p.primary) { chatState.provider = p.primary; chatState.model = p.model || ""; }
  } catch (e) {}
  try {
    const ov = await api("/api/overview");
    if (ov && ov.project) chatState.workspace = ov.project;
  } catch (e) {}
  renderRuntime();
}
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
  chatStreaming=true; chatAbortController = new AbortController(); if(btn){ btn.classList.add('stop'); } setAvatarState("thinking");
  const assistantMsg = { id:makeId('msg'), role:'assistant', content:'', ts:Date.now(), streaming:true, tools:[] }; chat.messages.push(assistantMsg); saveChatState(); renderChatWorkspace();
  try {
    if (text.startsWith('/')) await handleSlashCommand(text, assistantMsg); else await streamChat(text, assistantMsg);
  } catch(e) {
    announceStream("XR hit an error"); assistantMsg.content += '\\n\\n⚠ '+(e.message || 'Request failed'); addToolEvent('Chat request','Send prompt to provider','err', e.message || 'failed');
  } finally {
    assistantMsg.streaming=false; chatStreaming=false; chatAbortController=null; if(btn){ btn.classList.remove('stop'); } chat.updatedAt=Date.now(); saveChatState(); renderChatWorkspace(); input?.focus();
    loadComposerMeta();
    applyAvatarState();
    // Phase 12 — never leave a stale status chip behind (brief §16). Whatever
    // happened, the run is over, so the run status is cleared here rather than
    // left describing work that is no longer in flight.
    chatToolCards = {};
    setChatRunStatus(null);
    // A run can move the effective provider (fallback). Re-read it so the
    // header never keeps describing the pre-run state.
    void syncChatRuntime();
  }
}

function stopChatGeneration(){ if(chatAbortController) chatAbortController.abort(); chatStreaming=false;
  // Phase 12 · Phase D — a truthful interrupt. The abort signals the daemon,
  // which cancels cooperatively at the loop's next checkpoint, so this says
  // "requested" rather than claiming the work already stopped.
  announceStream("Cancellation requested");
  Object.keys(chatToolCards).forEach(function(k){ updateToolEvent(chatToolCards[k].card, 'err', 'Interrupted \u2014 no result reported.'); });
  chatToolCards = {};
  setChatRunStatus("cancelled", null);
  applyAvatarState(); const c=activeChat(); if(c){ const m=c.messages.find(x=>x.streaming); if(m){ m.streaming=false; m.content += '\\n\\n_Stopped by administrator._'; } saveChatState(); renderMessages(); } }

async function streamChat(text, assistantMsg) {
  // Phase 12 · Phase D — the fabricated "Call provider hot-path routing /
  // Streaming..." card is gone. It described work XR was not doing and hid the
  // work XR WAS doing: the route had been emitting real tool_call/tool_result/
  // usage events all along and this client dropped every one of them. The
  // timeline now shows the tools that really ran and the status line shows what
  // XR is really doing, both from the canonical event stream.
  chatToolCards = {};
  setChatRunStatus("preparing", null);
  const history = activeChat().messages.filter(m=>!m.streaming).slice(-10).map(m=>({ role:m.role, content:m.content }));
  const res = await fetch(BASE + "/api/v1/chat", { method:"POST", headers:{ Authorization:"Bearer "+TOKEN, "Content-Type":"application/json" }, body:JSON.stringify({ message:text, history, mode: chatState.mode }), signal: chatAbortController.signal });
  if(!res.ok) { setChatRunStatus(null); throw new Error('API routing failed or token expired.'); }
  const reader = res.body?.getReader(); const decoder = new TextDecoder(); let reply=""; let usage=null;
  if(reader){
    while(true){ const r=await reader.read(); if(r.done) break; const chunk=decoder.decode(r.value,{stream:true}); const lines=chunk.split("\\n"); for(const line of lines){ if(!line.startsWith('data: ')) continue; const data=line.slice(6).trim(); if(data==='[DONE]') continue; try{ const j=JSON.parse(data); if(j.error) throw new Error(j.error);
      // Phase 05 canonical streaming contract — consumed in full (Phase 12):
      if(j.type==='status'){
        setChatRunStatus(j.status, j.status==='tool_running' ? j.message : null);
        if(j.status==='provider_selection'||j.status==='provider_ready'){ renderRuntime(); }
        continue;
      }
      if(j.type==='token'){ reply+=j.text; }
      else if(j.type==='tool_call'){
        // Real tool, real (bounded, untrusted) arguments, real running state.
        const cardId = addToolEvent(j.tool || 'tool', null, 'running', summarizeToolArgs(j.args) || 'Running\\u2026');
        if(j.id) chatToolCards[j.id] = { card: cardId, t0: Date.now() };
        setChatRunStatus('tool_running', j.tool || null);
      }
      else if(j.type==='tool_result'){
        const rec = j.id ? chatToolCards[j.id] : null;
        // Tool output is DATA, never instructions: it goes through escapeHtml
        // into the collapsible body exactly as the framing layer intends.
        const body = j.ok ? (j.result || 'Completed') : (j.error || 'Failed');
        const took = rec ? ' \\u00b7 ' + (Date.now() - rec.t0) + 'ms' : '';
        if(rec) updateToolEvent(rec.card, j.ok ? 'done' : 'err', body + took);
        else addToolEvent(j.tool || 'tool', null, j.ok ? 'done' : 'err', body + took);
        if(j.id) delete chatToolCards[j.id];
      }
      else if(j.type==='usage'){ usage = j.usage || usage; }
      else if(j.type==='done'){ reply=j.fullText || j.finalMessage || reply; if(j.usage) usage=j.usage; }
      else if(j.type==='error'){ throw new Error(j.message || j.error || 'generation failed'); }
      else if(j.delta){ reply+=j.delta; }
      else if(j.text){ reply=j.text; } // legacy fullText replacement
    } catch(e){ if(data && data[0] !== '{') reply+=data; } assistantMsg.content=reply; renderMessages(); } }
  } else { const j=await res.json(); reply=j.reply || j.content || ''; assistantMsg.content=reply; }
  // Any tool whose result never arrived is left honest. The old code stamped
  // every run "Completed execution" regardless; claiming success for work whose
  // outcome was never observed is exactly what must not happen.
  Object.keys(chatToolCards).forEach(function(k){ updateToolEvent(chatToolCards[k].card, 'err', 'No result reported \\u2014 the run ended first.'); });
  chatToolCards = {};
  setChatRunStatus(null);
  announceStream(usage ? 'Response complete \\u00b7 ' + (usage.inTokens || 0) + ' tokens in / ' + (usage.outTokens || 0) + ' out' : 'Response complete');
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

function addToolEvent(tool, purpose, status, result){ const id='tool_'+(++chatToolSeq); const box=document.getElementById('tool-timeline'); if(status==='running') setAvatarState('working'); if(box){ const el=document.createElement('div'); el.className='tool-card '+status; el.id=id; el.innerHTML='<div class="tool-head" role="button" tabindex="0" aria-expanded="false"><span class="tool-summary"><svg viewBox="0 0 24 24" class="xr-s-63" aria-hidden="true" focusable="false"><polygon points="12 2 2 7 12 12 22 7 12 2z"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> <b>'+escapeHtml(tool)+'</b></span><span class="tool-indicator">'+escapeHtml(status)+'</span></div><div class="tool-body">'+escapeHtml(result||'')+'</div>'; if(box.querySelector('.muted')) box.innerHTML=''; box.prepend(el); } return id; }
function updateToolEvent(id,status,result){ const el=document.getElementById(id); if(!el) return; el.className='tool-card '+status; const st=el.querySelector('.tool-indicator'); if(st) st.textContent=status; const out=el.querySelector('.tool-body'); if(out) out.textContent=result||''; applyAvatarState(); }

async function refreshInspectorData(){ loadMemoryPeek(); loadApprovals(); }
// Phase C · C-2 — approvals show WHAT / WHY / RISK from the real control
// plane: /api/control/pending returns { id, action, risk:{level,reason,
// reversible}, preview } per pending item. The old card ignored those fields
// and showed the raw id; this renders the governed intent honestly.
function approvalActionLabel(a) {
  const act = (a && a.action) || {};
  const t = act.type || "action";
  switch (t) {
    case "app": return "Launch app: " + (act.name || "?");
    case "close": return "Close window: " + (act.name || "?");
    case "focus": return "Focus window: " + (act.name || "?");
    case "open": return "Open: " + (act.target || "?");
    case "type": return "Type text" + (act.sensitive ? " (sensitive)" : "");
    case "click": return "Click" + (act.target ? ": " + act.target : "");
    case "drag_drop": return "Drag & drop";
    case "scroll": return "Scroll";
    case "key": return "Press key";
    case "screenshot": return "Take screenshot";
    case "system": return "System action: " + (act.name || "?");
    default: return String(t).replace(/_/g, " ");
  }
}
function approvalRiskLabel(level) {
  if (level === "destructive") return ["DESTRUCTIVE", "badge-red"];
  if (level === "sensitive") return ["SENSITIVE", "badge-amber"];
  return ["SAFE", "badge-green"];
}
async function loadApprovals(){
  const box=document.getElementById('approval-list'); if(!box) return;
  try{
    const j=await api('/api/control/pending'); const p=j.pending||[];
    box.innerHTML=p.length?p.map(a=>{
      const risk=a.risk||{}; const [riskWord,riskBadge]=approvalRiskLabel(risk.level);
      const rev = risk.reversible === false ? " Not reversible." : (risk.reversible ? " Reversible." : "");
      return '<div class="approval-card" role="group" aria-label="Approval: '+escapeHtml(approvalActionLabel(a))+'">' +
        '<div class="approval-what">'+escapeHtml(approvalActionLabel(a))+'</div>' +
        '<div class="approval-why">'+escapeHtml(a.preview || 'This action needs your permission.')+'</div>' +
        '<div class="approval-risk"><span class="badge '+riskBadge+'">'+riskWord+'</span>'+(risk.reason?' <span class="approval-risk-reason">'+escapeHtml(risk.reason)+'</span>':'')+rev+'</div>' +
        '<div class="approval-btns"><button class="btn btn-primary" data-xr-action="answerApproval(\\''+a.id+'\\',true)">Allow</button>' +
        '<button class="btn btn-danger" data-xr-action="answerApproval(\\''+a.id+'\\',false)">Deny</button></div>' +
      '</div>';
    }).join(''):'<div class="muted">No pending authorizations.</div>';
  }catch{}
}
async function answerApproval(id,approved){ await apiPost('/api/control/approve',{id,approved}); toast(approved?'Action authorized':'Action blocked', approved?'ok':'warn'); loadApprovals(); }
async function loadMemoryPeek(){ const box=document.getElementById('memory-peek'); if(!box) return; try{ const j=await api('/api/memory'); const entries=(j.entries||[]).slice(0,3); box.innerHTML=entries.length?entries.map(e=>'<div class="inspector-detail xr-s-68"><strong>'+escapeHtml(e.category)+'</strong><br>'+escapeHtml(e.content)+'</div>').join(''):'<div class="muted">Memory cache is empty.</div>'; }catch{ box.innerHTML='<div class="muted">Memory offline.</div>'; } }
async function apiPost(path, body){ const res=await fetch(BASE+v1(path),{ method:'POST', headers:{ Authorization:'Bearer '+TOKEN, 'Content-Type':'application/json' }, body:JSON.stringify(body||{}) }); const j=await res.json().catch(()=>({})); if(!res.ok) throw new Error(j.error || 'Request failed'); return j; }

function chatExportActive(){ const c=activeChat(); if(!c) return; const md='# '+c.title+'\\n\\n'+c.messages.map(m=>'## '+(m.role==='user'?'User':'Assistant')+' · '+new Date(m.ts).toLocaleString()+'\\n\\n'+m.content).join('\\n\\n'); downloadArtifact(c.title, md, 'md'); }
function downloadArtifact(name, content, ext){ const safe=String(name||'artifact').replace(/[^a-z0-9_.-]+/gi,'-').slice(0,64) || 'artifact'; const blob=new Blob([content||''],{type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=safe+'.'+(ext||'txt'); document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},0); }
function deriveTitle(text){ return text.replace(/^\\/[a-z]+\\s*/i,'').replace(/@[\\w.-]+/g,'').trim().slice(0,36) || 'Chat session'; }
function timeAgo(ts){ const s=Math.max(1,Math.floor((Date.now()-ts)/1000)); if(s<60)return s+'s ago'; const m=Math.floor(s/60); if(m<60)return m+'m ago'; const h=Math.floor(m/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; }

// ── Phase A — real clipboard copy. copyText was allowlisted but never
// defined: the message "Copy" button was a silent no-op. It now works and
// also powers the voice command copy buttons (honest, no simulation).
function copyText(text) {
  const value = String(text ?? "");
  if (!value) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { toast("Copied to clipboard", "ok"); },
        function () { legacyCopy(value); }
      );
    } else { legacyCopy(value); }
  } catch (e) { legacyCopy(value); }
}
function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "absolute";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); toast("Copied to clipboard", "ok"); }
  catch (e) { toast("Copy failed — select the text manually", "warn"); }
  document.body.removeChild(ta);
}

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

`;
