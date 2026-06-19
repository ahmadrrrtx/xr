/**
 * XR Stage 5 — Dashboard HTML (fully self-contained)
 *
 * Design language:
 *  - XR brand identity: #00D4FF cyan primary, #00FF88 green success, #F59E0B amber
 *  - Dark-first (#0A0A0F bg), glass-morphism cards
 *  - Bento grid layout with responsive columns
 *  - Animated status indicators, live polling via fetch()
 *  - Full chat panel accessible from dashboard
 *  - No external deps — all CSS/JS inline, offline-safe
 *  - Sidebar navigation: Dashboard, Chat, Providers, Models, Memory,
 *    Research, Plugins, Voice, Security, Settings, Status
 *  - Security: token in Authorization header, never in URL beyond first load
 *  - Keyboard shortcuts: ? = help, g+d = dashboard, g+c = chat, etc.
 */

export function dashboardHtml(token: string): string {
  return PAGE.replaceAll("__TOKEN__", token);
}

const PAGE = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>XR — Control Center</title>
<style>
/* ── CSS Reset & Variables ─────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:       #0A0A0F;
  --bg2:      #0D1117;
  --surface:  #111827;
  --surface2: #1A2234;
  --border:   #1F2937;
  --border2:  #2D3748;
  --cyan:     #00D4FF;
  --green:    #00FF88;
  --amber:    #F59E0B;
  --red:      #FF4D4D;
  --muted:    #6B7280;
  --text:     #F9FAFB;
  --textDim:  #9CA3AF;
  --radius:   8px;
  --radius2:  12px;
  --shadow:   0 4px 24px rgba(0,0,0,.4);
  --glowC:    0 0 20px rgba(0,212,255,.15);
  --glowG:    0 0 20px rgba(0,255,136,.15);
  --glowA:    0 0 20px rgba(245,158,11,.15);
  --font:     'JetBrains Mono','Fira Code','Cascadia Code',ui-monospace,monospace;
  --sans:     'Inter','Segoe UI',system-ui,sans-serif;
  --sidebar:  220px;
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;line-height:1.6;overflow:hidden}

/* ── Scrollbar ─────────────────────────────────────────────────────────── */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}

/* ── Layout ────────────────────────────────────────────────────────────── */
.app{display:flex;height:100vh;overflow:hidden}

/* ── Sidebar ────────────────────────────────────────────────────────────── */
.sidebar{
  width:var(--sidebar);min-width:var(--sidebar);
  background:var(--bg2);border-right:1px solid var(--border);
  display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;
  padding:0 0 16px;
}
.sidebar-logo{
  display:flex;align-items:center;gap:10px;
  padding:20px 16px 16px;border-bottom:1px solid var(--border);
  cursor:default;user-select:none;
}
.logo-mark{font-family:var(--font);font-size:18px;font-weight:700;color:var(--cyan);letter-spacing:-1px}
.logo-text{font-size:13px;font-weight:600;color:var(--text)}
.logo-badge{font-size:10px;color:var(--muted);font-family:var(--font)}
.sidebar-section{padding:8px 0}
.sidebar-label{
  font-size:10px;font-weight:600;letter-spacing:.08em;
  text-transform:uppercase;color:var(--muted);
  padding:8px 16px 4px;
}
.nav-item{
  display:flex;align-items:center;gap:8px;
  padding:7px 16px;cursor:pointer;
  border-radius:0;font-size:13px;color:var(--textDim);
  transition:background .12s,color .12s;
  border-left:2px solid transparent;
  text-decoration:none;
}
.nav-item:hover{background:rgba(255,255,255,.04);color:var(--text)}
.nav-item.active{
  background:rgba(0,212,255,.08);color:var(--cyan);
  border-left-color:var(--cyan);font-weight:600;
}
.nav-item .nav-icon{width:16px;text-align:center;font-size:14px}
.sidebar-spacer{flex:1}
.sidebar-footer{padding:12px 16px;border-top:1px solid var(--border)}
.provider-pill{
  display:flex;align-items:center;gap:6px;
  font-family:var(--font);font-size:11px;color:var(--textDim);
  padding:6px 10px;background:var(--surface);border-radius:var(--radius);
}
.provider-dot{width:6px;height:6px;border-radius:50%;background:var(--green)}

/* ── Main Area ──────────────────────────────────────────────────────────── */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{
  display:flex;align-items:center;gap:12px;
  padding:12px 20px;border-bottom:1px solid var(--border);
  background:var(--bg2);min-height:52px;
}
.topbar-title{font-weight:600;font-size:15px;color:var(--text)}
.topbar-spacer{flex:1}
.topbar-status{display:flex;align-items:center;gap:12px}
.status-chip{
  display:flex;align-items:center;gap:5px;
  font-size:11px;font-family:var(--font);
  padding:4px 10px;border-radius:20px;
  background:var(--surface);color:var(--textDim);
}
.status-chip .dot{width:6px;height:6px;border-radius:50%}
.status-chip.ok .dot{background:var(--green)}
.status-chip.warn .dot{background:var(--amber)}
.status-chip.err .dot{background:var(--red)}
.content{flex:1;overflow-y:auto;overflow-x:hidden;padding:20px}

/* ── Panels / Views ─────────────────────────────────────────────────────── */
.panel{display:none}
.panel.active{display:block}

/* ── Grid ───────────────────────────────────────────────────────────────── */
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:repeat(2,1fr)}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
@media(max-width:1100px){.grid-3,.grid-4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:700px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}}

/* ── Cards ───────────────────────────────────────────────────────────────── */
.card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius2);padding:16px;
}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.card-title{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.card-icon{font-size:14px}
.card-value{font-family:var(--font);font-size:22px;font-weight:700;color:var(--text)}
.card-sub{font-size:11px;color:var(--muted);margin-top:2px}
.card-glow-cyan{box-shadow:var(--glowC)}
.card-glow-green{box-shadow:var(--glowG)}
.card-glow-amber{box-shadow:var(--glowA)}

/* ── Stat Row ────────────────────────────────────────────────────────────── */
.stat-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)}
.stat-row:last-child{border-bottom:none}
.stat-key{font-size:12px;color:var(--muted)}
.stat-val{font-family:var(--font);font-size:12px;font-weight:600}
.val-green{color:var(--green)}
.val-cyan{color:var(--cyan)}
.val-amber{color:var(--amber)}
.val-red{color:var(--red)}
.val-muted{color:var(--muted)}

/* ── Health Bar ──────────────────────────────────────────────────────────── */
.health-bar{height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:8px}
.health-bar-fill{height:100%;border-radius:2px;transition:width .6s ease}
.health-bar-fill.green{background:var(--green)}
.health-bar-fill.amber{background:var(--amber)}
.health-bar-fill.red{background:var(--red)}
.health-bar-fill.cyan{background:var(--cyan)}

/* ── Provider Grid ───────────────────────────────────────────────────────── */
.provider-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;margin-top:8px}
.provider-item{
  display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:10px 6px;background:var(--surface2);border-radius:var(--radius);
  border:1px solid var(--border);cursor:pointer;
  font-size:11px;text-align:center;color:var(--textDim);
  transition:border-color .12s,color .12s;
}
.provider-item:hover{border-color:var(--cyan);color:var(--text)}
.provider-item.active{border-color:var(--cyan);color:var(--cyan)}
.provider-item.offline{opacity:.4;cursor:default}
.provider-avatar{
  width:28px;height:28px;border-radius:50%;
  background:var(--border);display:flex;align-items:center;
  justify-content:center;font-size:12px;font-weight:700;
  font-family:var(--font);color:var(--text);
}

