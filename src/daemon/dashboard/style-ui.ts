/**
 * XR Control Center served-CSS fragment — chat workspace, settings, shield, utility classes, a11y layer, Phase A/B components.
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const STYLE_UI = `/* ── Chat Session Workspace (Liquid Layout) ────────────────────────── */
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
.chat-search-input { background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 6px 10px; font-size: 11px; outline: none; color: var(--text); }
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
.msg-act-btn { background: none; border: none; color: var(--textDim); cursor: pointer; font-size: 10px; padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid transparent; min-height: 24px; /* Phase 8 · T3 — WCAG 2.5.8 */ }
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
  font-size: 10px; font-weight: 700; text-transform: uppercase; font-family: var(--font-mono); padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); color: var(--muted); cursor: pointer; transition: 0.1s;
  /* Phase 8 · T3 — explicit background (UA button grey broke contrast) + 24px target (2.5.8) */
  background: var(--surface2); min-height: 24px;
}
.composer-flag-chip:hover { border-color: var(--cyan); color: var(--textDim); }
.composer-flag-chip.active { color: #001018; border-color: transparent; }
.composer-flag-chip.active.memory { background: var(--cyan); }
.composer-flag-chip.active.research { background: var(--violet); color: var(--text); } /* white text on official indigo (AA) */
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
  padding: 6px 12px; border-radius: var(--radius); cursor: pointer; font-size: 12px; color: var(--textDim); transition: 0.1s; border: none; border-left: 2px solid transparent; text-align: left;
  /* Phase 8 · T3 — button reset (UA grey background broke contrast) */
  background: none; width: 100%; font-family: var(--font-sans);
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


/* ── Phase 8 · T3 — marketplace chips were unstyled buttons (UA grey bg). ── */
.mp-chip, .mp-tab {
  font-size: 11px; font-weight: 600; font-family: var(--font-sans);
  color: var(--textDim); cursor: pointer;
  background: var(--surface2); border: 1px solid var(--border-strong);
  border-radius: 999px; padding: 4px 12px; min-height: 24px; /* WCAG 2.5.8 */
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.mp-chip:hover, .mp-tab:hover { border-color: var(--cyan); color: var(--text); }
.mp-chip.active, .mp-tab.active { background: rgba(0, 212, 255, 0.12); color: var(--cyan); border-color: var(--cyan); font-weight: 700; }

/* ── Phase 8 · T3 — Accessibility layer (WCAG 2.2 AA) ────────────────── */
/* One visible ≥3:1 indicator for every interactive element; placed AFTER
   every \`outline: none\` reset so it always wins for keyboard users. */
:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
/* Programmatic-focus targets are exempt (panels/main are focused only to
   hand AT the new context; their contents are the very next tab stops). */
.panel:focus, .panel:focus-visible, #main-content:focus, #main-content:focus-visible,
.chat-main:focus, .chat-main:focus-visible { outline: none; }
/* Unchecked focus ring for the visually-hidden checkbox inside a toggle. */
.toggle input:focus-visible + .toggle-slider { outline: 2px solid var(--cyan); outline-offset: 2px; }

/* Skip link — first tab stop, revealed on keyboard focus. */
.skip-link {
  position: absolute;
  left: 16px;
  top: -96px;
  z-index: 1000;
  background: var(--cyan);
  color: #001018;
  font-weight: 700;
  font-size: 13px;
  padding: 8px 14px;
  border-radius: var(--radius);
  text-decoration: none;
  transition: top 0.12s ease;
}
.skip-link:focus-visible { top: 12px; outline-color: var(--text); }

[role="button"] { cursor: pointer; } /* JS pseudo-buttons keep the pointer affordance */

.content :focus { scroll-margin-block: 16px; } /* focus never obscured (WCAG 2.4.11) */

/* 24×24 min target (2.5.8) */
.badge-x {
  min-width: 24px;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--red);
  cursor: pointer;
  font-size: 11px;
  font-family: var(--font-sans);
  border-radius: var(--radius-sm);
  padding: 0 4px;
}
.badge-x:hover { background: rgba(255, 77, 77, 0.12); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* ── Phase A — Locality badge (LOCAL / CLOUD / OFFLINE / SETUP) ───────── */
.locality-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  color: var(--textDim);
  background: var(--surface);
  white-space: nowrap;
}
.locality-badge::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.locality-badge.local { color: var(--green); }
.locality-badge.cloud { color: var(--amber); }
.locality-badge.offline { color: var(--red); }
.locality-badge.setup { color: var(--amber); }

/* ── Phase A — Composer meta row (real budget + context transparency) ── */
.composer-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 6px 2px 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--muted);
}
.meta-item { display: inline-flex; align-items: center; gap: 6px; }
.meta-meter { display: inline-flex; align-items: center; gap: 6px; }
.meta-progress {
  width: 64px;
  height: 4px;
  border-radius: 99px;
  background: var(--surface2);
  overflow: hidden;
}
.meta-progress > i {
  display: block;
  height: 100%;
  background: var(--green);
  border-radius: 99px;
}
.meta-progress.warn > i { background: var(--amber); }
.meta-progress.bad > i { background: var(--red); }

