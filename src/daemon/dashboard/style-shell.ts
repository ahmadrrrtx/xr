/**
 * XR Control Center served-CSS fragment — reset, typography, shell layout, sidebar, topbar, panels, bento, tables, badges, buttons, forms, toggles, toasts, palette, modals.
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const STYLE_SHELL = `/* ── Reset & Core Styles ─────────────────────────────────────────────── */
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
.area-caret { float: right; } /* Phase 8 · T4 — area toggles are real buttons (aria-expanded). */
.area-toggle { background: none; border: none; width: 100%; text-align: left; cursor: pointer; font-family: var(--font-sans); }
.area-toggle:hover { color: var(--textDim); }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 16px;
  cursor: pointer;
  font-size: 12px;
  color: var(--textDim);
  transition: background 0.1s, color 0.1s;
  border: none;
  border-left: 2px solid transparent;
  text-decoration: none;
  /* Phase 8 · T3 — rendered as <button> for keyboard/AT operability */
  background: none;
  width: 100%;
  text-align: left;
  font-family: var(--font-sans);
  line-height: 1.6;
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
  border: 1px solid var(--border-strong);
  color: var(--textDim);
  cursor: pointer;
  transition: border-color 0.1s, color 0.1s;
  min-height: 26px; /* Phase 8 · T3 — WCAG 2.5.8 target size */
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
.badge-violet { background: rgba(96, 72, 248, 0.14); color: var(--violet); border: 1px solid rgba(96,72,248,0.24); }
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
  border: 1px solid var(--border-strong);
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
.toggle { position: relative; width: 44px; height: 24px; cursor: pointer; display: inline-block; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; inset: 0; background: var(--border-strong); border-radius: 99px; transition: 0.15s; }
.toggle-slider::before { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; bottom: 3px; background: var(--text); border-radius: 50%; transition: 0.15s; }
.toggle input:checked + .toggle-slider { background: var(--cyan); }
.toggle input:checked + .toggle-slider::before { transform: translateX(20px); background: #000; }

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

`;