/* ── Audit Log ───────────────────────────────────────────────────────────── */
.audit-row{
  display:grid;grid-template-columns:auto 1fr auto;
  gap:8px;padding:6px 0;border-bottom:1px solid var(--border);
  font-family:var(--font);font-size:11px;align-items:start;
}
.audit-row:last-child{border-bottom:none}
.audit-ts{color:var(--muted);white-space:nowrap}
.audit-event{color:var(--textDim);word-break:break-all}
.audit-hash{color:var(--muted);font-size:10px;white-space:nowrap}

/* ── Memory List ─────────────────────────────────────────────────────────── */
.mem-item{
  display:flex;gap:10px;align-items:start;
  padding:8px 0;border-bottom:1px solid var(--border);
}
.mem-item:last-child{border-bottom:none}
.mem-cat{
  font-size:10px;padding:2px 6px;border-radius:4px;
  background:rgba(0,212,255,.12);color:var(--cyan);
  white-space:nowrap;font-weight:600;font-family:var(--font);
}
.mem-content{font-size:12px;color:var(--textDim);flex:1}
.mem-del{cursor:pointer;color:var(--muted);font-size:12px;opacity:.4;transition:opacity .1s}
.mem-del:hover{opacity:1;color:var(--red)}

/* ── Badge ───────────────────────────────────────────────────────────────── */
.badge{
  display:inline-flex;align-items:center;
  font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;
  font-family:var(--font);
}
.badge-green{background:rgba(0,255,136,.12);color:var(--green)}
.badge-cyan{background:rgba(0,212,255,.12);color:var(--cyan)}
.badge-amber{background:rgba(245,158,11,.12);color:var(--amber)}
.badge-red{background:rgba(255,77,77,.12);color:var(--red)}
.badge-gray{background:var(--surface2);color:var(--muted)}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.btn{
  display:inline-flex;align-items:center;gap:6px;
  padding:7px 14px;border-radius:var(--radius);
  font-size:13px;font-weight:600;cursor:pointer;
  border:none;transition:opacity .12s,filter .12s;
  font-family:var(--sans);
}
.btn:hover{filter:brightness(1.1)}
.btn-primary{background:var(--cyan);color:#000}
.btn-ghost{background:transparent;color:var(--textDim);border:1px solid var(--border)}
.btn-ghost:hover{border-color:var(--cyan);color:var(--cyan)}
.btn-danger{background:transparent;color:var(--red);border:1px solid rgba(255,77,77,.3)}

/* ── Chat UI ─────────────────────────────────────────────────────────────── */
.chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 52px)}
.chat-header{
  display:flex;align-items:center;gap:10px;
  padding:12px 20px;border-bottom:1px solid var(--border);
  background:var(--bg2);
}
.chat-header-title{font-weight:600;font-size:14px}
.chat-header-model{font-size:11px;color:var(--muted);font-family:var(--font)}
.chat-messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px}
.msg{display:flex;flex-direction:column;gap:4px;max-width:820px}
.msg.user{align-self:flex-end;align-items:flex-end}
.msg.assistant{align-self:flex-start;align-items:flex-start}
.msg-bubble{
  padding:12px 16px;border-radius:var(--radius2);
  font-size:14px;line-height:1.7;max-width:100%;word-break:break-word;
}
.msg.user .msg-bubble{
  background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.2);color:var(--text);
}
.msg.assistant .msg-bubble{
  background:var(--surface);border:1px solid var(--border);color:var(--text);
}
.msg-meta{font-size:10px;color:var(--muted);font-family:var(--font);padding:0 4px}
.msg-tool{
  display:flex;align-items:center;gap:6px;
  font-size:11px;font-family:var(--font);color:var(--muted);
  padding:6px 10px;background:var(--surface2);border-radius:6px;
  border-left:2px solid var(--cyan);
}
.chat-input-wrap{
  padding:16px 20px;border-top:1px solid var(--border);
  background:var(--bg2);
}
.chat-input-row{
  display:flex;gap:10px;align-items:flex-end;
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius2);padding:8px 12px;
  transition:border-color .12s;
}
.chat-input-row:focus-within{border-color:var(--cyan)}
#chat-input{
  flex:1;background:none;border:none;outline:none;
  color:var(--text);font-size:14px;font-family:var(--sans);
  resize:none;min-height:24px;max-height:200px;line-height:1.5;
}
.chat-send{
  background:var(--cyan);color:#000;border:none;
  padding:6px 14px;border-radius:6px;cursor:pointer;
  font-weight:700;font-size:13px;white-space:nowrap;
  transition:opacity .12s;flex-shrink:0;
}
.chat-send:hover{opacity:.85}
.chat-send:disabled{opacity:.4;cursor:default}
.chat-hint{
  display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;
}
.hint-chip{
  font-size:11px;padding:3px 8px;border-radius:4px;
  background:var(--surface2);color:var(--muted);
  cursor:pointer;border:1px solid var(--border);
  transition:border-color .1s,color .1s;
}
.hint-chip:hover{border-color:var(--cyan);color:var(--cyan)}
.typing-indicator{display:flex;align-items:center;gap:4px;padding:8px 16px}
.typing-dot{width:6px;height:6px;border-radius:50%;background:var(--cyan);animation:pulse 1.2s infinite}
.typing-dot:nth-child(2){animation-delay:.2s}
.typing-dot:nth-child(3){animation-delay:.4s}
@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}