/* ── Phase A — Voice panel (honest, terminal-driven states) ──────────── */
.voice-state-line { display: flex; align-items: center; gap: 8px; margin: 8px 0 12px; }
.voice-copy-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.voice-copy-row .btn { min-height: 26px; }
.voice-note { font-size: 12px; color: var(--textDim); line-height: 1.55; max-width: 68ch; }

/* ── Phase B · B-2 — shell refinements ────────────────────────────────── */
.xr-sidebar-toggle { min-height: 26px; padding: 4px 8px; margin-right: 4px; }
/* Icon-rail collapse: text is hidden via font-size 0 so the button keeps its
   native structure; icons carry their own width/height and stay visible. */
.app.sidebar-collapsed .sidebar { width: 64px; min-width: 64px; overflow-x: hidden; }
.app.sidebar-collapsed .sidebar .sidebar-label,
.app.sidebar-collapsed .sidebar .sidebar-hint,
.app.sidebar-collapsed .sidebar .logo-text-block,
.app.sidebar-collapsed .sidebar .sidebar-locality { display: none; }
.app.sidebar-collapsed .sidebar .nav-item,
.app.sidebar-collapsed .sidebar .provider-pill,
.app.sidebar-collapsed .sidebar .sidebar-logo { justify-content: center; padding-left: 0; padding-right: 0; font-size: 0; white-space: nowrap; }
.app.sidebar-collapsed .sidebar .nav-icon { margin: 0; }
.app.sidebar-collapsed .sidebar .provider-dot { margin: 0; }
.app.sidebar-collapsed .sidebar .sidebar-section { padding: 4px 0; }
.app.sidebar-collapsed .topbar { padding-left: 12px; }
.chat-wrap.inspector-hidden { grid-template-columns: 260px minmax(0, 1fr); }
.chat-wrap.inspector-hidden .chat-inspector { display: none; }

/* ── Phase B · B-3 — chat empty-state hero ────────────────────────────── */
.chat-empty-state {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
  padding: 32px 24px 48px;
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
}
.chat-empty-state[hidden] { display: none; }
.chat-empty-avatar { width: 104px; height: 104px; object-fit: contain; filter: drop-shadow(0 0 26px rgba(0, 212, 255, 0.28)); margin-bottom: 6px; }
.chat-empty-title { font-size: 21px; letter-spacing: -0.02em; color: var(--text); }
.chat-empty-sub { font-size: 13px; color: var(--textDim); max-width: 52ch; line-height: 1.6; }
.chat-empty-prompts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 10px; }
.chat-empty-prompts .btn { min-height: 34px; }
.chat-prompt-cmd { font-family: var(--font-mono); color: var(--cyan); margin-right: 6px; }
.chat-empty-caps { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 18px; }
.cap-chip {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
  font-family: var(--font-mono); padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--border-strong); background: var(--surface); color: var(--textDim);
  cursor: pointer; min-height: 26px;
}
.cap-chip:hover { border-color: var(--cyan); color: var(--cyan); }

