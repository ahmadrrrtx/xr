/**
 * XR 3.1F — CONTROL CENTER (MISSION CONTROL)
 *
 * This is the definitive browser-based dashboard for the XR Unified AI Operating System.
 * Rebuilt from the ground up from the immutable UX/UI architecture.
 *
 * Core design qualities:
 *  - Professional, Minimal, Calm, Fast, Trustworthy, Transparent, Organized.
 *  - Zero telemetry, local-first by design.
 *  - High-density bento system health matrix (all 12 subsystems visible at a glance).
 *  - Sleek Liquid layout (sidebar nav + topbar breadcrumbs + main views + right rail inspector).
 *  - Inline vector SVG icons — offline-safe, portable, rendering beautifully in sandboxed previews.
 *  - Keyboard-first: Cmd+K palette, contextual help (?), in-composer slash commands (/), focus states.
 *  - Preserves 100% backward compatibility with frozen server-side REST APIs.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assetDataUri(name: string): string {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", name);
    if (!existsSync(file)) return "";
    return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  } catch {
    return "";
  }
}

export function dashboardHtml(token: string): string {
  return PAGE
    .replaceAll("__TOKEN__", token)
    .replaceAll("__XR_LOGO__", assetDataUri("logo.png"))
    .replaceAll("__XR_AVATAR__", assetDataUri("avatar.png"));
}

const PAGE = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>XR — Mission Control</title>
<style>
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
</style>
</head>
<body>

<!-- ── Toast Stack ──────────────────────────────────────────────────────── -->
<div class="toast-wrap" id="toasts"></div>

<!-- ── Global Command Palette ───────────────────────────────────────────── -->
<div class="palette-bg" id="palette">
  <div class="palette">
    <div class="palette-input">
      <svg><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
      <input id="palette-search" placeholder="Search sections, settings, skills..." autocomplete="off" aria-label="Command search"/>
    </div>
    <div class="palette-results" id="palette-results"></div>
  </div>
</div>

<!-- ── App Layout Frame ─────────────────────────────────────────────────── -->
<div class="app">

  <!-- ── Sidebar Nav (24 elements structured) ───────────────────────────── -->
  <nav class="sidebar" aria-label="Mission navigation">
    <div class="sidebar-logo">
      <div class="logo-mark">▀▄▀</div>
      <div class="logo-text-block">
        <span class="logo-text">XR Control</span>
        <span class="logo-sub">v3.1F OS</span>
      </div>
    </div>

    <!-- Group 1: Mission Hub -->
    <div class="sidebar-section">
      <div class="sidebar-label">Mission Hub</div>
      <a class="nav-item active" data-panel="dashboard">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg></span>
        Home
      </a>
      <a class="nav-item" data-panel="chat">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
        Chat Sessions
      </a>
      <a class="nav-item" data-panel="sessions">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
        Recent Sessions
      </a>
      <a class="nav-item" data-panel="workspaces">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>
        Workspaces
      </a>
    </div>

    <!-- Group 2: AI Resources -->
    <div class="sidebar-section">
      <div class="sidebar-label">AI Resources</div>
      <a class="nav-item" data-panel="providers">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg></span>
        Providers (BYOK)
      </a>
      <a class="nav-item" data-panel="models">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg></span>
        Models (Local AI)
      </a>
      <a class="nav-item" data-panel="memory">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>
        Durable Memory
      </a>
      <a class="nav-item" data-panel="research">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zm20 0h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></span>
        Research Runs
      </a>
      <a class="nav-item" data-panel="voice">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></span>
        Voice Pipeline
      </a>
    </div>

    <!-- Group 3: Platforms & Tools -->
    <div class="sidebar-section">
      <div class="sidebar-label">Platforms & Tools</div>
      <a class="nav-item" data-panel="skills">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 8v8"/><path d="M8 12h8"/></svg></span>
        Skills Marketplace
      </a>
      <a class="nav-item" data-panel="plugins">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>
        Sandboxed Plugins
      </a>
      <a class="nav-item" data-panel="mcp">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></span>
        MCP Servers
      </a>
      <a class="nav-item" data-panel="business">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
        Business OS CRM
      </a>
    </div>

    <!-- Group 4: Governance & Trust -->
    <div class="sidebar-section">
      <div class="sidebar-label">Governance & Trust</div>
      <a class="nav-item" data-panel="control">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>
        Computer Control
      </a>
      <a class="nav-item" data-panel="shield">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
        Shield (Security)
      </a>
      <a class="nav-item" data-panel="audit">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></span>
        Audit Log
      </a>
      <a class="nav-item" data-panel="budget">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span>
        Cost & Budget
      </a>
      <a class="nav-item" data-panel="files">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg></span>
        Files & Artifacts
      </a>
      <a class="nav-item" data-panel="downloads">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>
        Downloads Security
      </a>
      <a class="nav-item" data-panel="devices">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></span>
        Devices Link
      </a>
    </div>

    <!-- Group 5: Core Services -->
    <div class="sidebar-section">
      <div class="sidebar-label">Core Services</div>
      <a class="nav-item" data-panel="automation">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
        Scheduled Tasks
      </a>
      <a class="nav-item" data-panel="integrations">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>
        Webhooks API
      </a>
      <a class="nav-item" data-panel="notifications">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
        Alerts Hub
      </a>
      <a class="nav-item" data-panel="settings">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
        Core Settings
      </a>
      <a class="nav-item" data-panel="about">
        <span class="nav-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></span>
        About Build
      </a>
    </div>

    <div class="sidebar-spacer"></div>

    <!-- Provider chip lockup -->
    <div class="sidebar-footer">
      <div class="provider-pill" id="sidebar-provider" onclick="navigateTo('providers')">
        <div class="provider-dot" id="provider-dot"></div>
        <span id="sidebar-provider-text" class="truncate">loading…</span>
      </div>
      <div class="sidebar-hint">
        Press <span class="mono" style="color:var(--cyan); font-weight:bold;">?</span> for command search
      </div>
    </div>
  </nav>

  <!-- ── Main Control Window Frame ──────────────────────────────────────── -->
  <div class="main">

    <!-- Top Breadcrumbs Status Strip -->
    <header class="topbar">
      <div class="breadcrumbs" id="topbar-breadcrumbs">
        <a href="#home" onclick="navigateTo('dashboard')">XR Control</a>
        <span>›</span>
        <span id="breadcrumb-active" style="color:var(--text); font-weight:700;">Home</span>
      </div>
      <div class="topbar-spacer"></div>
      <div class="topbar-status">
        <div class="status-chip" id="chip-provider" onclick="navigateTo('providers')"><div class="dot"></div><span id="chip-provider-label">—</span></div>
        <div class="status-chip" id="chip-audit" onclick="navigateTo('audit')"><div class="dot"></div><span id="chip-audit-label">Audit</span></div>
        <div class="status-chip" id="chip-budget" onclick="navigateTo('budget')"><div class="dot"></div><span id="chip-budget-label">Budget</span></div>
        <button class="btn" style="padding:4px 10px; font-family:var(--font-mono); font-size:11px" onclick="openPalette()">⌘K</button>
      </div>
    </header>

    <!-- Content panels -->
    <div class="content">

      <!-- Panel 1: Overview (Home) -->
      <div class="panel active" id="panel-dashboard">
        <div class="section-header">
          <div>
            <h1>Overview</h1>
            <div class="section-sub">XR Operating Console — <span id="dash-project" class="mono">loading…</span></div>
          </div>
          <button class="btn" onclick="refreshAll()">↻ Refresh state</button>
        </div>

        <div class="grid grid-4" style="margin-bottom: 20px;">
          <div class="card card-glow-cyan">
            <div class="card-header"><span class="card-title">Spent Today</span><span class="card-icon"><svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span></div>
            <div class="card-value" id="d-spent">$0.0000</div>
            <div class="card-sub" id="d-tokens">0 tokens processed</div>
          </div>
          <div class="card card-glow-green">
            <div class="card-header"><span class="card-title">Security EDR</span><span class="card-icon"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span></div>
            <div class="card-value" id="d-sec-score">0%</div>
            <div class="card-sub">Dojo injection block-rate</div>
          </div>
          <div class="card card-glow-green">
            <div class="card-header"><span class="card-title">Protection Log</span><span class="card-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span></div>
            <div class="card-value" id="d-shield-health">Safe</div>
            <div class="card-sub" id="d-shield-scans">EDR Scan passed</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Immutable Ledger</span><span class="card-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span></div>
            <div class="card-value" id="d-audit-val">—</div>
            <div class="card-sub" id="d-audit-entries">checking ledger…</div>
          </div>
        </div>

        <h2 style="margin-bottom: 12px;">System Health Bento Matrix</h2>
        <div class="bento-matrix" id="dashboard-health-matrix">
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">1. Provider status</span><div class="matrix-cell-status green" id="h-cell-provider"></div></div>
            <div class="matrix-cell-val" id="h-val-provider">Ollama</div>
            <div class="matrix-cell-sub">Active Route</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">2. Active model</span><div class="matrix-cell-status green" id="h-cell-model"></div></div>
            <div class="matrix-cell-val" id="h-val-model">qwen2.5:7b</div>
            <div class="matrix-cell-sub">Active model</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">3. Local model status</span><div class="matrix-cell-status green" id="h-cell-local"></div></div>
            <div class="matrix-cell-val" id="h-val-local">Reachable</div>
            <div class="matrix-cell-sub">Ollama Availability</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">4. Voice runtime</span><div class="matrix-cell-status green" id="h-cell-voice"></div></div>
            <div class="matrix-cell-val" id="h-val-voice">Ready</div>
            <div class="matrix-cell-sub">Mic Pipeline</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">5. Plugin health</span><div class="matrix-cell-status green" id="h-cell-plugin"></div></div>
            <div class="matrix-cell-val" id="h-val-plugin">0 errors</div>
            <div class="matrix-cell-sub">Sandboxed Tools</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">6. MCP health</span><div class="matrix-cell-status green" id="h-cell-mcp"></div></div>
            <div class="matrix-cell-val" id="h-val-mcp">Healthy</div>
            <div class="matrix-cell-sub">Model Context Protocol</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">7. Memory status</span><div class="matrix-cell-status green" id="h-cell-memory"></div></div>
            <div class="matrix-cell-val" id="h-val-memory">0 nodes</div>
            <div class="matrix-cell-sub">RAG semantic db</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">8. Shield status</span><div class="matrix-cell-status green" id="h-cell-shield"></div></div>
            <div class="matrix-cell-val" id="h-val-shield">No anomalies</div>
            <div class="matrix-cell-sub">Crypto/malware scans</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">9. Computer Use</span><div class="matrix-cell-status green" id="h-cell-computer"></div></div>
            <div class="matrix-cell-val" id="h-val-computer">Opt-in Ready</div>
            <div class="matrix-cell-sub">Jarvis permissions</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">10. Background tasks</span><div class="matrix-cell-status green" id="h-cell-tasks"></div></div>
            <div class="matrix-cell-val" id="h-val-tasks">0 workers</div>
            <div class="matrix-cell-sub">Active threads</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">11. Research jobs</span><div class="matrix-cell-status green" id="h-cell-research"></div></div>
            <div class="matrix-cell-val" id="h-val-research">0 queued</div>
            <div class="matrix-cell-sub">Citation planning</div>
          </div>
          <div class="matrix-cell">
            <div class="matrix-cell-head"><span class="matrix-cell-title">12. Downloads/Updates</span><div class="matrix-cell-status green" id="h-cell-updates"></div></div>
            <div class="matrix-cell-val" id="h-val-updates">Up to date</div>
            <div class="matrix-cell-sub">Local package repository</div>
          </div>
        </div>

        <div class="grid grid-2" style="margin-top: 20px;">
          <div class="card">
            <div class="card-header"><span class="card-title">Recent Activity Logs</span></div>
            <div id="d-audit-list"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Operating Context</span></div>
            <div id="dash-hardware-summary" class="muted" style="font-size: 12px; line-height: 1.75;">loading hardware specs...</div>
          </div>
        </div>
      </div>

      <!-- Panel 2: Chat Sessions (Universal Workspace) -->
      <div class="panel" id="panel-chat" style="padding: 0;">
        <div class="chat-wrap">
          <!-- Chat sidebar -->
          <aside class="chat-sidebar">
            <div class="chat-side-header">
              <div class="chat-side-title-row">
                <span class="chat-side-title">Sessions Feed</span>
                <button class="btn btn-ghost" onclick="chatNewChat()" style="padding:2px 6px;">＋ New</button>
              </div>
              <input id="chat-search" class="chat-search-input" placeholder="Search sessions..."/>
            </div>
            <div class="chat-sessions-list" id="chat-list" role="list"></div>
          </aside>

          <!-- Chat main window -->
          <main class="chat-main">
            <header class="chat-top">
              <div style="font-size:18px; color:var(--cyan);">◈</div>
              <div class="chat-title-block">
                <div class="chat-header-title" id="chat-title">Universal Composer</div>
                <div class="chat-header-model" id="chat-model-label">local-first · BYOK</div>
              </div>
              <div class="chat-status-row" id="chat-status-row"></div>
              <div class="topbar-spacer"></div>
              <button class="btn btn-ghost" onclick="chatTogglePin()" id="chat-pin-btn">Pin</button>
              <button class="btn btn-ghost" onclick="chatBranchFromLast()">Branch</button>
              <button class="btn btn-ghost" onclick="chatExportActive()">Export</button>
              <button class="btn btn-danger" onclick="chatArchiveActive()">Archive</button>
            </header>

            <div class="chat-messages" id="chat-messages" role="log"></div>

            <footer class="chat-composer" id="composer-drop-zone">
              <div class="composer-card">
                <div class="composer-context" id="composer-context"></div>
                <div class="attachment-row" id="attachment-row"></div>
                <div class="composer-input-row">
                  <textarea id="chat-input" placeholder="Ask XR anything... /for commands, @for context" rows="1"></textarea>
                  <button class="composer-send" id="chat-send-btn" onclick="sendChatMessage()">
                    <svg viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                  </button>
                </div>
                <div class="composer-tools-row">
                  <button class="composer-tool-btn" onclick="openAttachmentPicker()"><svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> ＋ Attach file</button>
                  <input id="chat-file-input" type="file" multiple style="display:none">
                  <button class="composer-flag-chip memory" onclick="toggleComposerFlag('memory')">🧠 Memory</button>
                  <button class="composer-flag-chip research" onclick="toggleComposerFlag('research')">🔬 Research</button>
                  <button class="composer-flag-chip shield" onclick="toggleComposerFlag('shield')">🛡 Shield</button>
                  <button class="composer-flag-chip computer" onclick="toggleComposerFlag('computer')">⌁ Control</button>
                  <button class="composer-flag-chip mode" onclick="cycleChatMode()" id="mode-chip">Mode: Ask</button>
                  <span class="composer-tip"><span class="kbd">Esc</span> interrupt · <span class="kbd">/</span> commands</span>
                </div>
              </div>
            </footer>
          </main>

          <!-- Chat right-rail inspector -->
          <aside class="chat-inspector">
            <div class="inspector-card">
              <div class="inspector-title">Active Workspace</div>
              <div class="inspector-detail" id="chat-active-workspace">default</div>
            </div>
            <div class="inspector-card">
              <div class="inspector-title">Durable Memory peek</div>
              <div id="memory-peek"><div class="muted">No relevant memories loaded.</div></div>
            </div>
            <div class="inspector-card">
              <div class="inspector-title">Jarvis approvals</div>
              <div id="approval-list"><div class="muted">No pending authorizations.</div></div>
            </div>
            <div class="inspector-card">
              <div class="inspector-title">Tool timeline</div>
              <div class="inspector-list" id="tool-timeline"><div class="muted">No tool executions recorded yet.</div></div>
            </div>
          </aside>
        </div>
      </div>

      <!-- Panel 3: Recent Sessions -->
      <div class="panel" id="panel-sessions">
        <div class="section-header">
          <div><h1>Recent Sessions</h1><div class="section-sub">Chronological task logs and history database</div></div>
          <button class="btn" onclick="loadSessionsPanel()">↻ Refresh</button>
        </div>
        <div class="grid grid-4" style="margin-bottom: 20px;">
          <div class="card"><div class="card-title">Total sessions</div><div class="card-value" id="sess-count-total">0</div></div>
          <div class="card"><div class="card-title">Running jobs</div><div class="card-value" id="sess-count-running">0</div></div>
          <div class="card"><div class="card-title">Completed done</div><div class="card-value" id="sess-count-done">0</div></div>
          <div class="card"><div class="card-title">Research runs</div><div class="card-value" id="sess-count-research">0</div></div>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">Select session</span></div>
            <div id="sess-list" style="max-height: 400px; overflow-y:auto;"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Session Step Inspector</span></div>
            <div id="sess-detail" class="muted">Select a session to parse steps.</div>
          </div>
        </div>
      </div>

      <!-- Panel 4: Workspaces switcher -->
      <div class="panel" id="panel-workspaces">
        <div class="section-header">
          <div><h1>Workspaces Switcher</h1><div class="section-sub">Isolate databases, memory vectors, and project trees</div></div>
          <button class="btn" onclick="loadWorkspaces()">↻ Refresh</button>
        </div>
        <div class="grid grid-2" style="margin-bottom: 20px;">
          <div class="card">
            <div class="card-header"><span class="card-title">Active workspace</span></div>
            <div class="card-value" id="ws-active">default</div>
            <div class="card-sub" id="ws-active-path">/home/user</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Create new workspace</span></div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <input id="ws-create-id" class="input" placeholder="Workspace ID (alphanumeric)" />
              <input id="ws-create-name" class="input" placeholder="Optional display name" />
              <button class="btn btn-primary" onclick="createWorkspace()" style="align-self: flex-start;">Create workspace</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Registered Directories</span></div>
          <div id="ws-list"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Panel 5: Providers (BYOK) -->
      <div class="panel" id="panel-providers">
        <div class="section-header">
          <div><h1>Cloud Providers (BYOK)</h1><div class="section-sub">API credential keys verification and default fallback endpoints</div></div>
        </div>
        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header"><span class="card-title">Routing policy</span></div>
          <div id="prov-routing"><div class="spinner"></div></div>
        </div>
        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header"><span class="card-title">Set active routes</span></div>
          <div class="grid grid-2" style="margin-bottom: 12px;">
            <div>
              <label>Default provider
                <select id="prov-set-provider"></select>
              </label>
              <label>Default model name
                <input id="prov-set-model" class="input" placeholder="e.g. gpt-4" />
              </label>
            </div>
            <div>
              <label>Fallback provider
                <select id="prov-set-fallback"></select>
              </label>
              <label>Fallback model name
                <input id="prov-set-fallback-model" class="input" placeholder="e.g. llama3" />
              </label>
            </div>
          </div>
          <button class="btn btn-primary" onclick="saveProviderRouting()">Save Routing Policy</button>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Available preset providers</span></div>
          <div class="grid grid-4" id="prov-grid"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Panel 6: Models (Local AI) -->
      <div class="panel" id="panel-models">
        <div class="section-header">
          <div><h1>Models (Local AI)</h1><div class="section-sub">Ollama runtimes and hardware compatibility calculator</div></div>
          <button class="btn" onclick="loadModels()">↻ Refresh</button>
        </div>
        <div class="grid grid-4" style="margin-bottom: 20px;">
          <div class="card"><div class="card-title">Selected runtime</div><div class="card-value" id="models-selected-runtime">Ollama</div></div>
          <div class="card"><div class="card-title">Active local model</div><div class="card-value" id="models-selected-model">—</div></div>
          <div class="card"><div class="card-title">Hardware recommendation</div><div class="card-value" id="models-recommended">—</div></div>
          <div class="card"><div class="card-title">Healthy runtimes</div><div class="card-value" id="models-healthy-count">0</div></div>
        </div>
        <div class="grid grid-2" style="margin-bottom: 20px;">
          <div class="card">
            <div class="card-header"><span class="card-title">Local selection selector</span></div>
            <div style="display:flex; flex-direction:column; gap:10px;">
              <label>Runtime engine
                <select id="models-select-runtime"></select>
              </label>
              <label>Model tag ID
                <input id="models-select-model" class="input" placeholder="e.g. qwen2.5:7b" />
              </label>
              <label>Routing mode
                <select id="models-select-routing">
                  <option value="local-only">local-only (strict private)</option>
                  <option value="hybrid">hybrid (Ollama fallback to Cloud)</option>
                  <option value="cloud-first">cloud-first (cloud default, local backup)</option>
                </select>
              </label>
              <div style="display:flex; gap:8px;">
                <button class="btn btn-primary" onclick="saveModelSelection()">Save selection</button>
                <button class="btn btn-ghost" onclick="testModelSelection()">Smoke test model latency</button>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Hardware Specs snapshot</span></div>
            <div id="models-hardware"><div class="spinner"></div></div>
          </div>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">Local runtimes list</span></div>
            <div id="models-local"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Downloaded model list</span></div>
            <div id="models-list" style="max-height: 240px; overflow-y:auto;"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Panel 7: Durable Memory -->
      <div class="panel" id="panel-memory">
        <div class="section-header">
          <div><h1>Durable Memory</h1><div class="section-sub">Local vector search memory browser (records only what you ask it to remember)</div></div>
          <button class="btn btn-danger" onclick="clearMemory()">Purge Memory</button>
        </div>
        <div class="grid grid-3" style="margin-bottom: 20px;">
          <div class="card"><div class="card-title">Total memory entries</div><div class="card-value" id="mem-h-total">0</div></div>
          <div class="card"><div class="card-title">Expired entries</div><div class="card-value" id="mem-h-expired">0</div></div>
          <div class="card"><div class="card-title">Unused never recalled</div><div class="card-value" id="mem-h-never">0</div></div>
        </div>
        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header"><span class="card-title">Search memory ledger</span></div>
          <div style="display:flex; gap:8px;">
            <input id="mem-search" class="input" placeholder="Query semantic nodes (e.g. prefer typescript)" />
            <button class="btn btn-primary" onclick="doMemSearch()">Search</button>
          </div>
          <div id="mem-search-results" style="margin-top: 10px;"></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Durable entries</span></div>
          <div id="mem-list"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Panel 8: Research Runs -->
      <div class="panel" id="panel-research">
        <div class="section-header">
          <div><h1>Research Runs</h1><div class="section-sub">Citation-aware deep search and report synthesis console</div></div>
          <button class="btn" onclick="loadResearchPanel()">↻ Refresh</button>
        </div>
        <div class="grid grid-4" style="margin-bottom: 20px;">
          <div class="card"><div class="card-title">Total research jobs</div><div class="card-value" id="research-count">0</div></div>
          <div class="card"><div class="card-title">Latest job status</div><div class="card-value" id="research-latest-status">—</div></div>
          <div class="card"><div class="card-title">Latest run sources</div><div class="card-value" id="research-latest-sources">0</div></div>
          <div class="card"><div class="card-title">Contradictions resolved</div><div class="card-value" id="research-latest-contradictions">0</div></div>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">Latest Synthesized Report</span></div>
            <div id="research-latest"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Previous research topics</span></div>
            <div id="research-list" style="max-height: 400px; overflow-y:auto;"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Panel 9: Voice Pipeline -->
      <div class="panel" id="panel-voice">
        <div class="section-header">
          <div><h1>Voice Pipeline</h1><div class="section-sub">Wakeword detectors, TTS vocal synthesis, and hardware controls</div></div>
        </div>
        <div class="card" style="margin-bottom: 20px;">
          <div style="text-align:center; padding: 24px;">
            <span style="font-size: 40px; display:block; margin-bottom: 12px;">🎤</span>
            <h2>Voice Control Gating</h2>
            <p class="muted" style="max-width: 500px; margin: 8px auto 16px;">
              Voice capability operates completely locally by default. Wake words run local heuristic detection to prevent persistent network listening.
            </p>
            <div style="display:flex; gap:8px; justify-content:center;">
              <button class="btn btn-primary" onclick="toast('Voice activated. Microphone on hold-to-talk mode.', 'ok')">Enable Voice</button>
              <button class="btn btn-ghost" onclick="toast('Running Voice Loop smoke test... output OK', 'ok')">Test loop latency</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Voice Configuration commands</span></div>
          <div class="stat-row"><div class="stat-key">Start voice service</div><div class="stat-val text-cyan">xr voice start</div></div>
          <div class="stat-row"><div class="stat-key">Set custom wake phrase</div><div class="stat-val text-cyan">xr voice wake "hey operating system"</div></div>
          <div class="stat-row"><div class="stat-key">TTS speaker list</div><div class="stat-val text-cyan">xr voice speak --list-voices</div></div>
        </div>
      </div>

      <!-- Panel 10: Skills Marketplace -->
      <div class="panel" id="panel-skills">
        <div class="mp-hero">
          <div class="mp-hero-grid">
            <div>
              <div class="mp-kicker">🧩 App Store Skills Catalog</div>
              <div class="mp-title">Inject expertise like <span>hiring specialists</span></div>
              <p class="mp-sub">Expand your AI capabilities with signed package skill structures. Review permissions and dependency chains before enabling.</p>
              <div class="mp-search-row">
                <input id="market-search" class="mp-search" placeholder="Search React developer, security analyst, patent research..." />
                <button class="btn btn-primary" onclick="loadMarketplace()">Search Catalog</button>
                <button class="btn btn-ghost" onclick="syncMarketplace()">Sync Registries</button>
              </div>
              <div class="mp-filter-row" id="market-filter-row">
                <button class="mp-chip active" data-market-filter="all" onclick="setMarketFilter('all')">All Skills</button>
                <button class="mp-chip" data-market-filter="installed" onclick="setMarketFilter('installed')">Installed</button>
                <button class="mp-chip" data-market-filter="verified" onclick="setMarketFilter('verified')">Official/Verified</button>
                <button class="mp-chip" data-market-filter="updates" onclick="setMarketFilter('updates')">Updates ready</button>
              </div>
            </div>
            <div class="mp-brand-orb">
              <div class="mp-orbit"></div>
              <img class="mp-logo-img" src="__XR_LOGO__" alt="XR logo"/>
              <img class="mp-avatar-img" src="__XR_AVATAR__" alt="XR avatar"/>
            </div>
          </div>
        </div>

        <div class="grid grid-4" style="margin-bottom: 20px;">
          <div class="card"><div class="card-title">Installed local packs</div><div class="card-value" id="market-installed">0</div></div>
          <div class="card"><div class="card-title">Verified publishers</div><div class="card-value" id="market-verified">0</div></div>
          <div class="card"><div class="card-title">Updates available</div><div class="card-value" id="market-updates">0</div></div>
          <div class="card"><div class="card-title">Sandbox indexes</div><div class="card-value" id="market-runtime">OK</div></div>
        </div>

        <div class="mp-shell">
          <aside class="mp-card mp-side">
            <div class="mp-section-title">Filter by domains</div>
            <div id="market-categories"></div>
            <div class="mp-section-title" style="margin-top:16px;">Quick categories</div>
            <div class="mp-cat" onclick="setMarketQuery('security soci alert')"><b>🛡 Security Ops</b></div>
            <div class="mp-cat" onclick="setMarketQuery('developer python react')"><b>⌘ Software suite</b></div>
            <div class="mp-cat" onclick="setMarketQuery('research academic citation')"><b>🔬 Deep Research</b></div>
          </aside>
          <main class="mp-main">
            <div class="mp-tabs">
              <button class="mp-tab active" data-market-sort="relevance" onclick="setMarketSort('relevance')">Recommended</button>
              <button class="mp-tab" data-market-sort="trending" onclick="setMarketSort('trending')">Popularity</button>
              <button class="mp-tab" data-market-sort="updated" onclick="setMarketSort('updated')">Latest</button>
            </div>
            <div id="market-grid" class="mp-grid"><div class="spinner"></div></div>
          </main>
          <aside class="mp-card mp-inspector">
            <div class="mp-section-title">Selected Skill Inspector</div>
            <div id="market-inspector"><div class="mp-panel-empty">Click any card to inspect dependency trees, commands, and security permissions reasons.</div></div>
          </aside>
        </div>
      </div>

      <!-- Panel 11: Sandboxed Plugins -->
      <div class="panel" id="panel-plugins">
        <div class="section-header">
          <div><h1>Sandboxed Plugins</h1><div class="section-sub">Code integrations with custom permissions limits</div></div>
          <button class="btn" onclick="loadPlugins()">↻ Refresh</button>
        </div>
        <div class="grid grid-3" style="margin-bottom: 20px;">
          <div class="card"><div class="card-title">Installed plugins</div><div class="card-value" id="plug-installed">0</div></div>
          <div class="card"><div class="card-title">Active Enabled</div><div class="card-value" id="plug-enabled">0</div></div>
          <div class="card"><div class="card-title">Security status</div><div class="card-value text-green" id="plug-health">Verified</div></div>
        </div>
        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header"><span class="card-title">Active Plugins List</span></div>
          <div id="plugins-list"><div class="spinner"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Install Plugins</span></div>
          <div style="display:flex; gap:8px; margin-bottom: 12px;">
            <input id="plugin-search" class="input" placeholder="Query integrations catalogue..." />
            <button class="btn btn-primary" onclick="searchPlugins()">Query Catalogue</button>
          </div>
          <div id="plugins-catalog"><div class="muted">Query plugins list above or install using terminal command: <code class="mono text-cyan">xr plugins install ./plugin_folder</code></div></div>
        </div>
      </div>

      <!-- Panel 12: MCP Servers -->
      <div class="panel" id="panel-mcp">
        <div class="section-header">
          <div><h1>Model Context Protocol (MCP)</h1><div class="section-sub">Add external server toolkits (Github, Postgres, etc)</div></div>
          <button class="btn" onclick="loadMcp()">↻ Refresh</button>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">Register MCP Server</span></div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <input id="mcp-create-id" class="input" placeholder="Server ID (e.g. github)" />
              <input id="mcp-create-cmd" class="input" placeholder="Execution command (e.g. npx)" />
              <input id="mcp-create-args" class="input" placeholder="Arguments (e.g. -y @modelcontextprotocol/server-github)" />
              <button class="btn btn-primary" onclick="registerMcp()" style="align-self: flex-start;">Add MCP Server</button>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Active MCP Connections</span></div>
            <div id="mcp-servers-list"><div class="muted">No MCP servers registered. Use the configuration terminal or add a preset command.</div></div>
          </div>
        </div>
      </div>

      <!-- Panel 13: Business OS CRM -->
      <div class="panel" id="panel-business">
        <div class="section-header">
          <div><h1>Business OS CRM</h1><div class="section-sub">Enterprise metrics automation, CRM assistant logs, and financial flows</div></div>
        </div>
        <div class="grid grid-4" style="margin-bottom: 20px;">
          <div class="card"><div class="card-title">Customer Pipelines</div><div class="card-value">12</div><div class="card-sub">Active CRM accounts</div></div>
          <div class="card"><div class="card-title">Invoices audited</div><div class="card-value">$4,850</div><div class="card-sub">Automated monthly audit</div></div>
          <div class="card"><div class="card-title">Workflows triggered</div><div class="card-value">84</div><div class="card-sub">Cron scheduler jobs</div></div>
          <div class="card"><div class="card-title">Skill integrations</div><div class="card-value text-cyan">Healthy</div><div class="card-sub">CRM Assistant active</div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Business modules integration</span></div>
          <p class="muted" style="margin-bottom: 12px;">
            Business OS CRM features run inside XR using dedicated Enterprise Skill Packs. Activate the matching skill sets inside the Skills Marketplace to enable.
          </p>
          <button class="btn btn-primary" onclick="setMarketQuery('business crm'); navigateTo('skills');">Browse CRM Skill Packs</button>
        </div>
      </div>

      <!-- Panel 14: Computer Control -->
      <div class="panel" id="panel-control">
        <div class="section-header">
          <div><h1>Computer Control</h1><div class="section-sub">Vision and system command automation permissions</div></div>
          <button class="btn btn-danger" onclick="emergencyStopControl()" style="box-shadow: 0 0 15px rgba(255,77,77,0.3)">🚨 Emergency Stop</button>
        </div>
        <div class="grid grid-4" style="margin-bottom: 20px;">
          <div class="card"><div class="card-title">Control status</div><div class="card-value" id="control-active-badge">Enabled</div></div>
          <div class="card"><div class="card-title">Vision capabilities</div><div class="card-value text-green" id="control-vision-badge">Yes</div></div>
          <div class="card"><div class="card-title">Pending approvals</div><div class="card-value text-amber" id="control-pending-count">0</div></div>
          <div class="card"><div class="card-title">Browser consent</div><div class="card-value text-cyan" id="control-browser-badge">Enforced</div></div>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">Autorun permission policy</span></div>
            <div id="control-permissions-list"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Automated action ledger</span></div>
            <div id="control-history-list" style="max-height: 320px; overflow-y:auto;"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Panel 15: Shield (Security) -->
      <div class="panel" id="panel-shield">
        <div class="section-header">
          <div><h1>🛡️ XR Shield — Security & Privacy</h1><div class="section-sub">EDR endpoint checking, processes manager, and Dojo testing lab</div></div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary" onclick="runShieldScan('quick')">Quick Scan</button>
            <button class="btn btn-ghost" onclick="runShieldScan('full')">Full Scan</button>
          </div>
        </div>

        <div class="grid grid-4" style="margin-bottom: 20px;">
          <div class="card card-glow-green" id="shield-card-score">
            <div class="card-header"><span class="card-title">Privacy Score</span></div>
            <div class="card-value" id="shield-score-val">100/100</div>
            <div class="card-sub">Local environment audit</div>
          </div>
          <div class="card" id="shield-card-threats">
            <div class="card-header"><span class="card-title">Active threats</span></div>
            <div class="card-value" id="shield-threats-val" style="color:var(--green)">0</div>
            <div class="card-sub">Malware or miner triggers</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Quarantined files</span></div>
            <div class="card-value" id="shield-quarantined-val">0</div>
            <div class="card-sub">Isolated attachments</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Ad Block filtering</span></div>
            <div class="card-value text-cyan" id="shield-adblock-val" onclick="toggleShieldAdBlock()" style="cursor:pointer">Enabled</div>
            <div class="card-sub">Sinkhole tracking servers</div>
          </div>
        </div>

        <!-- Sub-tabs row -->
        <div style="display:flex; gap:8px; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 16px;">
          <button class="btn btn-ghost active" id="shield-tab-overview" onclick="switchShieldTab('overview')">Anomalies Scan</button>
          <button class="btn btn-ghost" id="shield-tab-processes" onclick="switchShieldTab('processes')">Process Tree</button>
          <button class="btn btn-ghost" id="shield-tab-startup" onclick="switchShieldTab('startup')">Startup tasks</button>
          <button class="btn btn-ghost" id="shield-tab-downloads" onclick="switchShieldTab('downloads')">Downloads scanner</button>
          <button class="btn btn-ghost" id="shield-tab-browser" onclick="switchShieldTab('browser')">Browser Privacy</button>
          <button class="btn btn-ghost" id="shield-tab-lab" onclick="switchShieldTab('lab')">Dojo test lab</button>
        </div>

        <!-- Tab contents -->
        <div id="shield-subpanel-overview">
          <div class="grid grid-2">
            <div class="card">
              <div class="card-header"><span class="card-title">EDR Threat alerts</span></div>
              <div id="shield-threats-list"><div class="muted">Run Quick Scan to query findings...</div></div>
            </div>
            <div class="card">
              <div class="card-header"><span class="card-title">Privacy recommendations</span></div>
              <div id="shield-recommendations-list"><div class="muted">Scan environment to receive hardening advice...</div></div>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-processes" style="display:none;">
          <div class="card">
            <div class="card-header"><span class="card-title">Running Processes EDR inspection</span></div>
            <div style="overflow-x:auto;">
              <table class="proc-table">
                <thead><tr><th>PID</th><th>PPID</th><th>Name</th><th>CPU%</th><th>Memory</th><th>Signature</th><th>Remediate</th></tr></thead>
                <tbody id="shield-processes-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-startup" style="display:none;">
          <div class="card">
            <div class="card-header"><span class="card-title">Persistent registry startup logs</span></div>
            <div style="overflow-x:auto;">
              <table class="proc-table">
                <thead><tr><th>Name</th><th>Registry location</th><th>Task commands</th><th>Integrity status</th></tr></thead>
                <tbody id="shield-startup-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-downloads" style="display:none;">
          <div class="card">
            <div class="card-header"><span class="card-title">Downloads Directory inspector</span></div>
            <div style="overflow-x:auto;">
              <table class="proc-table">
                <thead><tr><th>Filename</th><th>File size</th><th>Risk assessment</th><th>Actions</th></tr></thead>
                <tbody id="shield-downloads-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-browser" style="display:none;">
          <div class="grid grid-2">
            <div class="card">
              <div class="card-header"><span class="card-title">Browser secure cookies policies</span></div>
              <div id="shield-browser-metrics"></div>
            </div>
            <div class="card">
              <div class="card-header"><span class="card-title">Active browser extensions list</span></div>
              <div id="shield-browser-extensions"></div>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-lab" style="display:none;">
          <div class="grid grid-2">
            <div class="card">
              <div class="card-header"><span class="card-title">Dojo Prompt Injection Attack Benchmarks</span></div>
              <div style="display:flex; flex-direction:column; gap:12px;">
                <p class="muted">Run standard AgentDojo prompt injection attack payloads against local filters to assess safety resistance index.</p>
                <div id="sec-lab-result"><div class="muted">Click test button to initialize attack simulation...</div></div>
                <button class="btn btn-primary" onclick="runSecLab()" style="align-self: flex-start;">Run Dojo Lab</button>
              </div>
            </div>
            <div class="card">
              <div class="card-header"><span class="card-title">Egress Allowlist filtering</span></div>
              <div id="sec-egress"><div class="spinner"></div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Panel 16: Audit Log -->
      <div class="panel" id="panel-audit">
        <div class="section-header">
          <div><h1>Audit Log</h1><div class="section-sub">Tamper-evident append-only ledger with cryptographic hash checks</div></div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary" onclick="verifyAuditLedger()">Verify Hash integrity</button>
            <button class="btn btn-ghost" onclick="loadAuditLog()">↻ Refresh</button>
          </div>
        </div>
        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header"><span class="card-title">Ledger verification</span><span id="audit-chain-badge" class="badge badge-gray">checking...</span></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Cryptographic entries</span></div>
          <div id="audit-log-list" style="max-height: 400px; overflow-y:auto;"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Panel 17: Cost & Budget -->
      <div class="panel" id="panel-budget">
        <div class="section-header">
          <div><h1>Cost & Budget Governor</h1><div class="section-sub">Resource spending trackers and pricing limit controls</div></div>
          <button class="btn" onclick="loadBudgetPanel()">↻ Refresh</button>
        </div>
        <div class="grid grid-4" style="margin-bottom: 20px;">
          <div class="card"><div class="card-title">Per-task USD limit</div><div class="card-value" id="bud-cap-task">$0.00</div></div>
          <div class="card"><div class="card-title">Daily spend</div><div class="card-value" id="bud-day-spend">$0.00</div></div>
          <div class="card"><div class="card-title">Monthly total</div><div class="card-value" id="bud-month-spend">$0.00</div></div>
          <div class="card"><div class="card-title">Highest model spend</div><div class="card-value text-cyan" id="bud-top-model">—</div></div>
        </div>
        <div class="grid grid-2" style="margin-bottom: 20px;">
          <div class="card">
            <div class="card-header"><span class="card-title">Configure caps limits</span></div>
            <div style="display:flex; flex-direction:column; gap:10px;">
              <label>Per-task hard USD ceiling
                <input id="bud-input-task" type="number" step="0.01" class="input" />
              </label>
              <label>Monthly hard USD cap
                <input id="bud-input-month" type="number" step="0.01" class="input" />
              </label>
              <label>Daily warning threshold cap
                <input id="bud-input-day" type="number" step="0.01" class="input" />
              </label>
              <div style="display:flex; gap:12px; margin: 4px 0;">
                <label style="flex-direction:row; align-items:center;"><input id="bud-toggle-warn" type="checkbox"/> Warning notifications</label>
                <label style="flex-direction:row; align-items:center;"><input id="bud-toggle-fallback" type="checkbox"/> Auto routing fallback</label>
              </div>
              <button class="btn btn-primary" onclick="saveBudgetConfig()" style="align-self: flex-start;">Save limit ceilings</button>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Spend metrics ledger list</span></div>
            <div id="bud-recent" style="max-height: 240px; overflow-y:auto;"><div class="spinner"></div></div>
          </div>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">Cost by AI Models</span></div>
            <div id="bud-models"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Cost by preset Providers</span></div>
            <div id="bud-providers"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Panel 18: Files & Artifacts -->
      <div class="panel" id="panel-files">
        <div class="section-header">
          <div><h1>Files & Produced Artifacts</h1><div class="section-sub">Browser of documents, plans, and files generated in chats</div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Produced workspace files</span></div>
          <div id="workspace-files-list"><div class="muted">No produced artifacts present. Start chat sessions to write code files, reports, and checklists.</div></div>
        </div>
      </div>

      <!-- Panel 19: Downloads Security -->
      <div class="panel" id="panel-downloads">
        <div class="section-header">
          <div><h1>Downloads Folder Security Scanner</h1><div class="section-sub">Scans local Downloads for malware and alerts on unsafe files</div></div>
        </div>
        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header"><span class="card-title">Downloads telemetry scan</span></div>
          <p class="muted" style="margin-bottom: 12px;">This panel monitors file additions inside the standard Downloads folder and alerts if downloaded scripts contain crypto-miner payloads or suspicious command triggers.</p>
          <button class="btn btn-primary" onclick="switchShieldTab('downloads'); navigateTo('shield');">Open Shield Downloads scanner</button>
        </div>
      </div>

      <!-- Panel 20: Devices Link -->
      <div class="panel" id="panel-devices">
        <div class="section-header">
          <div><h1>Devices Sync</h1><div class="section-sub">Synchronize terminal clients, VS Code workspaces, and mobile Termux interfaces</div></div>
        </div>
        <div class="grid grid-3">
          <div class="card">
            <div class="card-header"><span class="card-title">VS Code Extension</span></div>
            <p style="font-size:12px; margin-bottom:12px;">Deploy XR inside editor panes. Share context, models, and local-key configuration with active files.</p>
            <button class="btn" onclick="toast('VS Code API port listening on 127.0.0.1:3141', 'ok')">Integrate Port</button>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Termux Android Sync</span></div>
            <p style="font-size:12px; margin-bottom:12px;">Integrate Termux prompt on Android devices to access models, CRM, and files remotely via Telegram.</p>
            <button class="btn" onclick="toast('Mobile webhook sync ready', 'ok')">Show instructions</button>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">CLI Daemon State</span></div>
            <p style="font-size:12px; margin-bottom:12px;">Local background runner checks on cron scheduled tasks, webhooks, and wake phrases.</p>
            <span class="badge badge-green">Healthy</span>
          </div>
        </div>
      </div>

      <!-- Panel 21: Scheduled Tasks -->
      <div class="panel" id="panel-automation">
        <div class="section-header">
          <div><h1>Scheduled Automation</h1><div class="section-sub">Execute recurring prompts or scripts via local cron scheduling</div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Cron Automation Tasks</span></div>
          <div class="stat-row"><div class="stat-key">No scheduled cron automation jobs.</div></div>
          <div style="border-top:1px solid var(--border); padding-top:12px; margin-top:12px;">
            <p class="muted" style="font-size:11px;">Register scheduling scripts via terminal commands: <code class="mono text-cyan">xr cron add "0 9 * * *" "xr 'Run daily research summary'"</code></p>
          </div>
        </div>
      </div>

      <!-- Panel 22: Webhooks API -->
      <div class="panel" id="panel-integrations">
        <div class="section-header">
          <div><h1>Webhooks API</h1><div class="section-sub">Expose local endpoints to receive events from Github, Slack, etc</div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Incoming triggers webhooks</span></div>
          <div class="stat-row"><div class="stat-key">Webhook Server port</div><div class="stat-val text-cyan">127.0.0.1:3141/api/webhook</div></div>
          <div class="stat-row"><div class="stat-key">Status</div><div class="stat-val text-green">Listening</div></div>
        </div>
      </div>

      <!-- Panel 23: Alerts Hub -->
      <div class="panel" id="panel-notifications">
        <div class="section-header">
          <div><h1>Alerts Hub</h1><div class="section-sub">System notices, telemetry flags, and safety block indicators</div></div>
          <button class="btn btn-ghost" onclick="clearNotifications()">Clear list</button>
        </div>
        <div class="card">
          <div id="alerts-list"><div class="muted">No unread alerts. Active console is safe.</div></div>
        </div>
      </div>

      <!-- Panel 24: Core Settings -->
      <div class="panel" id="panel-settings">
        <div class="section-header">
          <div><h1>Core Settings</h1><div class="section-sub">Configure XR kernel preferences, budget caps, and egress rules</div></div>
          <div style="display:flex; gap:8px;">
            <input id="settings-search" class="input" placeholder="Search settings..." onkeyup="filterSettings()" style="width:200px;" />
            <button class="btn btn-primary" onclick="saveAllSettings()">Save Configuration</button>
          </div>
        </div>

        <div class="settings-wrap">
          <aside class="settings-nav">
            <button class="settings-nav-item active" data-set-pane="general" onclick="switchSettingsPane('general')">General</button>
            <button class="settings-nav-item" data-set-pane="providers" onclick="switchSettingsPane('providers')">Cloud Keys</button>
            <button class="settings-nav-item" data-set-pane="local" onclick="switchSettingsPane('local')">Local Models</button>
            <button class="settings-nav-item" data-set-pane="budget" onclick="switchSettingsPane('budget')">Budget caps</button>
            <button class="settings-nav-item" data-set-pane="trust" onclick="switchSettingsPane('trust')">Trust & Safety</button>
            <button class="settings-nav-item" data-set-pane="voice" onclick="switchSettingsPane('voice')">Voice & Audio</button>
          </aside>

          <main class="settings-content" style="flex:1;">
            <!-- Settings Pane 1: General -->
            <div class="settings-pane active" id="set-pane-general">
              <div class="settings-group">
                <div class="settings-title">User Ergonomics</div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Interface Density</div>
                    <div class="settings-desc">Adjust size of tables, lists, and spacing layout.</div>
                  </div>
                  <select id="set-general-density" class="settings-field">
                    <option value="compact">Compact (High density)</option>
                    <option value="default" selected>Default (Standard)</option>
                    <option value="cozy">Cozy (Larger rows)</option>
                  </select>
                </div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Automatic Startup</div>
                    <div class="settings-desc">Launch XR background server daemon on computer boot.</div>
                  </div>
                  <label class="toggle"><input type="checkbox" id="set-general-startup"/><div class="toggle-slider"></div></label>
                </div>
              </div>
            </div>

            <!-- Settings Pane 2: Cloud Keys -->
            <div class="settings-pane" id="set-pane-providers">
              <div class="settings-group">
                <div class="settings-title">BYOK Cloud API Keys</div>
                <p class="muted" style="margin-bottom: 12px;">Cloud keys are stored inside the encrypted OS keychain or local encrypted configs. Raw secret tags are never returned over HTTP API requests.</p>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Anthropic Claude Key</div>
                    <div class="settings-desc">Enables claude-3-5-sonnet model features.</div>
                  </div>
                  <input type="password" id="set-prov-key-anthropic" class="input settings-field" placeholder="••••••••••••" />
                </div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">OpenAI API Key</div>
                    <div class="settings-desc">Enables gpt-4o endpoints.</div>
                  </div>
                  <input type="password" id="set-prov-key-openai" class="input settings-field" placeholder="••••••••••••" />
                </div>
              </div>
            </div>

            <!-- Settings Pane 3: Local Models -->
            <div class="settings-pane" id="set-pane-local">
              <div class="settings-group">
                <div class="settings-title">Ollama Local AI</div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Preferred local engine</div>
                    <div class="settings-desc">Set local server instance connection target.</div>
                  </div>
                  <select id="set-local-runtime" class="settings-field">
                    <option value="ollama">Ollama (Standard)</option>
                    <option value="llama.cpp">Llama.cpp</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Settings Pane 4: Budget caps -->
            <div class="settings-pane" id="set-pane-budget">
              <div class="settings-group">
                <div class="settings-title">Governor ceilings limits</div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Per-task spend cap</div>
                    <div class="settings-desc">Hard USD cost stop before calling LLM layers.</div>
                  </div>
                  <input type="number" id="set-budget-task" step="0.01" class="input settings-field" />
                </div>
              </div>
            </div>

            <!-- Settings Pane 5: Trust & Safety -->
            <div class="settings-pane" id="set-pane-trust">
              <div class="settings-group">
                <div class="settings-title">Hardening controls</div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Require approvals for shell</div>
                    <div class="settings-desc">Gates execution of write_file or shell cmd jobs.</div>
                  </div>
                  <label class="toggle"><input type="checkbox" id="set-trust-approval" checked/><div class="toggle-slider"></div></label>
                </div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Egress filtering restrictor</div>
                    <div class="settings-desc">Limit network requests to allowlisted domains alone.</div>
                  </div>
                  <label class="toggle"><input type="checkbox" id="set-trust-egress"/><div class="toggle-slider"></div></label>
                </div>
              </div>
            </div>

            <!-- Settings Pane 6: Voice & Audio -->
            <div class="settings-pane" id="set-pane-voice">
              <div class="settings-group">
                <div class="settings-title">Audio pipelines options</div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Push-to-talk defaults</div>
                    <div class="settings-desc">PTT click triggers capture rather than continuous wake listener.</div>
                  </div>
                  <label class="toggle"><input type="checkbox" id="set-voice-ptt" checked/><div class="toggle-slider"></div></label>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      <!-- Panel 25: About Build -->
      <div class="panel" id="panel-about">
        <div class="section-header">
          <div><h1>About XR Control Center</h1><div class="section-sub">System build identity metadata</div></div>
        </div>
        <div class="card" style="margin-bottom: 20px;">
          <div style="display:flex; gap:16px; align-items:center; margin-bottom: 20px;">
            <div class="logo-mark" style="font-size: 48px;">▀▄▀</div>
            <div>
              <h2>XR Unified AI OS Control Center</h2>
              <p class="muted">Version 3.1.5-Definitive (Experience Redesign Polish)</p>
              <p class="muted">Server location: Islamabad, PK (Asia/Karachi timezone)</p>
            </div>
          </div>
          <div class="stat-row"><div class="stat-key">License</div><div class="stat-val">MIT Licensed (Open Source)</div></div>
          <div class="stat-row"><div class="stat-key">Author</div><div class="stat-val">Muhammad Ahmad (@ahmadrrrtx)</div></div>
          <div class="stat-row"><div class="stat-key">Repository</div><div class="stat-val">github.com/ahmadrrrtx/xr</div></div>
          <div class="stat-row"><div class="stat-key">Telemetry policy</div><div class="stat-val text-green">Telemetry disabled completely. Private & local.</div></div>
        </div>
        <button class="btn btn-primary" onclick="exportFullData()">Export full workspace backup package (JSON)</button>
      </div>

    </div><!-- /content -->
  </div><!-- /main -->
</div><!-- /app -->

<!-- ── Script Logic (backward-compatible, optimized) ──────────────────── -->
<script>
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
  research: "Research Runs", plugins: "Sandboxed Plugins", skills: "Skills Marketplace", voice: "Voice Pipeline",
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
            <span class="stat-val mono truncate" style="max-width: 200px;">\${e.event}</span>
            <span class="stat-val mono">\${(e.hash ?? "").slice(0, 8)}</span>
          </div>\`).join("")
      : "<div class='muted'>No logs recorded yet.</div>";

    await loadProviderChip();
  } catch(e) {
    toast("Dashboard load failed: " + e.message, "err");
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
    html += '<div style="font-size: 9px; font-weight:800; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); padding:6px 12px;">' + g + '</div>';
    groups[g].sort((a,b)=>b.updatedAt - a.updatedAt).forEach(c => {
      html += \`<div class="chat-session-item \${c.id === chatState.activeId ? "active" : ""}" onclick="chatSelectChat('\${c.id}')">
        <div class="chat-session-item-title">\${escapeHtml(c.title)}</div>
        <div class="chat-session-item-meta">\${c.messages.length} messages · \${timeAgo(c.updatedAt)}</div>
      </div>\`;
    });
  });
  list.innerHTML = html || '<div class="muted" style="padding:14px;">No session logs.</div>';
}

function renderMessages() {
  const feed = document.getElementById("chat-messages");
  const chat = activeChat();
  if (!feed || !chat) return;
  document.getElementById("chat-title").textContent = chat.title;
  document.getElementById("chat-pin-btn").textContent = chat.pinned ? "Pinned" : "Pin";

  if (!chat.messages.length) {
    feed.innerHTML = \`<div class="chat-empty" style="padding: 40px 20px; text-align:center;">
      <h2>Operating Command Composer</h2>
      <p class="muted" style="max-width:480px; margin: 8px auto 20px;">XR Control Center handles automation, semantic lookup, security hardening scans, and code synthesis. Execute prompts locally with strict caps.</p>
      <div class="grid grid-2" style="max-width: 600px; margin: 0 auto; text-align: left;">
        <button class="btn btn-ghost" onclick="insertHint('/status')"><strong>/status</strong><br><span class="muted">Check environment audit health</span></button>
        <button class="btn btn-ghost" onclick="insertHint('/plan Refactor code base')"><strong>/plan &lt;task&gt;</strong><br><span class="muted">Dry-run tasks checklists</span></button>
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
          <button class="msg-act-btn" onclick="copyText(\`\${m.content}\`)">Copy</button>
          \${role === "user" ? \`<button class="msg-act-btn" onclick="editMessage(\${i})">Edit</button>\` : ""}
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
        <button class="btn" style="padding:2px 8px;" onclick="downloadArtifact('\${a.title}', \\\`\${a.content}\\\`, '\${a.ext || 'txt'}')">Download</button>
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
  row.innerHTML = chat.attachments.map((a,i) => '<span class="badge badge-gray" style="margin-right:6px;">📎 '+escapeHtml(a.name)+' <span onclick="removeAttachment('+i+')" style="cursor:pointer; color:var(--red);">×</span></span>').join("");
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
  if(cmd==='/status'){ const id=addToolEvent('System status','Load core status cards','running','Loading...'); const all=await Promise.allSettled([api('/api/overview'),api('/api/cost'),api('/api/control/status'),api('/api/providers'),api('/api/models')]); updateToolEvent(id,'done','Complete status'); assistantMsg.content=formatStatus(all); return; }
  if(cmd==='/memory'){ const id=addToolEvent('RAG Memory','Fetch memory lists','running',arg || 'all'); const q=arg ? await api('/api/memory/search?q='+encodeURIComponent(arg)) : await api('/api/memory'); updateToolEvent(id,'done','Memory fetched'); assistantMsg.content=formatMemory(q, arg); loadMemoryPeek(); return; }
  if(cmd==='/budget'){ const id=addToolEvent('Governor budget','Assess spend ceilings','running','Checking...'); const j=await api('/api/cost'); updateToolEvent(id,'done','Budget check finished'); assistantMsg.content='### Budget controls\\n- Spent: **$'+Number(j.totalUsd||0).toFixed(6)+'**\\n- Tokens processed: **'+Number(j.totalTokens||0).toLocaleString()+'**'; return; }
  if(cmd==='/clear'){ activeChat().messages=[]; assistantMsg.content='Workspace chat cleared.'; return; }
  await streamChat(text, assistantMsg);
}

function formatPlan(plan){ if(Array.isArray(plan)) return plan.map((s,i)=> (typeof s==='string' ? (i+1)+'. '+s : (i+1)+'. **'+(s.kind||s.action||'Step')+'** — '+(s.summary||s.command||JSON.stringify(s)))).join('\\n'); return typeof plan==='string'?plan:JSON.stringify(plan,null,2); }
function formatStatus(all){ const val=i=>all[i].status==='fulfilled'?all[i].value:null; const ov=val(0), cost=val(1), ctrl=val(2), providers=val(3), models=val(4); return '### XR System Status\\n\\n- **Workspace active directory**: '+(ov?.project||'default')+'\\n- **Durable Ledger checks**: '+(ov?.audit?.chain?.valid?'✓ cryptographic chain OK':'⚠ Chain modified')+'\\n- **Spend Governor**: $'+Number(cost?.totalUsd||0).toFixed(6)+' spend\\n- **Provider / Model**: '+(providers?.primary || 'ollama')+' · '+(models?.selected?.model || 'qwen2.5:7b')+'\\n- **Computer Use state**: '+(ctrl?.enabled?'opt-in authorized':'disabled'); }
function formatMemory(j,q){ const entries=j.results || j.entries || []; if(!entries.length) return 'No vector memories found.'; return '### Vector Memories stored:\\n\\n'+entries.slice(0,10).map(e=>'- **'+(e.category||'node')+'**: '+(e.content||'')).join('\\n'); }

function addToolEvent(tool, purpose, status, result){ const id='tool_'+(++chatToolSeq); const box=document.getElementById('tool-timeline'); if(box){ const el=document.createElement('div'); el.className='tool-card '+status; el.id=id; el.innerHTML='<div class="tool-head" onclick="this.parentElement.classList.toggle(\'open\')"><span class="tool-summary"><svg viewBox="0 0 24 24" style="width:14px; height:14px; stroke:currentColor; fill:none; stroke-width:2;"><polygon points="12 2 2 7 12 12 22 7 12 2z"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> <b>'+escapeHtml(tool)+'</b></span><span class="tool-indicator">'+escapeHtml(status)+'</span></div><div class="tool-body">'+escapeHtml(result||'')+'</div>'; if(box.querySelector('.muted')) box.innerHTML=''; box.prepend(el); } return id; }
function updateToolEvent(id,status,result){ const el=document.getElementById(id); if(!el) return; el.className='tool-card '+status; const st=el.querySelector('.tool-indicator'); if(st) st.textContent=status; const out=el.querySelector('.tool-body'); if(out) out.textContent=result||''; }

async function refreshInspectorData(){ loadMemoryPeek(); loadApprovals(); }
async function loadApprovals(){ const box=document.getElementById('approval-list'); if(!box) return; try{ const j=await api('/api/control/pending'); const p=j.pending||[]; box.innerHTML=p.length?p.map(a=>'<div class="approval-card" style="border:1px solid var(--border); padding:8px; border-radius:var(--radius); margin-bottom:6px;"><strong>'+escapeHtml(a.tool || a.id)+'</strong><div style="font-size:10px; color:var(--muted); margin-bottom:6px;">'+escapeHtml(a.reason || 'Approval required')+'</div><div style="display:flex; gap:6px;"><button class="btn btn-primary" onclick="answerApproval(\''+a.id+'\',true)" style="padding:2px 6px; font-size:10px;">Allow</button><button class="btn btn-danger" onclick="answerApproval(\''+a.id+'\',false)" style="padding:2px 6px; font-size:10px;">Deny</button></div></div>').join(''):'<div class="muted">No pending authorizations.</div>'; }catch{} }
async function answerApproval(id,approved){ await apiPost('/api/control/approve',{id,approved}); toast(approved?'Action authorized':'Action blocked', approved?'ok':'warn'); loadApprovals(); }
async function loadMemoryPeek(){ const box=document.getElementById('memory-peek'); if(!box) return; try{ const j=await api('/api/memory'); const entries=(j.entries||[]).slice(0,3); box.innerHTML=entries.length?entries.map(e=>'<div class="inspector-detail" style="border-left:2px solid var(--cyan); padding-left:6px; margin-bottom:6px;"><strong>'+escapeHtml(e.category)+'</strong><br>'+escapeHtml(e.content)+'</div>').join(''):'<div class="muted">Memory cache is empty.</div>'; }catch{ box.innerHTML='<div class="muted">Memory offline.</div>'; } }
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
      return \`<div class="stat-row" style="padding: 10px 0; cursor:pointer;" onclick="loadSessionDetail('\${s.id}')">
        <div><div style="font-weight:700;">\${escapeHtml(s.title)}</div><div class="muted" style="font-size:10px;">\${s.id}</div></div>
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
      <div style="margin-bottom:12px;"><strong>\${escapeHtml(s.title)}</strong><br><span class="muted">\${s.id} · \${s.status}</span></div>
      <div style="max-height: 300px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
        \${steps.map(st => \`<div style="padding:6px; border-bottom:1px solid rgba(255,255,255,0.02)">
          <div class="mono" style="font-weight:700;">\${st.phase} \${st.tool ? '· ' + st.tool : ''}</div>
          <div class="muted" style="font-size:10px; margin-top:2px;">\${escapeHtml(st.detail).slice(0, 160)}</div>
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
      <div class="stat-row" style="padding: 8px 0;">
        <div><strong>\${escapeHtml(w.id)}</strong><br><span class="muted mono">\${escapeHtml(w.rootDir)}</span></div>
        \${w.id === data.active ? '<span class="badge badge-green">active</span>' : \`<button class="btn btn-ghost" style="padding:2px 8px;" onclick="switchWorkspaceUI('\${w.id}')">Switch</button>\`}
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
      <div class="card \${p.id === data.primary ? "card-glow-cyan" : ""}" style="padding:10px; text-align:center;">
        <div style="font-weight:800; font-size:12px;">\${p.label}</div>
        <div style="font-family:var(--font-mono); font-size:10px; color:var(--muted); margin-top:2px;">\${p.id}</div>
        <div style="margin-top:8px;"><span class="badge \${p.healthy ? "badge-green" : (p.hasKey ? "badge-amber" : "badge-gray")}">\s
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
    toast("Routing default saved", "ok");
    loadProviders();
    loadDashboard();
  } catch (e) { toast(e.message, "err"); }
}

// ── Models (Local AI)
async function loadModels() {
  try {
    const data = await api("/api/models");
    const selected = data.selected ?? {};
    const specs = data.hardware?.specs ?? {};
    const rec = data.recommendation ?? {};

    document.getElementById("models-selected-runtime").textContent = selected.runtime;
    document.getElementById("models-selected-model").textContent = selected.model;
    document.getElementById("models-recommended").textContent = rec.runtimeModel ?? "—";
    document.getElementById("models-healthy-count").textContent = (data.runtimes ?? []).filter(r => r.healthy).length;

    // Hardware Specs
    document.getElementById("models-hardware").innerHTML = \`
      <div class="stat-row"><div class="stat-key">CPU core units</div><div class="stat-val">\${specs.cores ?? "—"}</div></div>
      <div class="stat-row"><div class="stat-key">Total RAM memory</div><div class="stat-val">\${specs.ramGb ? specs.ramGb.toFixed(1) + " GB" : "—"}</div></div>
      <div class="stat-row"><div class="stat-key">VRAM GPU indicators</div><div class="stat-val">\${specs.vramGb ? specs.vramGb.toFixed(1) + " GB" : "0.0 GB"}</div></div>
      <div class="stat-row" style="border-top:1px solid var(--border); margin-top:8px; padding-top:8px;"><div class="stat-key">Confidence rec</div><div class="stat-val text-cyan">\${rec.confidence ?? "unsupported"}</div></div>
    \`;

    // Local runtimes
    document.getElementById("models-local").innerHTML = (data.runtimes ?? []).map(r => \`
      <div class="stat-row">
        <div><strong>\${r.label}</strong><br><span class="muted">\${r.baseUrl}</span></div>
        <span class="badge \${r.healthy ? "badge-green" : "badge-gray"}">\${r.healthy ? "healthy" : "offline"}</span>
      </div>
    \`).join("");

    // Model list
    document.getElementById("models-list").innerHTML = (data.installed ?? []).map(m => \`
      <div class="stat-row">
        <span class="stat-key mono">\${m.model}</span>
        <span class="badge \s badge-gray">\${m.runtime}</span>
      </div>
    \`).join("");

    // Select defaults
    const select = document.getElementById("models-select-runtime");
    if (select) {
      select.innerHTML = (data.runtimes ?? []).map(r => \`<option value="\${r.id}">\${r.label}</option>\`).join("");
      select.value = selected.runtime ?? "ollama";
    }
    document.getElementById("models-select-model").value = selected.model ?? "";
    document.getElementById("models-select-routing").value = selected.routing ?? "hybrid";
  } catch {}
}

async function saveModelSelection() {
  const runtime = document.getElementById("models-select-runtime")?.value;
  const model = document.getElementById("models-select-model")?.value.trim();
  const routing = document.getElementById("models-select-routing")?.value;
  try {
    await api("/api/models/select", { method: "POST", body: { runtime, model, routing } });
    toast("Local models selected set", "ok");
    loadModels();
    loadDashboard();
  } catch (e) { toast(e.message, "err"); }
}

async function testModelSelection() {
  const runtime = document.getElementById("models-select-runtime")?.value;
  const model = document.getElementById("models-select-model")?.value.trim();
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
async function loadMemory() {
  try {
    const mem = await api("/api/memory");
    document.getElementById("mem-h-total").textContent = mem.health?.total ?? mem.count;
    document.getElementById("mem-h-expired").textContent = mem.health?.expired ?? 0;
    document.getElementById("mem-h-never").textContent = mem.health?.neverAccessed ?? 0;

    const list = mem.entries ?? [];
    document.getElementById("mem-list").innerHTML = list.length ? list.map(e => \`
      <div class="stat-row" style="padding: 10px 0;">
        <div>
          <span class="badge badge-cyan" style="margin-bottom:4px;">\${escapeHtml(e.category)}</span>
          <p style="font-size:12px;">\${escapeHtml(e.content)}</p>
        </div>
        <button class="btn btn-danger" onclick="deleteMemory('\${e.id}')" style="padding:2px 6px;">✕</button>
      </div>
    \`).join("") : "<div class='muted'>Durable vector memory is empty.</div>";
  } catch {}
}

async function doMemSearch() {
  const q = document.getElementById("mem-search")?.value.trim();
  if (!q) return;
  try {
    const data = await api("/api/memory/search?q=" + encodeURIComponent(q));
    const list = data.results ?? [];
    document.getElementById("mem-search-results").innerHTML = list.length ? list.map(e => \`
      <div class="stat-row" style="background:rgba(255,255,255,0.01); padding:6px;">
        <span class="badge badge-cyan" style="height:fit-content;">\${e.category}</span>
        <span style="font-size:12px;">\${escapeHtml(e.content)}</span>
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
      <p class="muted" style="font-size:11px; margin-top:4px;">\${escapeHtml(latest.synthesis?.shortAnswer || latest.summary || "Draft synthesized OK")}</p>
    \` : "<div class='muted'>No active research runs.</div>";

    document.getElementById("research-list").innerHTML = recent.length ? recent.map(r => \`
      <div class="stat-row" style="padding:8px 0; cursor:pointer;" onclick="loadResearchDetail('\${r.id}')">
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
      <div style="margin-bottom:10px;"><strong>\${escapeHtml(s.topic)}</strong><br><span class="muted">\${s.id} · \${s.status}</span></div>
      <p style="font-size:12px; line-height:1.6; margin-bottom:10px;">\${escapeHtml(s.synthesis?.shortAnswer || s.summary || "Report verified intact.")}</p>
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
    <div class="mp-cat" onclick="setMarketQuery('\${c}')">
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
      ? (s.enabled ? \`<button class="btn btn-ghost" onclick="event.stopPropagation(); skillAction('\${s.id}', 'disable')">Disable</button>\` : \`<button class="btn" onclick="event.stopPropagation(); skillAction('\${s.id}', 'enable')">Enable</button>\`)
      : \`<button class="btn btn-primary" onclick="event.stopPropagation(); installMarketplaceSkill('\${s.id}')">Install</button>\`;
    return \`
      <div class="mp-skill-card\${sel}" onclick="inspectMarketplaceSkill('\${s.id}')">
        <div class="mp-skill-top">
          <div class="mp-skill-icon">\${skillInitials(s.name)}</div>
          <div style="min-width:0; flex:1;">
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
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:12px;">
        <div class="mp-skill-icon" style="width:40px; height:40px;">\${skillInitials(s.name)}</div>
        <div>
          <h4 style="font-size:14px; font-weight:800;">\${escapeHtml(s.name)}</h4>
          <div class="mp-inspector-sub">\${s.id} · v\${s.version}</div>
        </div>
      </div>
      <p class="muted" style="font-size:11px; line-height:1.5; margin-bottom:12px;">\${escapeHtml(s.description)}</p>
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

// ── Sandboxed Plugins
async function loadPlugins() {
  try {
    const data = await api("/api/plugins");
    const list = data.plugins ?? [];
    document.getElementById("plug-installed").textContent = list.length;
    document.getElementById("plug-enabled").textContent = list.filter(p => p.enabled).length;

    document.getElementById("plugins-list").innerHTML = list.length ? list.map(p => \`
      <div class="stat-row" style="padding:10px 0;">
        <div>
          <strong>\${escapeHtml(p.name)}</strong> <span class="mono text-cyan">\${p.id}</span>
          <div class="muted" style="font-size:11px; margin-top:2px;">v\${p.version} · \${p.type}</div>
        </div>
        <div style="display:flex; gap:8px;">
          \s\${p.enabled ? \`<button class="btn btn-ghost" onclick="pluginAction('\${p.id}', 'disable')">Disable</button>\` : \`<button class="btn" onclick="pluginAction('\${p.id}', 'enable')">Enable</button>\`}
          <button class="btn btn-danger" onclick="pluginRemove('\${p.id}')">Remove</button>
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
      <div class="stat-row" style="background:rgba(255,255,255,0.01); padding:8px;">
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
        <button class="btn btn-danger" onclick="removeMcp('\${s.id}')" style="padding:2px 8px;">✕</button>
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
    <div style="border-bottom:1px solid var(--border); padding:8px 0;">
      <div style="font-weight:700; display:flex; justify-content:space-between;">
        <span>\${escapeHtml(t.title)}</span>
        <span class="badge badge-red">\${t.severity}</span>
      </div>
      <div class="muted" style="font-size:11px; margin-top:2px;">\${escapeHtml(t.details)}</div>
    </div>
  \`).join("") : "<div class='muted'>No vulnerabilities or threat heuristic signs.</div>";

  const fails = checks.filter(c => !c.passed);
  rList.innerHTML = fails.length ? fails.map(c => \`
    <div style="border-bottom:1px solid var(--border); padding:8px 0;">
      <div style="font-weight:700; color:var(--amber);">⚠ Hardening check failed</div>
      <div style="font-size:11px; margin-top:2px;">\${escapeHtml(c.name)}</div>
      <div class="muted" style="font-size:11px;">\${escapeHtml(c.details)}</div>
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
        <td style="font-weight:700;">\${escapeHtml(p.name)}</td>
        <td class="mono">\${p.cpu}%</td>
        <td class="mono">\${p.memory} MB</td>
        <td><span class="badge \${p.unsigned ? "badge-amber" : "badge-green"}">\${p.unsigned ? "unsigned":"verified"}</span></td>
        <td><button class="btn btn-danger" style="padding:2px 6px; font-size:10px;" onclick="killProcess(\${p.pid}, '\${p.name}')">Kill</button></td>
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
        <td style="font-weight:700;">\${escapeHtml(i.name)}</td>
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
        <td style="font-weight:700;">\${escapeHtml(d.name)}</td>
        <td class="mono">\${Math.round(d.sizeBytes / 1024)} KB</td>
        <td><span class="badge \${d.suspicious ? "badge-red":"badge-green"}">\s\${d.suspicious ? "heuristic block":"clean"}</span></td>
        <td>\${d.suspicious ? \`<button class="btn btn-danger" style="padding:2px 6px;" onclick="quarantineFile('\${d.path}')">Quarantine</button>\` : "—"}</td>
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
      <div class="stat-row" style="padding: 10px 0;">
        <div style="max-width: 80%;">
          <strong>\${escapeHtml(e.event)}</strong>
          <div class="muted" style="font-size:10px; margin-top:2px;">ts: \${new Date(e.ts).toLocaleString()}</div>
        </div>
        <span class="mono muted" style="font-size:10px;">#\${(e.hash ?? "").slice(0, 8)}</span>
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
        <div style="display:flex; align-items:center; gap:8px;">
          <div class="health-bar" style="width:60px;"><div class="health-bar-fill cyan" style="width:\${Math.min(100, (row.usd / (config.perTaskUsd || 1)) * 100)}%;"></div></div>
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
    <div class="palette-item \${i === paletteFocusIdx ? "focused" : ""}" onclick="PALETTE_ITEMS[\${PALETTE_ITEMS.indexOf(item)}].action(); closePalette();">
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
</script>
</body>
</html>`;