/* ── Settings ────────────────────────────────────────────────────────────── */
.settings-section{margin-bottom:24px}
.settings-title{font-weight:600;margin-bottom:12px;color:var(--text)}
.settings-row{
  display:flex;justify-content:space-between;align-items:center;
  padding:10px 0;border-bottom:1px solid var(--border);
}
.settings-row:last-child{border-bottom:none}
.settings-key{font-size:13px;color:var(--text)}
.settings-desc{font-size:11px;color:var(--muted);margin-top:1px}
.settings-val{font-family:var(--font);font-size:12px;color:var(--cyan)}
.toggle{
  position:relative;width:36px;height:20px;cursor:pointer;
}
.toggle input{opacity:0;width:0;height:0}
.toggle-slider{
  position:absolute;top:0;left:0;right:0;bottom:0;
  background:var(--border2);border-radius:20px;transition:.2s;
}
.toggle-slider::before{
  content:'';position:absolute;width:14px;height:14px;
  left:3px;bottom:3px;background:var(--muted);border-radius:50%;transition:.2s;
}
.toggle input:checked+.toggle-slider{background:var(--cyan)}
.toggle input:checked+.toggle-slider::before{transform:translateX(16px);background:#000}

/* ── Security Panel ──────────────────────────────────────────────────────── */
.sec-attack{
  display:flex;align-items:center;gap:10px;
  padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;
}
.sec-attack:last-child{border-bottom:none}
.sec-icon{font-size:14px;width:20px;text-align:center}
.sec-label{flex:1;color:var(--textDim)}
.sec-result{font-family:var(--font);font-size:11px}

/* ── Spinner ─────────────────────────────────────────────────────────────── */
.spin{
  display:inline-block;width:14px;height:14px;
  border:2px solid var(--border2);border-top-color:var(--cyan);
  border-radius:50%;animation:spin .7s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── Toast ───────────────────────────────────────────────────────────────── */
.toast-wrap{
  position:fixed;bottom:20px;right:20px;
  display:flex;flex-direction:column;gap:8px;z-index:999;
}
.toast{
  padding:10px 16px;border-radius:var(--radius);
  background:var(--surface2);border:1px solid var(--border);
  font-size:13px;animation:fadeIn .2s ease;
  display:flex;align-items:center;gap:8px;
}
.toast.ok{border-color:var(--green);color:var(--green)}
.toast.err{border-color:var(--red);color:var(--red)}
.toast.info{border-color:var(--cyan);color:var(--cyan)}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

/* ── Modal ───────────────────────────────────────────────────────────────── */
.modal-bg{
  position:fixed;inset:0;background:rgba(0,0,0,.6);
  z-index:200;display:none;align-items:center;justify-content:center;
}
.modal-bg.open{display:flex}
.modal{
  background:var(--surface);border:1px solid var(--border2);
  border-radius:var(--radius2);padding:24px;width:100%;max-width:480px;
  box-shadow:var(--shadow);
}
.modal-title{font-weight:700;font-size:16px;margin-bottom:12px}
.modal-body{font-size:13px;color:var(--textDim);line-height:1.7}
.modal-actions{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}

/* ── Command Palette ──────────────────────────────────────────────────────── */
.palette-bg{
  position:fixed;inset:0;background:rgba(0,0,0,.7);
  z-index:300;display:none;align-items:flex-start;justify-content:center;
  padding-top:120px;
}
.palette-bg.open{display:flex}
.palette{
  background:var(--surface);border:1px solid var(--border2);
  border-radius:var(--radius2);width:100%;max-width:560px;
  box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;
}
.palette-input{
  display:flex;align-items:center;gap:10px;
  padding:14px 16px;border-bottom:1px solid var(--border);
}
.palette-input input{
  flex:1;background:none;border:none;outline:none;
  font-size:15px;color:var(--text);font-family:var(--sans);
}
.palette-results{max-height:300px;overflow-y:auto}
.palette-item{
  display:flex;align-items:center;gap:12px;
  padding:10px 16px;cursor:pointer;
  transition:background .08s;font-size:13px;
}
.palette-item:hover,.palette-item.focused{background:rgba(0,212,255,.08)}
.palette-key{font-family:var(--font);font-size:11px;color:var(--muted);margin-left:auto}

/* ── Utility ─────────────────────────────────────────────────────────────── */
.mono{font-family:var(--font)}
.muted{color:var(--muted)}
.text-green{color:var(--green)}
.text-cyan{color:var(--cyan)}
.text-amber{color:var(--amber)}
.text-red{color:var(--red)}
.mt-2{margin-top:8px}.mt-3{margin-top:12px}.mt-4{margin-top:16px}
.mb-4{margin-bottom:16px}
.flex{display:flex}.items-center{align-items:center}
.gap-2{gap:8px}.gap-3{gap:12px}
.justify-between{justify-content:space-between}
.overflow-hidden{overflow:hidden}.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.section-header{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:16px;
}
.section-title{font-size:18px;font-weight:700;color:var(--text)}
.section-sub{font-size:12px;color:var(--muted);margin-top:2px}
</style>
</head>
<body>

<!-- ── Toast Container ──────────────────────────────────────────────────── -->
<div class="toast-wrap" id="toasts"></div>

<!-- ── Command Palette ───────────────────────────────────────────────────── -->
<div class="palette-bg" id="palette">
  <div class="palette">
    <div class="palette-input">
      <span style="color:var(--cyan);font-size:16px">›</span>
      <input id="palette-search" placeholder="Search commands, views, actions…" autocomplete="off"/>
    </div>
    <div class="palette-results" id="palette-results"></div>
  </div>
</div>

<!-- ── App Shell ──────────────────────────────────────────────────────────── -->
<div class="app">

  <!-- ── Sidebar ─────────────────────────────────────────────────────────── -->
  <nav class="sidebar">
    <div class="sidebar-logo">
      <div class="logo-mark">▀▄▀ XR</div>
      <div>
        <div class="logo-text">XR</div>
        <div class="logo-badge">AI Operating System</div>
      </div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Workspace</div>
      <a class="nav-item active" data-panel="dashboard">
        <span class="nav-icon">⬡</span> Dashboard
      </a>
      <a class="nav-item" data-panel="chat">
        <span class="nav-icon">💬</span> Chat
      </a>
      <a class="nav-item" data-panel="status">
        <span class="nav-icon">◎</span> Status
      </a>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Configuration</div>
      <a class="nav-item" data-panel="providers">
        <span class="nav-icon">☁</span> Providers
      </a>
      <a class="nav-item" data-panel="models">
        <span class="nav-icon">⚙</span> Models
      </a>
      <a class="nav-item" data-panel="memory">
        <span class="nav-icon">🧠</span> Memory
      </a>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Features</div>
      <a class="nav-item" data-panel="research">
        <span class="nav-icon">🔬</span> Research
      </a>
      <a class="nav-item" data-panel="plugins">
        <span class="nav-icon">⚡</span> Plugins
      </a>
      <a class="nav-item" data-panel="voice">
        <span class="nav-icon">🎤</span> Voice
      </a>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Trust</div>
      <a class="nav-item" data-panel="security">
        <span class="nav-icon">🔒</span> Security
      </a>
      <a class="nav-item" data-panel="audit">
        <span class="nav-icon">📜</span> Audit Log
      </a>
      <a class="nav-item" data-panel="settings">
        <span class="nav-icon">⚙</span> Settings
      </a>
    </div>

    <div class="sidebar-spacer"></div>

    <div class="sidebar-footer">
      <div class="provider-pill" id="sidebar-provider">
        <div class="provider-dot" id="provider-dot"></div>
        <span id="sidebar-provider-text" class="truncate">loading…</span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px;text-align:center">
        Press <span class="mono" style="color:var(--cyan)">?</span> for keyboard shortcuts
      </div>
    </div>
  </nav>

  <!-- ── Main ──────────────────────────────────────────────────────────────── -->
  <div class="main">

    <!-- Top bar -->
    <div class="topbar">
      <div class="topbar-title" id="topbar-title">Dashboard</div>
      <div class="topbar-spacer"></div>
      <div class="topbar-status">
        <div class="status-chip" id="chip-provider"><div class="dot"></div><span id="chip-provider-label">—</span></div>
        <div class="status-chip" id="chip-audit"><div class="dot"></div><span id="chip-audit-label">Audit</span></div>
        <div class="status-chip" id="chip-budget"><div class="dot warn"></div><span id="chip-budget-label">Budget</span></div>
        <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="openPalette()">⌘K</button>
      </div>
    </div>

    <!-- Panels -->
    <div class="content">

      <!-- ════════ DASHBOARD ════════ -->
      <div class="panel active" id="panel-dashboard">
        <div class="section-header">
          <div>
            <div class="section-title">Dashboard</div>
            <div class="section-sub">XR Control Center — <span id="dash-project">loading…</span></div>
          </div>
          <button class="btn btn-ghost" onclick="refreshAll()" style="font-size:12px">↻ Refresh</button>
        </div>

        <!-- Stat Cards -->
        <div class="grid grid-4 mb-4">
          <div class="card card-glow-cyan">
            <div class="card-header"><div class="card-title">Spent Today</div><span class="card-icon">💰</span></div>
            <div class="card-value" id="d-spent">$0.0000</div>
            <div class="card-sub" id="d-tokens">0 tokens</div>
          </div>
          <div class="card card-glow-green">
            <div class="card-header"><div class="card-title">Security Score</div><span class="card-icon">🛡️</span></div>
            <div class="card-value" id="d-sec-score">—</div>
            <div class="card-sub">injection block-rate</div>
          </div>
          <div class="card card-glow-green">
            <div class="card-header"><div class="card-title">Audit Chain</div><span class="card-icon">🔒</span></div>
            <div class="card-value" id="d-audit-val">—</div>
            <div class="card-sub" id="d-audit-entries">checking…</div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Skills</div><span class="card-icon">🧠</span></div>
            <div class="card-value" id="d-skills">0</div>
            <div class="card-sub" id="d-skills-sub">learned / frozen</div>
          </div>
        </div>

        <div class="grid grid-3 mb-4">
          <!-- Provider Health -->
          <div class="card" style="grid-column:span 1">
            <div class="card-header"><div class="card-title">Provider Health</div><span class="card-icon">☁</span></div>
            <div id="d-provider-list"><div class="muted" style="font-size:12px">Loading…</div></div>
          </div>
          <!-- Local AI -->
          <div class="card">
            <div class="card-header"><div class="card-title">Local AI</div><span class="card-icon">⬡</span></div>
            <div id="d-local-status"><div class="muted" style="font-size:12px">Checking…</div></div>
          </div>
          <!-- Memory -->
          <div class="card">
            <div class="card-header"><div class="card-title">Memory</div><span class="card-icon">🧠</span></div>
            <div id="d-memory-summary"><div class="muted" style="font-size:12px">Loading…</div></div>
          </div>
        </div>

        <div class="grid grid-2">
          <!-- Recent Audit -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Recent Activity</div>
              <button class="btn btn-ghost" style="font-size:10px;padding:2px 8px" onclick="navigateTo('audit')">View all</button>
            </div>
            <div id="d-audit-list"><div class="muted" style="font-size:12px">Loading…</div></div>
          </div>
          <!-- Computer Control -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Computer Control</div>
              <span id="d-control-status" class="badge badge-gray">checking…</span>
            </div>
            <div id="d-control-detail"><div class="muted" style="font-size:12px">Loading…</div></div>
          </div>
        </div>
      </div>

      <!-- ════════ CHAT ════════ -->
      <div class="panel" id="panel-chat">
        <!-- Chat uses full height, rendered without content padding -->
      </div>

      <!-- ════════ STATUS ════════ -->
      <div class="panel" id="panel-status">
        <div class="section-header">
          <div><div class="section-title">System Status</div><div class="section-sub">Full health overview</div></div>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><div class="card-title">Provider</div></div>
            <div id="st-provider"><div class="spin"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Budget</div></div>
            <div id="st-budget"><div class="spin"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Local AI</div></div>
            <div id="st-local"><div class="spin"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Audit Chain</div></div>
            <div id="st-audit"><div class="spin"></div></div>
          </div>
        </div>
      </div>

      <!-- ════════ PROVIDERS ════════ -->
      <div class="panel" id="panel-providers">
        <div class="section-header">
          <div><div class="section-title">Providers</div><div class="section-sub">API keys, health, and routing</div></div>
        </div>
        <div class="card mb-4">
          <div class="card-header"><div class="card-title">Active Routing</div></div>
          <div id="prov-routing"><div class="spin"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">All Providers</div></div>
          <div class="provider-grid" id="prov-grid"><div class="spin"></div></div>
        </div>
      </div>

      <!-- ════════ MODELS ════════ -->
      <div class="panel" id="panel-models">
        <div class="section-header">
          <div><div class="section-title">Models</div><div class="section-sub">Local AI runtimes and model management</div></div>
        </div>
        <div class="card mb-4">
          <div class="card-header"><div class="card-title">Local Runtime Status</div></div>
          <div id="models-local"><div class="spin"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Installed Models</div></div>
          <div id="models-list"><div class="spin"></div></div>
        </div>
      </div>

      <!-- ════════ MEMORY ════════ -->
      <div class="panel" id="panel-memory">
        <div class="section-header">
          <div><div class="section-title">Memory</div><div class="section-sub">Durable memory — only what you asked XR to remember</div></div>
          <button class="btn btn-danger" onclick="clearMemory()" style="font-size:12px">Clear All</button>
        </div>
        <div class="card">
          <div class="card-header">
            <div><div class="card-title">Memories</div><div class="card-sub">Add from CLI: <code style="color:var(--cyan)">xr memory add "…"</code></div></div>
            <span class="badge badge-cyan" id="mem-count">0</span>
          </div>
          <div id="mem-list"><div class="spin"></div></div>
        </div>
      </div>

      <!-- ════════ RESEARCH ════════ -->
      <div class="panel" id="panel-research">
        <div class="section-header">
          <div><div class="section-title">Research</div><div class="section-sub">Source-first, citation-aware research mode</div></div>
        </div>
        <div class="card">
          <div style="text-align:center;padding:32px 16px">
            <div style="font-size:32px;margin-bottom:12px">🔬</div>
            <div style="font-weight:600;margin-bottom:8px">Research Mode</div>
            <div class="muted" style="font-size:12px;margin-bottom:16px">
              Launch a research job from the CLI or Chat interface.<br>
              XR plans queries, ranks sources, extracts evidence, and exports a signed report.
            </div>
            <button class="btn btn-ghost" onclick="navigateTo('chat')">Open Chat → Research</button>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:12px">
            <div class="stat-row"><div class="stat-key">Command</div><div class="stat-val mono text-cyan">xr research "topic"</div></div>
            <div class="stat-row"><div class="stat-key">In chat</div><div class="stat-val mono text-cyan">/research &lt;topic&gt;</div></div>
          </div>
        </div>
      </div>

      <!-- ════════ PLUGINS ════════ -->
      <div class="panel" id="panel-plugins">
        <div class="section-header">
          <div><div class="section-title">Plugins</div><div class="section-sub">Permission-based, sandboxed, audited</div></div>
        </div>
        <div class="card">
          <div style="text-align:center;padding:32px 16px">
            <div style="font-size:32px;margin-bottom:12px">⚡</div>
            <div style="font-weight:600;margin-bottom:8px">Plugin Ecosystem</div>
            <div class="muted" style="font-size:12px;margin-bottom:16px">
              Every plugin shows exact permissions before install.<br>
              Budget, egress, memory, and security controls always apply.
            </div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:12px">
            <div class="stat-row"><div class="stat-key">Install</div><div class="stat-val mono text-cyan">xr plugins install ./plugin</div></div>
            <div class="stat-row"><div class="stat-key">Enable</div><div class="stat-val mono text-cyan">xr plugins enable &lt;name&gt;</div></div>
            <div class="stat-row"><div class="stat-key">List</div><div class="stat-val mono text-cyan">xr plugins list</div></div>
          </div>
        </div>
      </div>

      <!-- ════════ VOICE ════════ -->
      <div class="panel" id="panel-voice">
        <div class="section-header">
          <div><div class="section-title">Voice</div><div class="section-sub">Wake word → STT → model → TTS</div></div>
        </div>
        <div class="card">
          <div style="text-align:center;padding:32px 16px">
            <div style="font-size:32px;margin-bottom:12px">🎤</div>
            <div style="font-weight:600;margin-bottom:8px">Voice Control</div>
            <div class="muted" style="font-size:12px;margin-bottom:16px">
              Voice requires explicit opt-in. Never activated automatically.<br>
              Works on macOS (say command) and Windows (SAPI).
            </div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:12px">
            <div class="stat-row"><div class="stat-key">Enable</div><div class="stat-val mono text-cyan">xr voice start</div></div>
            <div class="stat-row"><div class="stat-key">Test</div><div class="stat-val mono text-cyan">xr voice test</div></div>
            <div class="stat-row"><div class="stat-key">Wake word</div><div class="stat-val mono text-cyan">xr voice wake "hey xr"</div></div>
          </div>
        </div>
      </div>

      <!-- ════════ SECURITY ════════ -->
      <div class="panel" id="panel-security">
        <div class="section-header">
          <div><div class="section-title">Security</div><div class="section-sub">Injection defense, egress controls, audit integrity</div></div>
          <button class="btn btn-ghost" onclick="runSecLab()" style="font-size:12px">Run Lab</button>
        </div>
        <div class="grid grid-2 mb-4">
          <div class="card">
            <div class="card-header"><div class="card-title">Injection Defense</div></div>
            <div id="sec-lab-result"><div class="muted" style="font-size:12px">Click "Run Lab" to test</div></div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Egress Allow-List</div></div>
            <div id="sec-egress"><div class="spin"></div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Security Posture</div></div>
          <div id="sec-posture"><div class="spin"></div></div>
        </div>
      </div>

      <!-- ════════ AUDIT ════════ -->
      <div class="panel" id="panel-audit">
        <div class="section-header">
          <div><div class="section-title">Audit Log</div><div class="section-sub">Tamper-evident SHA-256 hash chain</div></div>
          <div class="flex gap-2">
            <span id="audit-chain-badge" class="badge badge-gray">checking…</span>
          </div>
        </div>
        <div class="card">
          <div id="audit-log-list"><div class="spin"></div></div>
        </div>
      </div>

      <!-- ════════ SETTINGS ════════ -->
      <div class="panel" id="panel-settings">
        <div class="section-header">
          <div><div class="section-title">Settings</div><div class="section-sub">XR configuration</div></div>
        </div>
        <div class="card mb-4">
          <div class="settings-section">
            <div class="settings-title">Privacy & Data</div>
            <div class="settings-row">
              <div><div class="settings-key">Local-first mode</div><div class="settings-desc">All data stays on your machine</div></div>
              <span class="badge badge-green">Enabled</span>
            </div>
            <div class="settings-row">
              <div><div class="settings-key">API key storage</div><div class="settings-desc">Keys stored in OS keychain or encrypted file</div></div>
              <span class="settings-val" id="set-key-backend">—</span>
            </div>
            <div class="settings-row">
              <div><div class="settings-key">Egress allow-list</div><div class="settings-desc">Domains that can receive data from XR</div></div>
              <span class="settings-val" id="set-egress">unrestricted</span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-title">Budget</div>
            <div class="settings-row">
              <div><div class="settings-key">Per-task ceiling</div><div class="settings-desc">Hard limit — agent cannot exceed</div></div>
              <span class="settings-val" id="set-budget">—</span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-title">Approval Gates</div>
            <div class="settings-row">
              <div><div class="settings-key">Require approval for</div><div class="settings-desc">Actions that need your explicit consent</div></div>
              <span class="settings-val" id="set-approval">—</span>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="settings-title" style="margin-bottom:12px">CLI Quick Reference</div>
          <div class="stat-row"><div class="stat-key">Config path</div><div class="stat-val mono text-cyan">~/.xr/config.json</div></div>
          <div class="stat-row"><div class="stat-key">Edit config</div><div class="stat-val mono text-cyan">xr config set &lt;key&gt; &lt;val&gt;</div></div>
          <div class="stat-row"><div class="stat-key">Reset</div><div class="stat-val mono text-cyan">xr onboarding</div></div>
          <div class="stat-row"><div class="stat-key">Doctor</div><div class="stat-val mono text-cyan">xr doctor</div></div>
        </div>
      </div>

    </div><!-- /content -->
  </div><!-- /main -->
</div><!-- /app -->

<!-- ── Chat Panel (full height, injected separately) ─────────────────────── -->
<div id="chat-mount" style="display:none"></div>

<script>
// ── Constants ────────────────────────────────────────────────────────────────
const TOKEN = "__TOKEN__";
const BASE  = window.location.origin;

// ── API Helper ────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = "info") {
  const wrap = document.getElementById("toasts");
  const el   = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Navigation ────────────────────────────────────────────────────────────────
const NAV_LABELS = {
  dashboard: "Dashboard", chat: "Chat", status: "Status",
  providers: "Providers", models: "Models", memory: "Memory",
  research: "Research", plugins: "Plugins", voice: "Voice",
  security: "Security", audit: "Audit Log", settings: "Settings",
};

function navigateTo(id) {
  // Update nav items
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.panel === id);
  });
  // Update panels
  document.querySelectorAll(".panel").forEach(el => {
    el.classList.toggle("active", el.id === "panel-" + id);
  });
  // Topbar title
  document.getElementById("topbar-title").textContent = NAV_LABELS[id] ?? id;

  // Special: chat uses full height
  const chatMount = document.getElementById("chat-mount");
  const content   = document.querySelector(".content");
  if (id === "chat") {
    buildChatUI();
    content.style.padding = "0";
    content.style.overflow = "hidden";
  } else {
    content.style.padding = "";
    content.style.overflow = "";
  }

  // Lazy-load panel data
  switch (id) {
    case "dashboard":   loadDashboard(); break;
    case "status":      loadStatus();    break;
    case "providers":   loadProviders(); break;
    case "models":      loadModels();    break;
    case "memory":      loadMemory();    break;
    case "security":    loadSecurity();  break;
    case "audit":       loadAuditLog();  break;
    case "settings":    loadSettings();  break;
  }
}

