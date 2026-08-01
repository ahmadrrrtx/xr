/**
 * XR Control Center — stylesheet
 *
 * Phase 2 · T7. `src/daemon/dashboard.ts` was 3 619 lines — 4.5x the 800-line
 * threshold and by far XR's largest module: one function returning one template
 * literal that held the stylesheet, the markup AND the whole client-side
 * application, so a CSS tweak and a client-logic change touched the same file.
 *
 * Owns PRESENTATION ONLY: the CSS served inside <style>. No imports, no logic.
 *
 * Mechanical and behaviour-preserving: the composed document is byte-identical
 * to the pre-split output (test/daemon/dashboard-split.test.ts pins the
 * SHA-256). The fragments below are stored exactly as they appeared in the
 * original template literal — already escaped for that context — so they are
 * re-embedded in a template literal unchanged.
 */

export const DASHBOARD_CSS = `
/* ── Design Tokens (CSS Variables) ────────────────────────────────────── */
:root {
  --bg:         #020817; /* Deep space black */
  --bg2:        #070A13; /* Raised panel dark background */
  --surface:    #0B1120; /* Card / message bubble base */
  --surface2:   #151E33; /* Inputs / active rows */
  --border:     #1E293B; /* Slate-800 divider default border */
  --border2:    #334155; /* Slate-700 hover border */
  --cyan:       #00D4FF; /* Primary active indicator / glow */
  --violet:     #A855F7; /* Secondary end brand color */
  --green:      #00FF88; /* Success, local-first, safe */
  --amber:      #F59E0B; /* Warning, cloud routing, attention */
  --red:        #FF4D4D; /* Critical error, security block */
  --muted:      #475569; /* Tertiary labels, disabled state */
  --text:       #F8FAFC; /* Primary high-contrast text */
  --textDim:    #94A3B8; /* Secondary dim copy */
  --radius-sm:  4px;
  --radius:     8px;
  --radius-lg:  12px;
  --radius-xl:  16px;
  --font-mono:  'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  --font-sans:  'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --sidebar-w:  240px;
  --inspector-w:320px;
  --glow-c:     0 0 20px rgba(0, 212, 255, 0.15);
  --glow-g:     0 0 20px rgba(0, 255, 136, 0.12);
  --glow-a:     0 0 20px rgba(245, 158, 11, 0.15);
  --glow-r:     0 0 24px rgba(255, 77, 77, 0.2);
}

/* ── Reset & Core Styles ─────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

/* ── Custom Scrollbar ────────────────────────────────────────────────── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: var(--radius-sm); }
::-webkit-scrollbar-thumb:hover { background: var(--cyan); }

/* ── Typography Elements ──────────────────────────────────────────────── */
h1, h2, h3, h4 { font-weight: 700; color: var(--text); }
h1 { font-size: 20px; letter-spacing: -0.02em; }
h2 { font-size: 16px; letter-spacing: -0.01em; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
code, pre, .mono { font-family: var(--font-mono); font-size: 12px; }

/* ── Application Shell Layout ─────────────────────────────────────────── */
.app { display: flex; height: 100vh; width: 100vw; overflow: hidden; }

/* ── Left Sidebar Navigation ────────────────────────────────────────── */
.sidebar {
  width: var(--sidebar-w);
  min-width: var(--sidebar-w);
  background: var(--bg2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 0 16px;
  transition: width 0.2s cubic-bezier(0.4,0,0.2,1);
}
.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
  cursor: default;
  user-select: none;
}
.logo-mark {
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -1.5px;
}
.logo-text-block { display: flex; flex-direction: column; }
.logo-text { font-size: 14px; font-weight: 800; color: var(--text); letter-spacing: -0.01em; }
.logo-sub { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; }
.sidebar-section { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.02); }
.sidebar-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 8px 16px 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 16px;
  cursor: pointer;
  font-size: 12px;
  color: var(--textDim);
  transition: background 0.1s, color 0.1s;
  border-left: 2px solid transparent;
  text-decoration: none;
}
.nav-item:hover { background: rgba(255,255,255,0.03); color: var(--text); }
.nav-item.active {
  background: rgba(0, 212, 255, 0.08);
  color: var(--cyan);
  border-left-color: var(--cyan);
  font-weight: 600;
}
.nav-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.nav-icon svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; }
.sidebar-spacer { flex: 1; min-height: 20px; }
.sidebar-footer { padding: 12px 16px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.provider-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--textDim);
  padding: 6px 10px;
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--border);
}
.provider-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); }
.sidebar-hint { font-size: 10px; color: var(--muted); text-align: center; }

/* ── Main Panel Work Area ────────────────────────────────────────────── */
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  height: 52px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  user-select: none;
}
.topbar-title { font-weight: 700; font-size: 14px; color: var(--text); }
.breadcrumbs { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.breadcrumbs a { color: var(--textDim); text-decoration: none; transition: color 0.1s; }
.breadcrumbs a:hover { color: var(--cyan); }
.breadcrumbs span { color: var(--muted); }
.topbar-spacer { flex: 1; }
.topbar-status { display: flex; align-items: center; gap: 10px; }
.status-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--textDim);
  cursor: pointer;
  transition: border-color 0.1s, color 0.1s;
}
.status-chip:hover { border-color: var(--cyan); color: var(--text); }
.status-chip .dot { width: 6px; height: 6px; border-radius: 50%; }
.status-chip.ok .dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
.status-chip.warn .dot { background: var(--amber); box-shadow: 0 0 6px var(--amber); }
.status-chip.err .dot { background: var(--red); box-shadow: 0 0 6px var(--red); }
.content { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 20px; min-width: 0; }

/* ── Content View Panels ──────────────────────────────────────────────── */
.panel { display: none; height: 100%; width: 100%; }
.panel.active { display: block; animation: viewFade 0.15s cubic-bezier(0.4, 0, 0.2, 1); }
@keyframes viewFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

/* ── Bento Grid Layouts ──────────────────────────────────────────────── */
.grid { display: grid; gap: 16px; }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }
.grid-6 { grid-template-columns: repeat(6, 1fr); }
.grid-12 { grid-template-columns: repeat(12, 1fr); }
@media (max-width: 1200px) { .grid-4, .grid-6, .grid-12 { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 768px) { .grid-2, .grid-3, .grid-4, .grid-6, .grid-12 { grid-template-columns: 1fr; } }

/* ── Bento Cards ─────────────────────────────────────────────────────── */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.card-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.card-icon { width: 16px; height: 16px; color: var(--textDim); display: flex; align-items: center; }
.card-icon svg { width: 100%; height: 100%; stroke: currentColor; stroke-width: 2; fill: none; }
.card-value { font-family: var(--font-mono); font-size: 24px; font-weight: 700; color: var(--text); letter-spacing: -0.5px; }
.card-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
.card-glow-cyan { box-shadow: var(--glow-c); }
.card-glow-cyan:hover { border-color: var(--cyan); }
.card-glow-green { box-shadow: var(--glow-g); }
.card-glow-green:hover { border-color: var(--green); }
.card-glow-amber { box-shadow: var(--glow-a); }
.card-glow-amber:hover { border-color: var(--amber); }
.card-glow-red { box-shadow: var(--glow-r); }
.card-glow-red:hover { border-color: var(--red); }

/* ── Bento Health Grid Dashboard Matrix (12 cells) ─────────────────────── */
.bento-matrix { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px; }
@media(max-width: 1024px) { .bento-matrix { grid-template-columns: repeat(2, 1fr); } }
@media(max-width: 600px) { .bento-matrix { grid-template-columns: 1fr; } }
.matrix-cell {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.1s;
}
.matrix-cell:hover { border-color: var(--border2); }
.matrix-cell-head { display: flex; align-items: center; justify-content: space-between; }
.matrix-cell-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: var(--textDim); }
.matrix-cell-status { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.matrix-cell-status.green { background: var(--green); box-shadow: 0 0 6px var(--green); }
.matrix-cell-status.amber { background: var(--amber); box-shadow: 0 0 6px var(--amber); }
.matrix-cell-status.red { background: var(--red); box-shadow: 0 0 6px var(--red); }
.matrix-cell-val { font-size: 14px; font-family: var(--font-mono); font-weight: 700; color: var(--text); }
.matrix-cell-sub { font-size: 11px; color: var(--muted); }

/* ── Tables & Data Lists ─────────────────────────────────────────────── */
.stat-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.02); }
.stat-row:last-child { border-bottom: none; }
.stat-key { font-size: 12px; color: var(--textDim); }
.stat-val { font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--text); }
.stat-val.green { color: var(--green); }
.stat-val.cyan { color: var(--cyan); }
.stat-val.amber { color: var(--amber); }
.stat-val.red { color: var(--red); }
.stat-val.muted { color: var(--muted); }

.health-bar { height: 4px; background: var(--border); border-radius: 99px; overflow: hidden; margin-top: 4px; }
.health-bar-fill { height: 100%; border-radius: 99px; transition: width 0.3s ease; }
.health-bar-fill.green { background: var(--green); }
.health-bar-fill.amber { background: var(--amber); }
.health-bar-fill.red { background: var(--red); }
.health-bar-fill.cyan { background: var(--cyan); }

/* ── Badges ───────────────────────────────────────────────────────────── */
.badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  text-transform: uppercase;
}
.badge-green { background: rgba(0, 255, 136, 0.12); color: var(--green); border: 1px solid rgba(0,255,136,0.2); }
.badge-cyan { background: rgba(0, 212, 255, 0.12); color: var(--cyan); border: 1px solid rgba(0,212,255,0.2); }
.badge-amber { background: rgba(245, 158, 11, 0.12); color: var(--amber); border: 1px solid rgba(245,158,11,0.2); }
.badge-red { background: rgba(255, 77, 77, 0.12); color: var(--red); border: 1px solid rgba(255,77,77,0.2); }
.badge-violet { background: rgba(168, 85, 247, 0.12); color: var(--violet); border: 1px solid rgba(168,85,247,0.2); }
.badge-gray { background: var(--surface2); color: var(--textDim); border: 1px solid var(--border); }

/* ── Interactive Buttons ──────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.1s, filter 0.1s, border-color 0.1s, background 0.1s;
  font-family: var(--font-sans);
  color: var(--text);
  background: var(--surface2);
  user-select: none;
}
.btn:hover { filter: brightness(1.1); }
.btn:active { transform: translateY(1px); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
.btn-primary { background: var(--cyan); color: #001018; font-weight: 700; box-shadow: 0 0 15px rgba(0,212,255,0.2); }
.btn-primary:hover { box-shadow: 0 0 25px rgba(0,212,255,0.4); }
.btn-ghost { background: transparent; border-color: var(--border); color: var(--textDim); }
.btn-ghost:hover { border-color: var(--cyan); color: var(--cyan); }
.btn-danger { background: transparent; border-color: rgba(255, 77, 77, 0.3); color: var(--red); }
.btn-danger:hover { background: rgba(255, 77, 77, 0.08); border-color: var(--red); }

/* ── Forms and Inputs ────────────────────────────────────────────────── */
.input, select, textarea {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 13px;
  outline: none;
  transition: border-color 0.1s, box-shadow 0.1s;
}
.input:focus, select:focus, textarea:focus {
  border-color: var(--cyan);
  box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.2), 0 0 12px rgba(0, 212, 255, 0.08);
}
.input::placeholder { color: var(--muted); }
label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--textDim); display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }

/* ── Toggle Switch ───────────────────────────────────────────────────── */
.toggle { position: relative; width: 36px; height: 20px; cursor: pointer; display: inline-block; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; inset: 0; background: var(--border2); border-radius: 99px; transition: 0.15s; }
.toggle-slider::before { content: ""; position: absolute; width: 14px; height: 14px; left: 3px; bottom: 3px; background: var(--textDim); border-radius: 50%; transition: 0.15s; }
.toggle input:checked + .toggle-slider { background: var(--cyan); }
.toggle input:checked + .toggle-slider::before { transform: translateX(16px); background: #000; }

/* ── Floating Toast Container ────────────────────────────────────────── */
.toast-wrap { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 999; }
.toast {
  padding: 10px 16px;
  border-radius: var(--radius);
  background: var(--surface);
  border-left: 3px solid var(--cyan);
  box-shadow: var(--shadow);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  animation: toastFade 0.2s ease;
  min-width: 240px;
}
@keyframes toastFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.toast.ok { border-left-color: var(--green); color: var(--green); }
.toast.err { border-left-color: var(--red); color: var(--red); }
.toast.info { border-left-color: var(--cyan); color: var(--cyan); }
.toast.warn { border-left-color: var(--amber); color: var(--amber); }

/* ── Interactive Command Palette ──────────────────────────────────────── */
.palette-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
  z-index: 300; display: none; align-items: flex-start; justify-content: center; padding-top: 100px;
}
.palette-bg.open { display: flex; }
.palette {
  background: var(--surface);
  border: 1px solid var(--border2);
  border-radius: var(--radius-xl);
  width: 100%;
  max-width: 560px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.6);
  overflow: hidden;
  animation: paletteScale 0.12s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes paletteScale { from { transform: scale(0.95); opacity: 0; } to { transform: none; opacity: 1; } }
.palette-input { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.palette-input svg { width: 16px; height: 16px; color: var(--cyan); stroke: currentColor; fill: none; stroke-width: 2.5; }
.palette-input input {
  flex: 1; background: none; border: none; outline: none; font-size: 14px; color: var(--text); font-family: var(--font-sans);
}
.palette-results { max-height: 320px; overflow-y: auto; padding: 8px 0; }
.palette-section-title { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); padding: 6px 16px; }
.palette-item {
  display: flex; align-items: center; gap: 12px; padding: 8px 16px; cursor: pointer; transition: background 0.1s; font-size: 13px;
}
.palette-item:hover, .palette-item.focused { background: rgba(0,212,255,0.08); color: var(--cyan); }
.palette-item-icon { width: 16px; height: 16px; display: inline-flex; align-items: center; color: var(--textDim); }
.palette-item-icon svg { width: 100%; height: 100%; stroke: currentColor; fill: none; stroke-width: 2; }
.palette-item:hover .palette-item-icon, .palette-item.focused .palette-item-icon { color: var(--cyan); }
.palette-key { font-family: var(--font-mono); font-size: 10px; color: var(--muted); margin-left: auto; background: var(--bg2); padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid var(--border); }

/* ── Interactive Modal dialogs ───────────────────────────────────────── */
.modal-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(2px);
  z-index: 250; display: none; align-items: center; justify-content: center;
}
.modal-bg.open { display: flex; }
.modal {
  background: var(--surface);
  border: 1px solid var(--border2);
  border-radius: var(--radius-xl);
  padding: 24px;
  width: 100%;
  max-width: 480px;
  box-shadow: var(--shadow);
  animation: modalScale 0.18s cubic-bezier(0.2, 0.8, 0.2, 1.1);
}
@keyframes modalScale { from { transform: scale(0.9) translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
.modal-title { font-size: 16px; font-weight: 800; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.modal-body { font-size: 12px; color: var(--textDim); line-height: 1.6; margin-bottom: 18px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* ── Chat Session Workspace (Liquid Layout) ────────────────────────── */
.chat-wrap {
  height: calc(100vh - 52px);
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) var(--inspector-w);
  overflow: hidden;
  background: radial-gradient(circle at 50% 0%, rgba(0, 212, 255, 0.05), transparent 45%), var(--bg);
}
.chat-sidebar { background: rgba(7, 10, 19, 0.85); border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
.chat-inspector { background: rgba(7, 10, 19, 0.85); border-left: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
.chat-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: transparent; }

.chat-side-header { padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.chat-side-title-row { display: flex; align-items: center; justify-content: space-between; }
.chat-side-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
.chat-search-input { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 10px; font-size: 11px; outline: none; color: var(--text); }
.chat-search-input:focus { border-color: var(--cyan); }
.chat-sessions-list { flex: 1; overflow-y: auto; padding: 8px; }

/* Session items */
.chat-session-item {
  display: flex; flex-direction: column; gap: 4px; padding: 10px; border-radius: var(--radius); cursor: pointer; transition: background 0.1s; border-left: 2px solid transparent; margin-bottom: 4px;
}
.chat-session-item:hover { background: rgba(255, 255, 255, 0.03); }
.chat-session-item.active { background: rgba(0, 212, 255, 0.08); border-left-color: var(--cyan); }
.chat-session-item-title { font-size: 12px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-session-item-meta { font-size: 10px; color: var(--muted); font-family: var(--font-mono); }

/* Chat feed */
.chat-messages { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; scroll-behavior: smooth; }
.chat-messages-container { max-width: 820px; width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }

/* Message bubbles */
.msg { display: grid; grid-template-columns: 36px 1fr; gap: 12px; width: 100%; }
.msg.user { grid-template-columns: 1fr 36px; }
.msg-avatar-col { display: flex; justify-content: center; }
.msg-avatar-icon {
  width: 32px; height: 32px; border-radius: 10px; background: rgba(0, 212, 255, 0.1); border: 1px solid rgba(0, 212, 255, 0.2);
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-family: var(--font-mono); font-size: 12px; color: var(--cyan);
}
.msg.user .msg-avatar-icon { background: rgba(255, 255, 255, 0.04); border-color: var(--border); color: var(--textDim); }
.msg-content-col { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.msg-bubble {
  padding: 12px 16px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--surface); font-size: 13px; line-height: 1.6; word-break: break-word;
}
.msg.user .msg-bubble { background: rgba(0, 212, 255, 0.06); border-color: rgba(0, 212, 255, 0.2); }
.msg-meta { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--muted); font-family: var(--font-mono); padding: 0 4px; }
.msg-actions { margin-left: auto; display: flex; gap: 6px; opacity: 0.1; transition: opacity 0.1s; }
.msg:hover .msg-actions { opacity: 1; }
.msg-act-btn { background: none; border: none; color: var(--textDim); cursor: pointer; font-size: 10px; padding: 2px 4px; border-radius: var(--radius-sm); border: 1px solid transparent; }
.msg-act-btn:hover { color: var(--cyan); border-color: rgba(0,212,255,0.2); }

/* Markdown Styles inside Bubbles */
.msg-bubble p { margin-bottom: 10px; }
.msg-bubble p:last-child { margin-bottom: 0; }
.msg-bubble blockquote { border-left: 3px solid var(--cyan); padding-left: 12px; color: var(--textDim); font-style: italic; margin-bottom: 10px; }
.msg-bubble pre { background: var(--bg); border: 1px solid var(--border); padding: 12px; border-radius: var(--radius); overflow-x: auto; margin-bottom: 12px; }
.msg-bubble code { background: rgba(0, 212, 255, 0.12); color: var(--cyan); padding: 1px 4px; border-radius: var(--radius-sm); font-size: 0.92em; }
.msg-bubble pre code { background: none; color: inherit; padding: 0; font-size: 12px; }
.msg-bubble table { border-collapse: collapse; width: 100%; margin-bottom: 12px; font-size: 12px; }
.msg-bubble th, .msg-bubble td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
.msg-bubble th { background: var(--bg2); color: var(--cyan); font-weight: 700; }
.msg-bubble ul, .msg-bubble ol { padding-left: 20px; margin-bottom: 10px; }
.msg-bubble li { margin-bottom: 4px; }

/* Interactive tool sequences */
.tool-timeline { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
.tool-card { border: 1px solid var(--border); background: var(--bg); border-radius: var(--radius); overflow: hidden; }
.tool-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: pointer; user-select: none; }
.tool-head:hover { background: rgba(255,255,255,0.01); }
.tool-summary { display: flex; align-items: center; gap: 8px; }
.tool-indicator { font-size: 10px; font-family: var(--font-mono); }
.tool-card.running .tool-indicator { color: var(--cyan); }
.tool-card.done .tool-indicator { color: var(--green); }
.tool-card.err .tool-indicator { color: var(--red); }
.tool-name-line { font-size: 11px; font-weight: 700; color: var(--textDim); }
.tool-body { display: none; padding: 10px; border-top: 1px solid var(--border); font-family: var(--font-mono); font-size: 11px; background: rgba(0,0,0,0.2); overflow-x: auto; max-height: 200px; }
.tool-card.open .tool-body { display: block; }

/* Produced Artifacts */
.artifact-card { border: 1px solid var(--cyan); background: var(--surface2); border-radius: var(--radius-lg); overflow: hidden; margin-top: 10px; }
.artifact-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); background: rgba(0, 212, 255, 0.05); }
.artifact-title-box { display: flex; flex-direction: column; }
.artifact-title { font-weight: 700; font-size: 12px; color: var(--text); }
.artifact-tag { font-family: var(--font-mono); font-size: 9px; color: var(--cyan); text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em; }
.artifact-body { padding: 12px; font-family: var(--font-mono); font-size: 11px; background: var(--bg); overflow-y: auto; max-height: 300px; white-space: pre-wrap; }

/* Universal Composer */
.chat-composer { border-top: 1px solid var(--border); background: rgba(7, 10, 19, 0.95); padding: 16px; display: flex; flex-direction: column; }
.composer-card { border: 1px solid var(--border); background: var(--bg); border-radius: var(--radius-xl); display: flex; flex-direction: column; transition: border-color 0.15s; }
.composer-card:focus-within { border-color: var(--cyan); box-shadow: 0 0 15px rgba(0, 212, 255, 0.08); }
.composer-context { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px 0; }
.composer-input-row { display: flex; gap: 12px; align-items: flex-end; padding: 8px 12px; }
.composer-textarea { flex: 1; background: none; border: none; outline: none; font-size: 13px; color: var(--text); font-family: var(--font-sans); resize: none; min-height: 36px; max-height: 200px; line-height: 1.5; padding: 6px 0; }
.composer-send {
  width: 32px; height: 32px; border-radius: var(--radius); background: var(--cyan); border: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: #001018; transition: transform 0.1s, background 0.1s;
}
.composer-send:hover { filter: brightness(1.1); }
.composer-send svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.5; }
.composer-send.stop { background: var(--red); color: #fff; }
.composer-tools-row { display: flex; align-items: center; gap: 8px; padding: 4px 12px 10px; }
.composer-tool-btn {
  background: none; border: none; color: var(--textDim); font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: var(--radius-sm); border: 1px solid transparent;
}
.composer-tool-btn:hover { background: rgba(255,255,255,0.03); color: var(--cyan); border-color: rgba(0,212,255,0.15); }
.composer-tool-btn svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2; }
.composer-flag-chip {
  font-size: 10px; font-weight: 700; text-transform: uppercase; font-family: var(--font-mono); padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid var(--border); color: var(--muted); cursor: pointer; transition: 0.1s;
}
.composer-flag-chip:hover { border-color: var(--cyan); color: var(--textDim); }
.composer-flag-chip.active { color: #001018; border-color: transparent; }
.composer-flag-chip.active.memory { background: var(--cyan); }
.composer-flag-chip.active.research { background: var(--violet); }
.composer-flag-chip.active.shield { background: var(--green); }
.composer-flag-chip.active.computer { background: var(--amber); }
.composer-tip { margin-left: auto; font-size: 10px; color: var(--muted); font-family: var(--font-mono); }

/* Right Rail Workspace Inspector */
.inspector-card { padding: 14px; border-bottom: 1px solid var(--border); }
.inspector-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 8px; }
.inspector-detail { font-size: 11px; color: var(--textDim); line-height: 1.5; }

/* ── Settings Category Navigation ────────────────────────────────────── */
.settings-wrap { display: grid; grid-template-columns: 180px minmax(0,1fr); gap: 20px; }
@media(max-width: 768px) { .settings-wrap { grid-template-columns: 1fr; } }
.settings-nav { display: flex; flex-direction: column; gap: 4px; border-right: 1px solid var(--border); padding-right: 16px; }
@media(max-width: 768px) { .settings-nav { flex-direction: row; border-right: none; border-bottom: 1px solid var(--border); padding-right: 0; padding-bottom: 12px; overflow-x: auto; } }
.settings-nav-item {
  padding: 6px 12px; border-radius: var(--radius); cursor: pointer; font-size: 12px; color: var(--textDim); transition: 0.1s; border-left: 2px solid transparent; text-align: left;
}
.settings-nav-item:hover { background: rgba(255,255,255,0.03); color: var(--text); }
.settings-nav-item.active { background: rgba(0, 212, 255, 0.08); color: var(--cyan); border-left-color: var(--cyan); font-weight: 600; }
.settings-pane { display: none; }
.settings-pane.active { display: block; }
.settings-group { margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.02); padding-bottom: 16px; }
.settings-group:last-child { border-bottom: none; }
.settings-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; gap: 16px; }
.settings-meta { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.settings-key { font-size: 12px; font-weight: 700; color: var(--text); }
.settings-desc { font-size: 11px; color: var(--muted); }
.settings-field { width: 140px; }

/* ── Shield EDR Panel & Dojo ─────────────────────────────────────────── */
.shield-metric { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding: 8px 0; }
.shield-metric:last-child { border-bottom: none; }
.proc-row:hover { background: rgba(255,255,255,0.02); }
.proc-table { width: 100%; border-collapse: collapse; font-size: 11px; font-family: var(--font-mono); }
.proc-table th, .proc-table td { border-bottom: 1px solid var(--border); padding: 6px; text-align: left; }
.proc-table th { color: var(--muted); font-weight: 800; font-size: 10px; text-transform: uppercase; }

/* ── Help / Overlay Modal Scrim ───────────────────────────────────────── */
.help-overlay { display: none; }

/* ── Animation spinner ───────────────────────────────────────────────── */
.spinner {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid var(--border2); border-top-color: var(--cyan);
  border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Phase 4 · T5 — utility classes generated from inline style attributes ──
   (CSP style-src 'self': inline style attributes are prohibited; the
   dashboard-csp-convert.py pass moved every inline style into these
   deterministic utility classes. Regenerate only with the converter.) */
.xr-s-1 { display:flex; flex-direction:column; gap:2px; }
.xr-s-2 { padding:2px 6px; font-size:10px; width:100%; }
.xr-s-3 { color:var(--cyan); font-weight:bold; }
.xr-s-4 { color:var(--text); font-weight:700; }
.xr-s-5 { padding:4px 10px; font-family:var(--font-mono); font-size:11px }
.xr-s-6 { margin-bottom: 20px; }
.xr-s-7 { margin-bottom: 12px; }
.xr-s-8 { margin-top: 20px; }
.xr-s-9 { font-size: 12px; line-height: 1.75; }
.xr-s-10 { padding: 0; }
.xr-s-11 { padding:2px 6px; }
.xr-s-12 { font-size:18px; color:var(--cyan); }
.xr-s-13 { display:none }
.xr-s-14 { max-height: 400px; overflow-y:auto; }
.xr-s-15 { display:flex; flex-direction:column; gap:8px; }
.xr-s-16 { align-self: flex-start; }
.xr-s-17 { display:flex; gap:8px; }
.xr-s-18 { display:flex; gap:8px; align-items:center; }
.xr-s-19 { margin-bottom: 16px; border-color: var(--cyan); box-shadow: var(--glow-c); }
.xr-s-20 { margin-bottom: 8px; }
.xr-s-21 { display:flex; flex-wrap:wrap; gap:16px; align-items:center; justify-content:space-between; }
.xr-s-22 { margin-top:4px; }
.xr-s-23 { display:flex; gap:8px; flex-wrap:wrap; }
.xr-s-24 { margin-top:12px; font-size:11px; line-height:1.5; }
.xr-s-25 { color:var(--cyan); }
.xr-s-26 { display:flex; flex-direction:column; gap:10px; }
.xr-s-27 { font-size:11px; }
.xr-s-28 { max-height: 240px; overflow-y:auto; }
.xr-s-29 { margin-bottom:20px; display:none; }
.xr-s-30 { font-size:12px; margin-bottom:8px; }
.xr-s-31 { margin-top: 10px; }
.xr-s-32 { text-align:center; padding: 24px; }
.xr-s-33 { font-size: 40px; display:block; margin-bottom: 12px; }
.xr-s-34 { max-width: 500px; margin: 8px auto 16px; }
.xr-s-35 { display:flex; gap:8px; justify-content:center; }
.xr-s-36 { margin-top:16px; }
.xr-s-37 { display:flex; gap:8px; margin-bottom: 12px; }
.xr-s-38 { box-shadow: 0 0 15px rgba(255,77,77,0.3) }
.xr-s-39 { max-height: 320px; overflow-y:auto; }
.xr-s-40 { color:var(--green) }
.xr-s-41 { cursor:pointer }
.xr-s-42 { display:flex; gap:8px; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 16px; }
.xr-s-43 { display:none; }
.xr-s-44 { overflow-x:auto; }
.xr-s-45 { display:flex; flex-direction:column; gap:12px; }
.xr-s-46 { display:flex; gap:12px; margin: 4px 0; }
.xr-s-47 { flex-direction:row; align-items:center; }
.xr-s-48 { font-size:12px; margin-bottom:12px; }
.xr-s-49 { border-top:1px solid var(--border); padding-top:12px; margin-top:12px; }
.xr-s-50 { width:200px; }
.xr-s-51 { flex:1; }
.xr-s-52 { display:flex; gap:16px; align-items:center; margin-bottom: 20px; }
.xr-s-53 { font-size: 48px; }
.xr-s-54 { max-width: 200px; }
.xr-s-55 { font-size: 9px; font-weight:800; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); padding:6px 12px; }
.xr-s-56 { padding:14px; }
.xr-s-57 { padding: 40px 20px; text-align:center; }
.xr-s-58 { max-width:480px; margin: 8px auto 20px; }
.xr-s-59 { max-width: 600px; margin: 0 auto; text-align: left; }
.xr-s-60 { padding:2px 8px; }
.xr-s-61 { margin-right:6px; }
.xr-s-62 { cursor:pointer; color:var(--red); }
.xr-s-63 { width:14px; height:14px; stroke:currentColor; fill:none; stroke-width:2; }
.xr-s-64 { border:1px solid var(--border); padding:8px; border-radius:var(--radius); margin-bottom:6px; }
.xr-s-65 { font-size:10px; color:var(--muted); margin-bottom:6px; }
.xr-s-66 { display:flex; gap:6px; }
.xr-s-67 { padding:2px 6px; font-size:10px; }
.xr-s-68 { border-left:2px solid var(--cyan); padding-left:6px; margin-bottom:6px; }
.xr-s-69 { padding: 10px 0; cursor:pointer; }
.xr-s-70 { font-weight:700; }
.xr-s-71 { font-size:10px; }
.xr-s-72 { margin-bottom:12px; }
.xr-s-73 { max-height: 300px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; }
.xr-s-74 { padding:6px; border-bottom:1px solid rgba(255,255,255,0.02) }
.xr-s-75 { font-size:10px; margin-top:2px; }
.xr-s-76 { padding: 8px 0; }
.xr-s-77 { padding:10px; text-align:center; }
.xr-s-78 { font-weight:800; font-size:12px; }
.xr-s-79 { font-family:var(--font-mono); font-size:10px; color:var(--muted); margin-top:2px; }
.xr-s-80 { margin-top:8px; }
.xr-s-81 { border-top:1px solid var(--border); margin-top:8px; padding-top:8px; }
.xr-s-82 { cursor:pointer; }
.xr-s-83 { padding:8px 0; }
.xr-s-84 { font-size:12px; }
.xr-s-85 { padding: 10px 0; }
.xr-s-86 { margin-bottom:4px; }
.xr-s-87 { background:rgba(255,255,255,0.01); padding:6px; }
.xr-s-88 { height:fit-content; }
.xr-s-89 { font-size:11px; margin-top:4px; }
.xr-s-90 { padding:8px 0; cursor:pointer; }
.xr-s-91 { margin-bottom:10px; }
.xr-s-92 { font-size:12px; line-height:1.6; margin-bottom:10px; }
.xr-s-93 { min-width:0; flex:1; }
.xr-s-94 { display:flex; gap:10px; align-items:center; margin-bottom:12px; }
.xr-s-95 { width:40px; height:40px; }
.xr-s-96 { font-size:14px; font-weight:800; }
.xr-s-97 { font-size:11px; line-height:1.5; margin-bottom:12px; }
.xr-s-98 { padding:10px 0; align-items:flex-start; }
.xr-s-99 { font-size:11px; margin-top:2px; }
.xr-s-100 { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
.xr-s-101 { padding:10px 0; }
.xr-s-102 { background:rgba(255,255,255,0.01); padding:8px; }
.xr-s-103 { border-bottom:1px solid var(--border); padding:8px 0; }
.xr-s-104 { font-weight:700; display:flex; justify-content:space-between; }
.xr-s-105 { font-weight:700; color:var(--amber); }
.xr-s-106 { max-width: 80%; }
.xr-s-107 { display:flex; align-items:center; gap:8px; }
.xr-s-108 { width:60px; }
.xr-s-109 { width:\${Math.min(100, (row.usd / (config.perTaskUsd || 1)) * 100)}%; }
`;