/* ── Phase B · B-1 — first-run onboarding overlay ─────────────────────── */
.onboarding-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(10, 10, 15, 0.94);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.onboarding-overlay[hidden] { display: none; }
.onboarding-card {
  width: min(700px, 100%); max-height: 92vh; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl); box-shadow: var(--shadow-lg), 0 0 44px rgba(0, 212, 255, 0.08);
  padding: 24px 28px;
}
.onboarding-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
.onboarding-brand { display: flex; gap: 14px; align-items: center; }
.onboarding-avatar { width: 64px; height: 64px; object-fit: contain; filter: drop-shadow(0 0 18px rgba(0, 212, 255, 0.3)); }
.onboarding-head h1 { font-size: 18px; letter-spacing: -0.01em; }
.onboarding-sub { font-size: 12px; color: var(--textDim); max-width: 46ch; line-height: 1.5; }
.onboarding-progress { display: flex; gap: 6px; list-style: none; padding: 6px 0 0; margin: 0; }
.onboarding-progress li { width: 8px; height: 8px; border-radius: 50%; background: var(--border2); }
.onboarding-progress li.done { background: var(--green); }
.onboarding-progress li.active { background: var(--cyan); box-shadow: 0 0 8px var(--cyan); }
.onboarding-steps { padding: 20px 0 8px; }
.onb-step { display: block; }
.onb-step[hidden] { display: none; }
.onb-step-title { font-size: 16px; letter-spacing: -0.01em; margin-bottom: 6px; color: var(--text); }
.onb-step-sub { font-size: 12.5px; color: var(--textDim); margin-bottom: 14px; line-height: 1.55; max-width: 62ch; }
.onb-lead { font-size: 13.5px; line-height: 1.7; color: var(--textDim); max-width: 60ch; margin-bottom: 18px; }
.onb-actions { display: flex; align-items: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.onb-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.onb-card {
  display: flex; flex-direction: column; gap: 6px; text-align: left;
  background: var(--surface2); border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg); padding: 14px; cursor: pointer;
  color: var(--text); font-family: var(--font-sans); min-height: 104px;
}
.onb-card:hover { border-color: var(--cyan); }
.onb-card-name { font-weight: 700; font-size: 13px; }
.onb-card-desc { font-size: 12px; color: var(--textDim); line-height: 1.5; }
.onb-provider-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-bottom: 14px; }
.onb-provider {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 8px 10px; cursor: pointer;
  font-size: 12px; color: var(--text); min-height: 32px;
}
.onb-provider.sel { border-color: var(--cyan); box-shadow: 0 0 0 1px var(--cyan); }
.onb-provider .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--border2); flex: none; }
.onb-provider.haskey .dot { background: var(--amber); }
.onb-provider.ready .dot { background: var(--green); }
.onb-field { margin-top: 12px; }
.onb-result { font-size: 12px; }
.onb-result.ok { color: var(--green); }
.onb-result.warn { color: var(--amber); }
.onb-result.err { color: var(--red); }
.onb-security ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.onb-security li { display: flex; gap: 8px; font-size: 12.5px; color: var(--textDim); line-height: 1.55; }
.onb-security li::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--cyan); flex: none; margin-top: 6px; }
.onb-security code { font-family: var(--font-mono); color: var(--text); background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; }
.onb-local .kv-line { font-size: 12.5px; color: var(--textDim); line-height: 1.7; margin-bottom: 6px; }
.onb-local .kv-line strong { color: var(--text); }
.onboarding-foot { display: flex; align-items: center; gap: 8px; padding-top: 14px; border-top: 1px solid var(--border); }
.onboarding-foot .onb-foot-status { margin-left: auto; font-size: 11px; color: var(--muted); font-family: var(--font-mono); }
@media (prefers-reduced-transparency: reduce) {
  .onboarding-overlay { backdrop-filter: none; background: var(--bg); }
}