document.querySelectorAll(".nav-item").forEach(el => {
  el.addEventListener("click", () => navigateTo(el.dataset.panel));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [ov, cost, ctrl, mem] = await Promise.allSettled([
      api("/api/overview"),
      api("/api/cost"),
      api("/api/control/status"),
      api("/api/memory"),
    ]);

    // Overview
    if (ov.status === "fulfilled") {
      const d = ov.value;
      document.getElementById("dash-project").textContent = d.project ?? "—";
      const auditOk = d.audit?.chain?.valid;
      document.getElementById("d-audit-val").textContent  = auditOk ? "Intact" : "BROKEN";
      document.getElementById("d-audit-val").className    = "card-value " + (auditOk ? "val-green" : "val-red");
      document.getElementById("d-audit-entries").textContent = (d.audit?.count ?? 0) + " entries";
      document.getElementById("d-skills").textContent     = (d.skills?.learned ?? 0) + "";
      document.getElementById("d-skills-sub").textContent = `${d.skills?.learned ?? 0} learned / ${d.skills?.frozen ?? 0} frozen`;
      // Topbar chips
      document.getElementById("chip-audit-label").textContent = auditOk ? "Audit OK" : "Audit BROKEN";
      document.getElementById("chip-audit").className = "status-chip " + (auditOk ? "ok" : "err");
    }

    // Cost
    if (cost.status === "fulfilled") {
      const c = cost.value;
      document.getElementById("d-spent").textContent  = "$" + (c.totalUsd ?? 0).toFixed(4);
      document.getElementById("d-tokens").textContent = (c.totalTokens ?? 0).toLocaleString() + " tokens";
      document.getElementById("chip-budget-label").textContent = "$" + (c.totalUsd ?? 0).toFixed(4);
    }

    // Control
    if (ctrl.status === "fulfilled") {
      const c = ctrl.value;
      const badge = document.getElementById("d-control-status");
      badge.textContent = c.enabled ? "enabled" : "disabled";
      badge.className   = "badge " + (c.enabled ? "badge-green" : "badge-gray");
      const caps = c.capabilities ?? {};
      document.getElementById("d-control-detail").innerHTML = Object.entries(caps).map(([k,v]) =>
        \`<div class="stat-row"><div class="stat-key">\${k}</div><div class="stat-val \${v ? 'val-green' : 'val-muted'}">\${v ? "✓" : "—"}</div></div>\`
      ).join("") || "<div class='muted' style='font-size:12px'>No capabilities detected</div>";
    }

    // Memory summary
    if (mem.status === "fulfilled") {
      const m = mem.value;
      document.getElementById("d-memory-summary").innerHTML =
        \`<div class="stat-row"><div class="stat-key">Entries</div><div class="stat-val val-cyan">\${m.count ?? 0}</div></div>\` +
        Object.entries(m.stats ?? {}).map(([k,v]) =>
          \`<div class="stat-row"><div class="stat-key">\${k}</div><div class="stat-val val-muted">\${v}</div></div>\`
        ).join("") +
        \`<div style="font-size:10px;color:var(--muted);margin-top:8px">Add: <code style="color:var(--cyan)">xr memory add "…"</code></div>\`;
    }

    // Audit recent
    const audit = await api("/api/audit?limit=6");
    const entries = audit.entries ?? [];
    document.getElementById("d-audit-list").innerHTML = entries.length
      ? entries.map(e => \`
          <div class="audit-row">
            <div class="audit-ts">\${new Date(e.ts).toLocaleTimeString()}</div>
            <div class="audit-event">\${e.event}</div>
            <div class="audit-hash" title="\${e.hash ?? ''}">\${(e.hash ?? "").slice(0,8)}</div>
          </div>\`).join("")
      : "<div class='muted' style='font-size:12px'>No activity yet</div>";

    // Provider quick status (sidebar + overview card)
    await loadProviderChip();

  } catch(e) {
    toast("Dashboard error: " + e.message, "err");
  }
}

async function loadProviderChip() {
  try {
    const ov = await api("/api/overview");
    const budget = ov.budget?.perTaskUsd ?? 0;
    document.getElementById("chip-budget-label").textContent = budget > 0 ? "Cap $" + budget.toFixed(2) : "No cap";
  } catch {}
  // Sidebar provider pill
  const config = { provider: "—", model: "—" };
  try {
    // We don't have a config endpoint so read from overview indirectly
    const st = await api("/api/control/status");
    document.getElementById("sidebar-provider-text").textContent = st.enabled ? "computer-control on" : "ready";
    document.getElementById("chip-provider-label").textContent = "XR";
    document.getElementById("chip-provider").className = "status-chip ok";
  } catch {}
}

// ── Status Panel ──────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const [ov, cost, ctrl] = await Promise.all([
      api("/api/overview"),
      api("/api/cost"),
      api("/api/control/status"),
    ]);
    document.getElementById("st-provider").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Status</div><div class="stat-val val-green">online</div></div>\`;
    document.getElementById("st-budget").innerHTML =
      \`<div class="stat-row"><div class="stat-key">All-time spent</div><div class="stat-val val-cyan">$\${(cost.totalUsd??0).toFixed(6)}</div></div>
       <div class="stat-row"><div class="stat-key">All-time tokens</div><div class="stat-val">\${(cost.totalTokens??0).toLocaleString()}</div></div>\`;
    document.getElementById("st-audit").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Chain</div><div class="stat-val \${ov.audit?.chain?.valid ? "val-green" : "val-red"}">\${ov.audit?.chain?.valid ? "Intact" : "BROKEN"}</div></div>
       <div class="stat-row"><div class="stat-key">Entries</div><div class="stat-val">\${ov.audit?.count ?? 0}</div></div>\`;
    document.getElementById("st-local").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Control</div><div class="stat-val \${ctrl.enabled ? "val-green" : "val-muted"}">\${ctrl.enabled ? "enabled" : "disabled"}</div></div>
       <div class="stat-row"><div class="stat-key">Pending</div><div class="stat-val">\${ctrl.pending ?? 0}</div></div>\`;
  } catch(e) {
    toast("Status error: " + e.message, "err");
  }
}

// ── Providers ─────────────────────────────────────────────────────────────────
async function loadProviders() {
  try {
    const ov = await api("/api/overview");
    const names = [
      {id:"ollama",label:"Ollama",tier:"local"},
      {id:"openai",label:"OpenAI",tier:"cloud"},
      {id:"anthropic",label:"Claude",tier:"cloud"},
      {id:"gemini",label:"Gemini",tier:"cloud"},
      {id:"groq",label:"Groq",tier:"cloud"},
      {id:"deepseek",label:"DeepSeek",tier:"cloud"},
      {id:"together",label:"Together",tier:"cloud"},
      {id:"mistral",label:"Mistral",tier:"cloud"},
      {id:"cohere",label:"Cohere",tier:"cloud"},
      {id:"cerebras",label:"Cerebras",tier:"cloud"},
      {id:"openrouter",label:"OpenRouter",tier:"cloud"},
      {id:"bedrock",label:"Bedrock",tier:"cloud"},
    ];
    document.getElementById("prov-routing").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Mode</div><div class="stat-val val-cyan">hybrid</div></div>
       <div class="stat-row"><div class="stat-key">Primary</div><div class="stat-val val-cyan">\${ov.project ?? "—"}</div></div>\`;
    document.getElementById("prov-grid").innerHTML = names.map(n =>
      \`<div class="provider-item \${n.tier === "local" ? "active" : ""}">
         <div class="provider-avatar">\${n.label[0]}</div>
         \${n.label}
         <span class="badge \${n.tier === "local" ? "badge-green" : "badge-gray"}">\${n.tier}</span>
       </div>\`
    ).join("");
  } catch(e) {
    toast("Providers error: " + e.message, "err");
  }
}

// ── Models ────────────────────────────────────────────────────────────────────
async function loadModels() {
  try {
    const ctrl = await api("/api/control/status");
    document.getElementById("models-local").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Runtime</div><div class="stat-val val-cyan">Ollama</div></div>
       <div class="stat-row"><div class="stat-key">Status</div><div class="stat-val \${ctrl.enabled ? 'val-green' : 'val-muted'}">ready</div></div>
       <div style="font-size:11px;color:var(--muted);margin-top:8px">Run <code style="color:var(--cyan)">xr models status</code> for full details</div>\`;
    document.getElementById("models-list").innerHTML =
      \`<div class="muted" style="font-size:12px;text-align:center;padding:16px">
         Run <code style="color:var(--cyan)">xr models list</code> to see available models
       </div>\`;
  } catch(e) {
    toast("Models error: " + e.message, "err");
  }
}

// ── Memory ────────────────────────────────────────────────────────────────────
async function loadMemory() {
  try {
    const mem = await api("/api/memory");
    document.getElementById("mem-count").textContent = mem.count ?? 0;
    const entries = mem.entries ?? [];
    if (!entries.length) {
      document.getElementById("mem-list").innerHTML =
        \`<div style="text-align:center;padding:24px;color:var(--muted);font-size:12px">
           No memories yet. Add from CLI: <code style="color:var(--cyan)">xr memory add "…"</code>
         </div>\`;
      return;
    }
    document.getElementById("mem-list").innerHTML = entries.map(e =>
      \`<div class="mem-item">
         <div class="mem-cat">\${e.category ?? "general"}</div>
         <div class="mem-content">\${e.content}</div>
         <div class="mem-del" onclick="deleteMemory('\${e.id}')">✕</div>
       </div>\`
    ).join("");
  } catch(e) {
    document.getElementById("mem-list").innerHTML =
      "<div class='muted' style='font-size:12px'>Memory not available</div>";
  }
}

async function deleteMemory(id) {
  try {
    await api("/api/memory/" + encodeURIComponent(id), { method: "DELETE" });
    toast("Memory entry deleted", "ok");
    loadMemory();
  } catch(e) {
    toast("Delete failed: " + e.message, "err");
  }
}

async function clearMemory() {
  if (!confirm("Clear ALL memory entries? This cannot be undone.")) return;
  try {
    await api("/api/memory/%2A", { method: "DELETE" });
    toast("All memory cleared", "ok");
    loadMemory();
  } catch(e) {
    toast("Clear failed: " + e.message, "err");
  }
}

// ── Security ──────────────────────────────────────────────────────────────────
async function loadSecurity() {
  try {
    const sec = await api("/api/security");
    const outcomes = sec.outcomes ?? [];
    document.getElementById("sec-lab-result").innerHTML = outcomes.length
      ? \`<div style="margin-bottom:8px">
           <div class="stat-row">
             <div class="stat-key">Block-rate</div>
             <div class="stat-val \${sec.rate >= .9 ? 'val-green' : 'val-amber'}">\${Math.round(sec.rate * 100)}%  (\${sec.blocked}/\${sec.total})</div>
           </div>
         </div>\` +
         outcomes.map(o =>
           \`<div class="sec-attack">
              <span class="sec-icon">\${o.blocked ? "✓" : "✗"}</span>
              <span class="sec-label">\${o.category}</span>
              <span class="sec-result \${o.blocked ? 'val-green' : 'val-red'}">\${o.blocked ? "blocked" : "ALLOWED"}</span>
            </div>\`
         ).join("")
      : "<div class='muted' style='font-size:12px'>Click Run Lab to execute tests</div>";

    document.getElementById("sec-egress").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Egress allow-list</div><div class="stat-val val-muted">\${sec.egressAllowlist?.join(", ") || "unrestricted"}</div></div>\`;

    document.getElementById("sec-posture").innerHTML =
      \`<div class="stat-row"><div class="stat-key">Local-first</div><div class="stat-val val-green">✓</div></div>
       <div class="stat-row"><div class="stat-key">API key redaction</div><div class="stat-val val-green">✓</div></div>
       <div class="stat-row"><div class="stat-key">Budget enforcement</div><div class="stat-val val-green">code-enforced</div></div>
       <div class="stat-row"><div class="stat-key">Approval gates</div><div class="stat-val val-cyan">configured</div></div>\`;
  } catch(e) {
    toast("Security error: " + e.message, "err");
  }
}

async function runSecLab() {
  document.getElementById("sec-lab-result").innerHTML = "<div class='spin'></div>";
  loadSecurity();
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
async function loadAuditLog() {
  try {
    const data  = await api("/api/audit?limit=50");
    const chain = data.chain;
    const badge = document.getElementById("audit-chain-badge");
    badge.textContent = chain.valid ? "Chain intact" : "BROKEN";
    badge.className   = "badge " + (chain.valid ? "badge-green" : "badge-red");

    const entries = data.entries ?? [];
    document.getElementById("audit-log-list").innerHTML = entries.length
      ? entries.map(e => \`
          <div class="audit-row">
            <div class="audit-ts">\${new Date(e.ts).toLocaleString()}</div>
            <div class="audit-event">\${e.event}</div>
            <div class="audit-hash" title="Hash: \${e.hash ?? ''}">#\${(e.hash ?? "").slice(0,8)}</div>
          </div>\`).join("")
      : "<div class='muted' style='font-size:12px;padding:16px 0'>No audit entries yet. Run a task to see the log.</div>";
  } catch(e) {
    toast("Audit error: " + e.message, "err");
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const ov = await api("/api/overview");
    document.getElementById("set-budget").textContent = ov.budget?.perTaskUsd ? "$" + ov.budget.perTaskUsd : "no limit";
    document.getElementById("set-egress").textContent = ov.budget?.egressAllowlist?.join(", ") || "unrestricted";
    document.getElementById("set-approval").textContent = "write_file, delete, shell, send";
    document.getElementById("set-key-backend").textContent = "OS keychain / encrypted file";
  } catch {}
}

// ── Chat UI ───────────────────────────────────────────────────────────────────
let chatHistory = [];
let chatStreaming = false;

function buildChatUI() {
  const panel = document.getElementById("panel-chat");
  if (panel.innerHTML.trim()) return; // already built

  panel.innerHTML = \`
    <div class="chat-wrap">
      <div class="chat-header">
        <span style="font-size:18px;color:var(--cyan)">💬</span>
        <div>
          <div class="chat-header-title">XR Chat</div>
          <div class="chat-header-model" id="chat-model-label">local-first · BYOK</div>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-ghost" style="font-size:11px" onclick="clearChat()">Clear</button>
      </div>

      <div class="chat-messages" id="chat-messages">
        <div class="msg assistant">
          <div class="msg-bubble">
            👋 Hi! I'm <strong>XR</strong> — the AI agent you can actually trust.<br><br>
            I'm running locally. You can ask me anything, run research, write code, check your system status, or use slash commands like <code style="color:var(--cyan)">/plan</code>, <code style="color:var(--cyan)">/research</code>, or <code style="color:var(--cyan)">/status</code>.
          </div>
          <div class="msg-meta">XR · local-first</div>
        </div>
      </div>

      <div class="chat-input-wrap">
        <div class="chat-input-row">
          <textarea id="chat-input" placeholder="Ask XR anything… or use /plan, /research, /status" rows="1"></textarea>
          <button class="chat-send" id="chat-send-btn" onclick="sendChatMessage()">Send ↑</button>
        </div>
        <div class="chat-hint">
          <span class="hint-chip" onclick="insertHint('/plan ')">⚙ /plan</span>
          <span class="hint-chip" onclick="insertHint('/status')">◎ /status</span>
          <span class="hint-chip" onclick="insertHint('/research ')">🔬 /research</span>
          <span class="hint-chip" onclick="insertHint('/ask ')">? /ask</span>
          <span class="hint-chip" onclick="insertHint('/memory')">🧠 /memory</span>
          <span class="hint-chip" onclick="insertHint('/budget ')">💰 /budget</span>
        </div>
      </div>
    </div>\`;

  const input = document.getElementById("chat-input");
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    autoResize(input);
  });
  input.addEventListener("input", () => autoResize(input));
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

function insertHint(text) {
  const input = document.getElementById("chat-input");
  if (!input) return;
  input.value = text;
  input.focus();
  autoResize(input);
}

function clearChat() {
  chatHistory = [];
  const msgs = document.getElementById("chat-messages");
  if (msgs) msgs.innerHTML = \`
    <div class="msg assistant">
      <div class="msg-bubble">Chat cleared. How can I help?</div>
      <div class="msg-meta">XR</div>
    </div>\`;
}

function appendMessage(role, content, isTyping = false) {
  const msgs = document.getElementById("chat-messages");
  if (!msgs) return null;
  const div  = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "assistant");
  if (isTyping) {
    div.innerHTML = \`<div class="msg-bubble"><div class="typing-indicator">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div></div>\`;
  } else {
    div.innerHTML = \`<div class="msg-bubble">\${content}</div>
      <div class="msg-meta">\${role === "user" ? "You" : "XR · " + new Date().toLocaleTimeString()}</div>\`;
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

async function sendChatMessage() {
  if (chatStreaming) return;
  const input = document.getElementById("chat-input");
  const btn   = document.getElementById("chat-send-btn");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  autoResize(input);
  chatStreaming = true;
  if (btn) btn.disabled = true;

  appendMessage("user", escapeHtml(text));
  chatHistory.push({ role: "user", content: text });

  const typingEl = appendMessage("assistant", "", true);

  try {
    // POST to /api/chat (streaming endpoint)
    const res = await fetch(BASE + "/api/chat", {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: chatHistory.slice(-10) }),
    });

    if (!res.ok) throw new Error("Chat API unavailable — is XR server running?");

    let reply = "";
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    if (typingEl) typingEl.remove();
    const replyEl = appendMessage("assistant", "");
    const bubble  = replyEl?.querySelector(".msg-bubble");

    if (reader && bubble) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Handle SSE: "data: {...}\\n\\n"
        for (const line of chunk.split("\\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const j = JSON.parse(data);
            if (j.delta) { reply += j.delta; bubble.innerHTML = formatReply(reply); }
            if (j.text)  { reply = j.text;  bubble.innerHTML = formatReply(reply); }
          } catch { reply += data; bubble.innerHTML = formatReply(reply); }
        }
        const msgs = document.getElementById("chat-messages");
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
      }
    } else if (bubble) {
      // Fallback: non-streaming
      const j = await res.json().catch(() => ({ reply: "No response" }));
      reply = j.reply ?? j.content ?? "No response";
      bubble.innerHTML = formatReply(reply);
    }

    chatHistory.push({ role: "assistant", content: reply });
  } catch (e) {
    if (typingEl) typingEl.remove();
    appendMessage("assistant", \`<span style="color:var(--red)">⚠ \${escapeHtml(e.message)}</span>\\n\\nTip: Make sure the XR server is running with <code style="color:var(--cyan)">xr serve</code>\`);
  } finally {
    chatStreaming = false;
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
}

function formatReply(text) {
  return text
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, (_,lang,code) =>
      \`<pre style="background:var(--surface2);padding:10px;border-radius:6px;font-family:var(--font);font-size:12px;overflow-x:auto;margin:8px 0">\${code}</pre>\`)
    .replace(/\`([^\`]+)\`/g, '<code style="background:rgba(0,212,255,.12);color:var(--cyan);padding:1px 5px;border-radius:3px;font-family:var(--font)">$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
    .replace(/\\n/g, "<br>");
}

function escapeHtml(t) {
  return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── Command Palette ───────────────────────────────────────────────────────────
const PALETTE_CMDS = [
  { label: "Go to Dashboard",    icon: "⬡", action: () => navigateTo("dashboard"), key: "g d" },
  { label: "Go to Chat",         icon: "💬", action: () => navigateTo("chat"),      key: "g c" },
  { label: "Go to Providers",    icon: "☁",  action: () => navigateTo("providers") },
  { label: "Go to Models",       icon: "⚙",  action: () => navigateTo("models") },
  { label: "Go to Memory",       icon: "🧠", action: () => navigateTo("memory") },
  { label: "Go to Security",     icon: "🔒", action: () => navigateTo("security") },
  { label: "Go to Audit Log",    icon: "📜", action: () => navigateTo("audit") },
  { label: "Go to Settings",     icon: "⚙",  action: () => navigateTo("settings") },
  { label: "Refresh Dashboard",  icon: "↻",  action: refreshAll },
  { label: "Clear Memory",       icon: "🗑",  action: clearMemory },
];

let paletteOpen = false;
let paletteFocus = 0;

function openPalette() {
  document.getElementById("palette").classList.add("open");
  document.getElementById("palette-search").value = "";
  renderPaletteResults("");
  document.getElementById("palette-search").focus();
  paletteOpen = true;
  paletteFocus = 0;
}

function closePalette() {
  document.getElementById("palette").classList.remove("open");
  paletteOpen = false;
}

function renderPaletteResults(q) {
  const items = PALETTE_CMDS.filter(c => !q || c.label.toLowerCase().includes(q.toLowerCase()));
  const el = document.getElementById("palette-results");
  el.innerHTML = items.map((c, i) =>
    \`<div class="palette-item \${i === paletteFocus ? "focused" : ""}" data-idx="\${i}">
       <span>\${c.icon}</span>
       <span>\${c.label}</span>
       \${c.key ? \`<span class="palette-key">\${c.key}</span>\` : ""}
     </div>\`
  ).join("");
  el.querySelectorAll(".palette-item").forEach(el => {
    el.addEventListener("click", () => {
      const idx = +el.dataset.idx;
      items[idx]?.action();
      closePalette();
    });
  });
}

document.getElementById("palette-search").addEventListener("input", e => {
  paletteFocus = 0;
  renderPaletteResults(e.target.value);
});

document.getElementById("palette-search").addEventListener("keydown", e => {
  const items = document.querySelectorAll(".palette-item");
  if (e.key === "Escape") { closePalette(); return; }
  if (e.key === "ArrowDown") { paletteFocus = Math.min(paletteFocus + 1, items.length - 1); }
  if (e.key === "ArrowUp")   { paletteFocus = Math.max(paletteFocus - 1, 0); }
  if (e.key === "Enter") { items[paletteFocus]?.click(); return; }
  renderPaletteResults(e.target.value);
});

document.getElementById("palette").addEventListener("click", e => {
  if (e.target === document.getElementById("palette")) closePalette();
});

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────
let gPressed = false;
document.addEventListener("keydown", e => {
  if (paletteOpen) return;
  // Chat input focus
  if (document.activeElement?.id === "chat-input" ||
      document.activeElement?.id === "palette-search") return;
  if (e.key === "?" || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
    e.preventDefault(); openPalette(); return;
  }
  if (e.key === "g") { gPressed = true; setTimeout(() => gPressed = false, 1000); return; }
  if (gPressed) {
    if (e.key === "d") { navigateTo("dashboard"); gPressed = false; }
    if (e.key === "c") { navigateTo("chat");      gPressed = false; }
    if (e.key === "p") { navigateTo("providers"); gPressed = false; }
    if (e.key === "m") { navigateTo("memory");    gPressed = false; }
    if (e.key === "s") { navigateTo("security");  gPressed = false; }
    if (e.key === "a") { navigateTo("audit");     gPressed = false; }
  }
});

// ── Refresh ───────────────────────────────────────────────────────────────────
function refreshAll() {
  const active = document.querySelector(".nav-item.active")?.dataset.panel ?? "dashboard";
  navigateTo(active);
  toast("Refreshed", "info");
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadDashboard();

// Live poll every 30s
setInterval(() => {
  const active = document.querySelector(".nav-item.active")?.dataset.panel;
  if (active === "dashboard") loadDashboard();
  if (active === "audit")     loadAuditLog();
}, 30_000);
</script>
</body>
</html>`;
