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

  <!-- ── Sidebar Nav (24 elements structured) ───────────────────────────── -->
  <nav class="sidebar" aria-label="Mission navigation">
    <div class="sidebar-logo">
      <div class="logo-mark" aria-hidden="true">▀▄▀</div>
      <div class="logo-text-block">
        <span class="logo-text">XR Control</span>
        <span class="logo-sub">v3.1F OS</span>
      </div>
    </div>

    <!-- Group 1: Mission Hub -->
    <div class="sidebar-section">
      <div class="sidebar-label">Start</div>
      <button type="button" class="nav-item" data-panel="dashboard">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg></span>
        Home</button>
      <button type="button" class="nav-item active" data-panel="chat" aria-current="page">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
        Chat Sessions</button>
      <button type="button" class="nav-item" data-panel="sessions">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
        Recent Sessions</button>
      <button type="button" class="nav-item" data-panel="workspaces">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>
        Workspaces</button>
    </div>

    <!-- Group 2: AI Resources -->
    <div class="sidebar-section">
      <div class="sidebar-label">Ask</div>
      <button type="button" class="nav-item" data-panel="providers">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg></span>
        Providers (BYOK)</button>
      <button type="button" class="nav-item" data-panel="models">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg></span>
        Models (Local AI)</button>
      <button type="button" class="nav-item" data-panel="memory">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>
        Durable Memory</button>
      <button type="button" class="nav-item" data-panel="research">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zm20 0h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></span>
        Research Runs</button>
      <button type="button" class="nav-item" data-panel="voice">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></span>
        Voice Pipeline</button>
    </div>

    <!-- Group 3: Platforms & Tools -->
    <div class="sidebar-section">
      <div class="sidebar-label">Capabilities</div>
      <button type="button" class="nav-item" data-panel="skills">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 8v8"/><path d="M8 12h8"/></svg></span>
        Skills Marketplace</button>
      <button type="button" class="nav-item" data-panel="plugins">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>
        Sandboxed Plugins</button>
      <button type="button" class="nav-item" data-panel="capabilities">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/></svg></span>
        Capability Ecosystem</button>
      <button type="button" class="nav-item" data-panel="mcp">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></span>
        MCP Servers</button>
      <button type="button" class="nav-item" data-panel="business">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
        Business OS CRM</button>
    </div>

    <!-- Group 4: Governance & Trust -->
    <div class="sidebar-section">
      <div class="sidebar-label">Guard</div>
      <button type="button" class="nav-item" data-panel="control">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>
        Computer Control</button>
      <button type="button" class="nav-item" data-panel="shield">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
        Shield (Security)</button>
      <button type="button" class="nav-item" data-panel="audit">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></span>
        Audit Log</button>
      <button type="button" class="nav-item" data-panel="budget">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span>
        Cost & Budget</button>
      <button type="button" class="nav-item" data-panel="files">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg></span>
        Files & Artifacts</button>
      <button type="button" class="nav-item" data-panel="downloads">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>
        Downloads Security</button>
      <button type="button" class="nav-item" data-panel="devices">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></span>
        Devices Link</button>
    </div>

    <!-- Group 5: Core Services -->
    <div class="sidebar-section">
      <div class="sidebar-label">System</div>
      <button type="button" class="nav-item" data-panel="automation">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
        Scheduled Tasks</button>
      <button type="button" class="nav-item" data-panel="integrations">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>
        Webhooks API</button>
      <button type="button" class="nav-item" data-panel="notifications">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
        Alerts Hub</button>
      <button type="button" class="nav-item" data-panel="settings">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
        Core Settings</button>
      <button type="button" class="nav-item" data-panel="about">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></span>
        About Build</button>
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
        <span>Press <span class="mono xr-s-3">?</span> for command search</span>
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
        <span id="breadcrumb-active" class="xr-s-4" aria-current="page">Chat Sessions</span>
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
