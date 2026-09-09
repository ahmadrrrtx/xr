/**
 * XR Control Center served-page fragment — document head, palette, app shell, sidebar, topbar.
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const PAGE_HEAD = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>XR — Mission Control</title>
<link rel="stylesheet" href="/assets/dashboard.css">
</head>
<body data-route="home">

<!-- Phase 8 · T3 — skip link: first tab stop lands directly on main content (WCAG 2.4.1) -->
<a class="skip-link" href="#main-content">Skip to main content</a>

<!-- ── Toast Stack (live region: polite status; errors carry role=alert) ── -->
<div class="toast-wrap" id="toasts" role="status" aria-live="polite" aria-atomic="false"></div>

<!-- ── Global Command Palette ───────────────────────────────────────────── -->
<div class="palette-bg" id="palette" aria-hidden="true">
  <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="palette-input">
      <svg aria-hidden="true" focusable="false"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
      <input id="palette-search" placeholder="Search sections, settings, skills..." autocomplete="off" aria-label="Command search"
        role="combobox" aria-expanded="true" aria-controls="palette-results" aria-activedescendant=""/>
    </div>
    <div class="palette-results" id="palette-results" role="listbox" aria-label="Commands"></div>
  </div>
</div>

<!-- ── App Layout Frame ─────────────────────────────────────────────────── -->
<div class="app">

  <!-- ── Sidebar Nav — 9 areas; secondary views are tab strips inside each
       section panel (all panel ids + loaders keep working) ─────────────── -->
  <nav class="sidebar" aria-label="Mission navigation">
    <div class="sidebar-logo">
      <div class="logo-mark" aria-hidden="true">▀▄▀</div>
      <div class="logo-text-block">
        <span class="logo-text">XR Control</span>
        <span class="logo-sub">v3.1F OS</span>
      </div>
    </div>

    <!-- Group 1: daily operation -->
    <div class="sidebar-section">
      <div class="sidebar-label">Workspace</div>
      <button type="button" class="nav-item" data-panel="dashboard" data-section="home">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg></span>
        Home</button>
      <button type="button" class="nav-item active" data-panel="chat" data-section="chat" aria-current="page">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
        Chat</button>
      <button type="button" class="nav-item" data-panel="sessions" data-section="runs">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
        Runs</button>
      <button type="button" class="nav-item" data-panel="agents" data-section="agents">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1"/></svg></span>
        Agents</button>
    </div>

    <!-- Group 2: capability & knowledge surfaces -->
    <div class="sidebar-section">
      <div class="sidebar-label">Resources</div>
      <button type="button" class="nav-item" data-panel="providers" data-section="models">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg></span>
        Models</button>
      <button type="button" class="nav-item" data-panel="skills" data-section="extensions">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>
        Extensions</button>
      <button type="button" class="nav-item" data-panel="memory" data-section="memory">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>
        Memory</button>
    </div>

    <!-- Group 3: governance & configuration -->
    <div class="sidebar-section">
      <div class="sidebar-label">Trust</div>
      <button type="button" class="nav-item" data-panel="approvals" data-section="guardrails">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg></span>
        Guardrails<span class="nav-badge" id="nav-approvals-badge" hidden></span></button>
      <button type="button" class="nav-item" data-panel="settings" data-section="settings">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
        Settings</button>
    </div>

    <div class="sidebar-spacer"></div>

    <!-- Provider chip lockup — always shows active model; click to change -->
    <div class="sidebar-footer">
      <div class="provider-pill" id="sidebar-provider" data-xr-action="navigateTo('models')" title="Active model — click to Change model">
        <div class="provider-dot" id="provider-dot"></div>
        <span id="sidebar-provider-text" class="truncate">loading…</span>
        <span class="locality-badge" id="sidebar-locality" hidden></span>
      </div>
      <div class="sidebar-hint xr-s-1">
        <button class="btn btn-ghost xr-s-2" data-xr-action="navigateTo('models'); setTimeout(focusChangeModel, 50);">Change model</button>
        <span>Press <span class="mono xr-s-3">?</span> for search · <span class="mono xr-s-3">g</span> then a key jumps areas</span>
      </div>
    </div>
  </nav>

  <!-- ── Main Control Window Frame ──────────────────────────────────────── -->
  <main class="main" id="main-content" tabindex="-1">

    <!-- Top Breadcrumbs Status Strip -->
    <header class="topbar">
      <button type="button" class="btn btn-ghost xr-sidebar-toggle" data-xr-action="toggleSidebar()" id="sidebar-toggle-btn" aria-label="Toggle sidebar" aria-pressed="false" title="Collapse the sidebar">
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="15" height="15"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></svg>
      </button>
      <nav class="breadcrumbs" id="topbar-breadcrumbs" aria-label="Breadcrumb">
        <a href="#home" data-xr-action="navigateTo('dashboard')">XR Control</a>
        <span aria-hidden="true">›</span>
        <span id="breadcrumb-active" class="xr-s-4" aria-current="page">Chat</span>
      </nav>
      <div class="topbar-spacer"></div>
      <div class="topbar-status">
        <button type="button" class="status-chip" id="chip-provider" data-xr-action="navigateTo('models')" title="Active model — activate to change"><div class="dot" aria-hidden="true"></div><span id="chip-provider-label">—</span></button>
        <span class="status-chip" id="chip-locality" role="status" title="Where this route runs — local, cloud, or offline"><span id="chip-locality-label">—</span></span>
        <button type="button" class="status-chip" id="chip-audit" data-xr-action="navigateTo('audit')" title="Audit chain status — activate to open audit log"><div class="dot" aria-hidden="true"></div><span id="chip-audit-label">Audit</span></button>
        <button type="button" class="status-chip" id="chip-budget" data-xr-action="navigateTo('budget')" title="Budget status — activate to open budget"><div class="dot" aria-hidden="true"></div><span id="chip-budget-label">Budget</span></button>
        <button type="button" class="btn xr-s-5" data-xr-action="openPalette()" aria-label="Open command palette (Ctrl+K)">⌘K</button>
      </div>
    </header>

    <!-- Content panels -->
    <div class="content">

`;