.xr-sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* ── Phase E · E-1 — avatar state orb (real agent state, no fakes) ────── */
.chat-state-orb {
  position: relative;
  width: 34px; height: 34px;
  flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  margin-right: 2px;
}
.chat-state-avatar { width: 30px; height: 30px; object-fit: contain; border-radius: 50%; }
.chat-state-orb::after {
  content: "";
  position: absolute; inset: -3px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  transition: border-color 0.15s;
}
.chat-state-orb.thinking::after { border-color: var(--cyan); animation: xrOrbPulse 1.6s ease-in-out infinite; }
.chat-state-orb.working::after { border-color: var(--amber); animation: xrOrbPulse 1s ease-in-out infinite; }
.chat-state-orb.idle::after { border-color: var(--border-strong); }
@keyframes xrOrbPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
/* Empty-state hero orb (same states; larger) */
.chat-empty-orb { position: relative; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 6px; }
.chat-empty-orb::after {
  content: "";
  position: absolute; inset: -6px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  transition: border-color 0.15s;
}
.chat-empty-orb.thinking::after { border-color: var(--cyan); animation: xrOrbPulse 1.6s ease-in-out infinite; }
.chat-empty-orb.working::after { border-color: var(--amber); animation: xrOrbPulse 1s ease-in-out infinite; }
.chat-empty-orb.idle::after { border-color: var(--border-strong); }

/* ── Phase G · G-1/G-2 — Workspace Files browser ───────────────────────── */
.files-browser { display: grid; grid-template-columns: minmax(240px, 42%) 1fr; gap: 12px; min-height: 320px; }
.files-pane { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; display: flex; flex-direction: column; }
.files-tree { max-height: 560px; }
.files-breadcrumb { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 11px; align-items: center; }
.files-crumb { padding: 2px 6px; font-size: 11px; min-height: 22px; }
.files-list { flex: 1; overflow-y: auto; padding: 4px; }
.files-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; min-height: 26px; }
.files-row:hover { background: var(--surface2); }
.files-row.dir { color: var(--text); }
.files-row.file { color: var(--textDim); }
.files-ic { width: 12px; color: var(--cyan); flex: none; }
.files-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.files-size { font-family: var(--font-mono); font-size: 10px; color: var(--muted); flex: none; }
.files-note { padding: 6px 10px; font-size: 10px; color: var(--muted); border-top: 1px solid var(--border); }
.files-viewer { max-height: 560px; }
.files-viewer-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12px; }
.files-viewer-actions { margin-left: auto; display: flex; gap: 6px; }
.files-viewer-body { flex: 1; overflow: auto; }
.files-code { padding: 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.55; color: var(--text); white-space: pre-wrap; word-break: break-word; }
.files-diff { border-top: 1px solid var(--border); }
.files-empty { padding: 18px; text-align: center; }
.files-tools { display: flex; align-items: center; gap: 8px; }
@media (max-width: 900px) { .files-browser { grid-template-columns: 1fr; } }

/* ── Phase C · C-2 — approval cards: WHAT / WHY / RISK ─────────────────── */
.approval-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--surface);
}
.approval-what { font-size: 12px; font-weight: 700; color: var(--text); margin-bottom: 2px; }
.approval-why { font-size: 11px; color: var(--textDim); line-height: 1.5; margin-bottom: 6px; }
.approval-risk { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 10px; color: var(--muted); margin-bottom: 8px; }
.approval-risk-reason { font-style: italic; }

.sess-row { display: flex; align-items: center; gap: 6px; }
.sess-row .sess-open { flex: 1; min-width: 0; }
.sess-copy { padding: 2px 6px; font-size: 10px; font-family: var(--font-mono); flex: none; min-height: 24px; }

/* ── Phase C · C-3 — streaming cursor on the active assistant message ──── */
.msg.streaming .msg-bubble::after {
  content: "▍";
  display: inline-block;
  margin-left: 2px;
  color: var(--cyan);
  animation: xrStreamBlink 1s steps(2, start) infinite;
}
@keyframes xrStreamBlink { to { visibility: hidden; } }
.msg-streaming-note { font-size: 10px; color: var(--muted); font-family: var(--font-mono); margin-top: 4px; }
`;
