/**
 * XR Control Center — document template
 *
 * Phase 2 · T7. `src/daemon/dashboard.ts` was 3 619 lines — 4.5x the 800-line
 * threshold and by far XR's largest module: one function returning one template
 * literal that held the stylesheet, the markup AND the whole client-side
 * application, so a CSS tweak and a client-logic change touched the same file.
 *
 * Owns the HTML SHELL and the placeholder tokens (__TOKEN__, __XR_VERSION__, ...) that dashboardHtml() substitutes; styles and script compose in from their own modules.
 *
 * Mechanical and behaviour-preserving: the composed document is byte-identical
 * to the pre-split output (test/daemon/dashboard-split.test.ts pins the
 * SHA-256). The fragments below are stored exactly as they appeared in the
 * original template literal — already escaped for that context — so they are
 * re-embedded in a template literal unchanged.
 */


/** The document template, placeholders unsubstituted. */
export const DASHBOARD_PAGE = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>XR — Mission Control</title>
<link rel="stylesheet" href="/assets/dashboard.css">
</head>
<body>

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
      <div class="sidebar-label">Mission Hub</div>
      <button type="button" class="nav-item active" data-panel="dashboard" aria-current="page">
        <span class="nav-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg></span>
        Home</button>
      <button type="button" class="nav-item" data-panel="chat">
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
      <div class="sidebar-label">AI Resources</div>
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
      <div class="sidebar-label">Platforms & Tools</div>
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
      <div class="sidebar-label">Governance & Trust</div>
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
      <div class="sidebar-label">Core Services</div>
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
      <nav class="breadcrumbs" id="topbar-breadcrumbs" aria-label="Breadcrumb">
        <a href="#home" data-xr-action="navigateTo('dashboard')">XR Control</a>
        <span aria-hidden="true">›</span>
        <span id="breadcrumb-active" class="xr-s-4" aria-current="page">Home</span>
      </nav>
      <div class="topbar-spacer"></div>
      <div class="topbar-status">
        <button type="button" class="status-chip" id="chip-provider" data-xr-action="navigateTo('models')" title="Active model — activate to change"><div class="dot" aria-hidden="true"></div><span id="chip-provider-label">—</span></button>
        <button type="button" class="status-chip" id="chip-audit" data-xr-action="navigateTo('audit')" title="Audit chain status — activate to open audit log"><div class="dot" aria-hidden="true"></div><span id="chip-audit-label">Audit</span></button>
        <button type="button" class="status-chip" id="chip-budget" data-xr-action="navigateTo('budget')" title="Budget status — activate to open budget"><div class="dot" aria-hidden="true"></div><span id="chip-budget-label">Budget</span></button>
        <button type="button" class="btn xr-s-5" data-xr-action="openPalette()" aria-label="Open command palette (Ctrl+K)">⌘K</button>
      </div>
    </header>

    <!-- Content panels -->
    <div class="content">

      <!-- Panel 1: Overview (Home) -->
      <div class="panel active" tabindex="-1" id="panel-dashboard">
        <div class="section-header">
          <div>
            <h1>Overview</h1>
            <div class="section-sub">XR Operating Console — <span id="dash-project" class="mono">loading…</span></div>
          </div>
          <button class="btn" data-xr-action="refreshAll()">↻ Refresh state</button>
        </div>

        <div class="grid grid-4 xr-s-6">
          <div class="card card-glow-cyan">
            <div class="card-header"><span class="card-title">Spent Today</span><span class="card-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span></div>
            <div class="card-value" id="d-spent">$0.0000</div>
            <div class="card-sub" id="d-tokens">0 tokens processed</div>
          </div>
          <div class="card card-glow-green">
            <div class="card-header"><span class="card-title">Security EDR</span><span class="card-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span></div>
            <div class="card-value" id="d-sec-score">0%</div>
            <div class="card-sub">Dojo injection block-rate</div>
          </div>
          <div class="card card-glow-green">
            <div class="card-header"><span class="card-title">Protection Log</span><span class="card-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span></div>
            <div class="card-value" id="d-shield-health">Safe</div>
            <div class="card-sub" id="d-shield-scans">EDR Scan passed</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Immutable Ledger</span><span class="card-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span></div>
            <div class="card-value" id="d-audit-val">—</div>
            <div class="card-sub" id="d-audit-entries">checking ledger…</div>
          </div>
        </div>

        <h2 class="xr-s-7">System Health Bento Matrix</h2>
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

        <div class="grid grid-2 xr-s-8">
          <div class="card">
            <div class="card-header"><span class="card-title">Recent Activity Logs</span></div>
            <div id="d-audit-list"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Operating Context</span></div>
            <div id="dash-hardware-summary" class="muted xr-s-9">loading hardware specs...</div>
          </div>
        </div>
      </div>

      <!-- Panel 2: Chat Sessions (Universal Workspace) -->
      <div class="panel xr-s-10" tabindex="-1" id="panel-chat">
        <div class="chat-wrap">
          <!-- Chat sidebar -->
          <aside class="chat-sidebar">
            <div class="chat-side-header">
              <div class="chat-side-title-row">
                <span class="chat-side-title">Sessions Feed</span>
                <button class="btn btn-ghost xr-s-11" data-xr-action="chatNewChat()">＋ New</button>
              </div>
              <input id="chat-search" class="chat-search-input" placeholder="Search sessions..." aria-label="Search chat sessions"/>
            </div>
            <div class="chat-sessions-list" id="chat-list"></div>
          </aside>

          <!-- Chat main window -->
          <div class="chat-main">
            <header class="chat-top">
              <div class="xr-s-12">◈</div>
              <div class="chat-title-block">
                <div class="chat-header-title" id="chat-title">Universal Composer</div>
                <div class="chat-header-model" id="chat-model-label">local-first · BYOK</div>
              </div>
              <div class="chat-status-row" id="chat-status-row"></div>
              <div class="topbar-spacer"></div>
              <button class="btn btn-ghost" data-xr-action="chatTogglePin()" id="chat-pin-btn">Pin</button>
              <button class="btn btn-ghost" data-xr-action="chatBranchFromLast()">Branch</button>
              <button class="btn btn-ghost" data-xr-action="chatExportActive()">Export</button>
              <button class="btn btn-danger" data-xr-action="chatArchiveActive()">Archive</button>
            </header>

            <div class="chat-messages" id="chat-messages" role="log"></div>

            <footer class="chat-composer" id="composer-drop-zone">
              <div class="composer-card">
                <div class="composer-context" id="composer-context"></div>
                <div class="attachment-row" id="attachment-row"></div>
                <div class="composer-input-row">
                  <textarea id="chat-input" placeholder="Ask XR anything... /for commands, @for context" rows="1" aria-label="Message XR — press Enter to send, Shift+Enter for a new line"></textarea>
                  <button class="composer-send" id="chat-send-btn" data-xr-action="sendChatMessage()" aria-label="Send message" title="Send message">
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                  </button>
                </div>
                <div class="composer-tools-row">
                  <button class="composer-tool-btn" data-xr-action="openAttachmentPicker()"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> ＋ Attach file</button>
                  <input id="chat-file-input" type="file" multiple class="xr-s-13" aria-label="Attach files to this message">
                  <button class="composer-flag-chip memory" data-xr-action="toggleComposerFlag('memory')">🧠 Memory</button>
                  <button class="composer-flag-chip research" data-xr-action="toggleComposerFlag('research')">🔬 Research</button>
                  <button class="composer-flag-chip shield" data-xr-action="toggleComposerFlag('shield')">🛡 Shield</button>
                  <button class="composer-flag-chip computer" data-xr-action="toggleComposerFlag('computer')">⌁ Control</button>
                  <button class="composer-flag-chip mode" data-xr-action="cycleChatMode()" id="mode-chip">Mode: Ask</button>
                  <span class="composer-tip"><span class="kbd">Esc</span> interrupt · <span class="kbd">/</span> commands</span>
                </div>
              </div>
            </footer>
          </div>

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
      <div class="panel" tabindex="-1" id="panel-sessions">
        <div class="section-header">
          <div><h1>Recent Sessions</h1><div class="section-sub">Chronological task logs and history database</div></div>
          <button class="btn" data-xr-action="loadSessionsPanel()">↻ Refresh</button>
        </div>
        <div class="grid grid-4 xr-s-6">
          <div class="card"><div class="card-title">Total sessions</div><div class="card-value" id="sess-count-total">0</div></div>
          <div class="card"><div class="card-title">Running jobs</div><div class="card-value" id="sess-count-running">0</div></div>
          <div class="card"><div class="card-title">Completed done</div><div class="card-value" id="sess-count-done">0</div></div>
          <div class="card"><div class="card-title">Research runs</div><div class="card-value" id="sess-count-research">0</div></div>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">Select session</span></div>
            <div id="sess-list" class="xr-s-14"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Session Step Inspector</span></div>
            <div id="sess-detail" class="muted">Select a session to parse steps.</div>
          </div>
        </div>
      </div>

      <!-- Panel 4: Workspaces switcher -->
      <div class="panel" tabindex="-1" id="panel-workspaces">
        <div class="section-header">
          <div><h1>Workspaces Switcher</h1><div class="section-sub">Isolate databases, memory vectors, and project trees</div></div>
          <button class="btn" data-xr-action="loadWorkspaces()">↻ Refresh</button>
        </div>
        <div class="grid grid-2 xr-s-6">
          <div class="card">
            <div class="card-header"><span class="card-title">Active workspace</span></div>
            <div class="card-value" id="ws-active">default</div>
            <div class="card-sub" id="ws-active-path">/home/user</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Create new workspace</span></div>
            <div class="xr-s-15">
              <input id="ws-create-id" class="input" placeholder="Workspace ID (alphanumeric)" aria-label="Workspace ID (alphanumeric)" />
              <input id="ws-create-name" class="input" placeholder="Optional display name" aria-label="Workspace display name (optional)" />
              <button class="btn btn-primary xr-s-16" data-xr-action="createWorkspace()">Create workspace</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Registered Directories</span></div>
          <div id="ws-list"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Panel 5: Providers (BYOK) -->
      <div class="panel" tabindex="-1" id="panel-providers">
        <div class="section-header">
          <div><h1>Cloud Providers (BYOK)</h1><div class="section-sub">Set primary/fallback routes — never stuck on the default model</div></div>
          <div class="xr-s-17">
            <button class="btn btn-primary" data-xr-action="document.getElementById('prov-set-provider')?.focus()">Change model</button>
            <button class="btn btn-ghost" data-xr-action="navigateTo('models')">Local Models</button>
          </div>
        </div>
        <div class="card xr-s-6">
          <div class="card-header"><span class="card-title">Routing policy</span></div>
          <div id="prov-routing"><div class="spinner"></div></div>
        </div>
        <div class="card xr-s-6">
          <div class="card-header"><span class="card-title">Set active routes</span></div>
          <div class="grid grid-2 xr-s-7">
            <div>
              <label>Default provider
                <select id="prov-set-provider" aria-label="Primary provider"></select>
              </label>
              <label>Default model name
                <input id="prov-set-model" class="input" placeholder="e.g. gpt-4" aria-label="Primary model" />
              </label>
            </div>
            <div>
              <label>Fallback provider
                <select id="prov-set-fallback" aria-label="Fallback provider (optional)"></select>
              </label>
              <label>Fallback model name
                <input id="prov-set-fallback-model" class="input" placeholder="e.g. llama3" aria-label="Fallback model (optional)" />
              </label>
            </div>
          </div>
          <button class="btn btn-primary" data-xr-action="saveProviderRouting()">Save Routing Policy</button>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Available preset providers</span></div>
          <div class="grid grid-4" id="prov-grid"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Panel 6: Models (Local AI) -->
      <div class="panel" tabindex="-1" id="panel-models">
        <div class="section-header">
          <div>
            <h1>Models (Local AI)</h1>
            <div class="section-sub">Change model anytime — never stuck on the onboarding default</div>
          </div>
          <div class="xr-s-18">
            <button class="btn btn-primary" data-xr-action="focusChangeModel()" title="Jump to Change model form">Change model</button>
            <button class="btn" data-xr-action="loadModels()">↻ Refresh</button>
          </div>
        </div>

        <!-- Always-visible active model strip -->
        <div class="card xr-s-19" id="models-active-strip">
          <div class="card-header xr-s-20">
            <span class="card-title">Active model</span>
            <span class="badge badge-green" id="models-active-badge">primary</span>
          </div>
          <div class="xr-s-21">
            <div>
              <div class="card-value mono xr-s-12" id="models-active-display">— / —</div>
              <div class="muted xr-s-22" id="models-active-sub">Primary route used by Shell, CLI, and Chat Workspace</div>
            </div>
            <div class="xr-s-23">
              <button class="btn btn-primary" data-xr-action="focusChangeModel()">Change model</button>
              <button class="btn btn-ghost" data-xr-action="navigateTo('providers')">Open Providers</button>
              <button class="btn btn-ghost" data-xr-action="testModelSelection()">Smoke test</button>
            </div>
          </div>
          <div class="muted xr-s-24">
            CLI: <span class="mono xr-s-25">xr providers set &lt;id&gt; [model]</span>
            · <span class="mono xr-s-25">xr models set &lt;runtime&gt; &lt;model&gt;</span>
            · Shell: <span class="mono xr-s-25">Alt+P</span> or <span class="mono xr-s-25">/model</span>
          </div>
        </div>

        <div class="grid grid-4 xr-s-6">
          <div class="card"><div class="card-title">Selected runtime</div><div class="card-value" id="models-selected-runtime">Ollama</div></div>
          <div class="card"><div class="card-title">Active local model</div><div class="card-value" id="models-selected-model">—</div></div>
          <div class="card"><div class="card-title">Hardware recommendation</div><div class="card-value" id="models-recommended">—</div></div>
          <div class="card"><div class="card-title">Healthy runtimes</div><div class="card-value" id="models-healthy-count">0</div></div>
        </div>
        <div class="grid grid-2 xr-s-6">
          <div class="card" id="models-change-card">
            <div class="card-header"><span class="card-title">Change model</span></div>
            <div class="xr-s-26">
              <label>Runtime engine
                <select id="models-select-runtime" aria-label="Local runtime"></select>
              </label>
              <label>Model tag ID
                <input id="models-select-model" class="input" placeholder="e.g. qwen2.5:7b" aria-label="Model tag" />
              </label>
              <label>Routing mode
                <select id="models-select-routing" aria-label="Routing strategy">
                  <option value="local-only">local-only (strict private)</option>
                  <option value="hybrid">hybrid (Ollama fallback to Cloud)</option>
                  <option value="cloud-first">cloud-first (cloud default, local backup)</option>
                </select>
              </label>
              <div class="xr-s-23">
                <button class="btn btn-primary" data-xr-action="saveModelSelection()">Save &amp; apply model</button>
                <button class="btn btn-ghost" data-xr-action="testModelSelection()">Smoke test model latency</button>
              </div>
              <div class="muted xr-s-27">
                Saving updates local selection and routing. For cloud primary routes, also use
                <a href="#providers" data-xr-action="navigateTo('providers'); return false;" class="xr-s-25">Providers → Save Routing Policy</a>.
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
            <div class="card-header"><span class="card-title">Downloaded model list</span><span class="muted xr-s-27">Click a model to select it</span></div>
            <div id="models-list" class="xr-s-28"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Panel 7: Durable Memory -->
      <div class="panel" tabindex="-1" id="panel-memory">
        <div class="section-header">
          <div><h1>Durable Memory</h1><div class="section-sub">Local vector search memory browser (records only what you ask it to remember)</div></div>
          <button class="btn btn-danger" data-xr-action="clearMemory()">Purge Memory</button>
        </div>
        <div class="grid grid-3 xr-s-6">
          <div class="card"><div class="card-title">Total memory entries</div><div class="card-value" id="mem-h-total">0</div></div>
          <div class="card"><div class="card-title">Expired entries</div><div class="card-value" id="mem-h-expired">0</div></div>
          <div class="card"><div class="card-title">Unused never recalled</div><div class="card-value" id="mem-h-never">0</div></div>
        </div>
        <!-- XR 4.5 — consent disclosure. Progressive: counts here, full
             provenance via the 'xr context inspect' command. -->
        <div class="grid grid-3 xr-s-6">
          <div class="card"><div class="card-title">Approved by you</div><div class="card-value" id="mem-c-approved">0</div></div>
          <div class="card"><div class="card-title">Awaiting your decision</div><div class="card-value" id="mem-c-proposed">0</div></div>
          <div class="card"><div class="card-title">Legacy consent unknown</div><div class="card-value" id="mem-c-legacy">0</div></div>
        </div>
        <div class="card xr-s-29" id="mem-pending-card">
          <div class="card-header"><span class="card-title">Awaiting your decision</span></div>
          <div class="muted xr-s-30">
            XR will not use these until you approve them. Nothing self-approves.
          </div>
          <div id="mem-pending-list"></div>
        </div>
        <div class="card xr-s-6">
          <div class="card-header"><span class="card-title">Search memory ledger</span></div>
          <div class="xr-s-17">
            <input id="mem-search" class="input" placeholder="Query semantic nodes (e.g. prefer typescript)" aria-label="Query semantic memory nodes" />
            <button class="btn btn-primary" data-xr-action="doMemSearch()">Search</button>
          </div>
          <div id="mem-search-results" class="xr-s-31"></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Durable entries</span></div>
          <div id="mem-list"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Panel 8: Research Runs -->
      <div class="panel" tabindex="-1" id="panel-research">
        <div class="section-header">
          <div><h1>Research Runs</h1><div class="section-sub">Citation-aware deep search and report synthesis console</div></div>
          <button class="btn" data-xr-action="loadResearchPanel()">↻ Refresh</button>
        </div>
        <div class="grid grid-4 xr-s-6">
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
            <div id="research-list" class="xr-s-14"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Panel 9: Voice Pipeline -->
      <div class="panel" tabindex="-1" id="panel-voice">
        <div class="section-header">
          <div><h1>Voice Pipeline</h1><div class="section-sub">Wakeword detectors, TTS vocal synthesis, and hardware controls</div></div>
        </div>
        <div class="card xr-s-6">
          <div class="xr-s-32">
            <span class="xr-s-33">🎤</span>
            <h2>Voice Control Gating</h2>
            <p class="muted xr-s-34">
              Voice capability operates completely locally by default. Wake words run local heuristic detection to prevent persistent network listening.
            </p>
            <div class="xr-s-35">
              <button class="btn btn-primary" data-xr-action="toast('Voice activated. Microphone on hold-to-talk mode.', 'ok')">Enable Voice</button>
              <button class="btn btn-ghost" data-xr-action="toast('Running Voice Loop smoke test... output OK', 'ok')">Test loop latency</button>
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
      <div class="panel" tabindex="-1" id="panel-skills">
        <div class="mp-hero">
          <div class="mp-hero-grid">
            <div>
              <div class="mp-kicker">🧩 App Store Skills Catalog</div>
              <div class="mp-title">Inject expertise like <span>hiring specialists</span></div>
              <p class="mp-sub">Expand your AI capabilities with signed package skill structures. Review permissions and dependency chains before enabling.</p>
              <div class="mp-search-row">
                <input id="market-search" class="mp-search" placeholder="Search React developer, security analyst, patent research..." aria-label="Search the skills marketplace" />
                <button class="btn btn-primary" data-xr-action="loadMarketplace()">Search Catalog</button>
                <button class="btn btn-ghost" data-xr-action="syncMarketplace()">Sync Registries</button>
              </div>
              <div class="mp-filter-row" id="market-filter-row">
                <button class="mp-chip active" data-market-filter="all" data-xr-action="setMarketFilter('all')">All Skills</button>
                <button class="mp-chip" data-market-filter="installed" data-xr-action="setMarketFilter('installed')">Installed</button>
                <button class="mp-chip" data-market-filter="verified" data-xr-action="setMarketFilter('verified')">Official/Verified</button>
                <button class="mp-chip" data-market-filter="updates" data-xr-action="setMarketFilter('updates')">Updates ready</button>
              </div>
            </div>
            <div class="mp-brand-orb">
              <div class="mp-orbit"></div>
              <img class="mp-logo-img" src="__XR_LOGO__" alt="XR logo"/>
              <img class="mp-avatar-img" src="__XR_AVATAR__" alt="XR avatar"/>
            </div>
          </div>
        </div>

        <div class="grid grid-4 xr-s-6">
          <div class="card"><div class="card-title">Installed local packs</div><div class="card-value" id="market-installed">0</div></div>
          <div class="card"><div class="card-title">Verified publishers</div><div class="card-value" id="market-verified">0</div></div>
          <div class="card"><div class="card-title">Updates available</div><div class="card-value" id="market-updates">0</div></div>
          <div class="card"><div class="card-title">Sandbox indexes</div><div class="card-value" id="market-runtime">OK</div></div>
        </div>

        <div class="mp-shell">
          <aside class="mp-card mp-side">
            <div class="mp-section-title">Filter by domains</div>
            <div id="market-categories"></div>
            <div class="mp-section-title xr-s-36">Quick categories</div>
            <div class="mp-cat" data-xr-action="setMarketQuery('security soci alert')"><b>🛡 Security Ops</b></div>
            <div class="mp-cat" data-xr-action="setMarketQuery('developer python react')"><b>⌘ Software suite</b></div>
            <div class="mp-cat" data-xr-action="setMarketQuery('research academic citation')"><b>🔬 Deep Research</b></div>
          </aside>
          <div class="mp-main">
            <div class="mp-tabs">
              <button class="mp-tab active" data-market-sort="relevance" data-xr-action="setMarketSort('relevance')">Recommended</button>
              <button class="mp-tab" data-market-sort="trending" data-xr-action="setMarketSort('trending')">Popularity</button>
              <button class="mp-tab" data-market-sort="updated" data-xr-action="setMarketSort('updated')">Latest</button>
            </div>
            <div id="market-grid" class="mp-grid"><div class="spinner"></div></div>
          </div>
          <aside class="mp-card mp-inspector">
            <div class="mp-section-title">Selected Skill Inspector</div>
            <div id="market-inspector"><div class="mp-panel-empty">Click any card to inspect dependency trees, commands, and security permissions reasons.</div></div>
          </aside>
        </div>
      </div>

      <!-- Panel 11: Sandboxed Plugins -->
      <div class="panel" tabindex="-1" id="panel-plugins">
        <div class="section-header">
          <div><h1>Sandboxed Plugins</h1><div class="section-sub">Code integrations with custom permissions limits</div></div>
          <button class="btn" data-xr-action="loadPlugins()">↻ Refresh</button>
        </div>
        <div class="grid grid-3 xr-s-6">
          <div class="card"><div class="card-title">Installed plugins</div><div class="card-value" id="plug-installed">0</div></div>
          <div class="card"><div class="card-title">Active Enabled</div><div class="card-value" id="plug-enabled">0</div></div>
          <div class="card"><div class="card-title">Security status</div><div class="card-value text-green" id="plug-health">Verified</div></div>
        </div>
        <div class="card xr-s-6">
          <div class="card-header"><span class="card-title">Active Plugins List</span></div>
          <div id="plugins-list"><div class="spinner"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Install Plugins</span></div>
          <div class="xr-s-37">
            <input id="plugin-search" class="input" placeholder="Query integrations catalogue..." aria-label="Query the integrations catalogue" />
            <button class="btn btn-primary" data-xr-action="searchPlugins()">Query Catalogue</button>
          </div>
          <div id="plugins-catalog"><div class="muted">Query plugins list above or install using terminal command: <code class="mono text-cyan">xr plugins install ./plugin_folder</code></div></div>
        </div>
      </div>

      <!-- Panel 12: Capability Ecosystem -->
      <div class="panel" tabindex="-1" id="panel-capabilities">
        <div class="section-header">
          <div><h1>Capability Ecosystem</h1><div class="section-sub">Common descriptors, provenance, permissions, certification, quarantine and rollback</div></div>
          <button class="btn" data-xr-action="loadCapabilities()">↻ Refresh</button>
        </div>
        <div class="grid grid-4 xr-s-6">
          <div class="card"><div class="card-title">Total</div><div class="card-value" id="cap-total">0</div></div>
          <div class="card"><div class="card-title">Enabled</div><div class="card-value" id="cap-enabled">0</div></div>
          <div class="card"><div class="card-title">Certified</div><div class="card-value text-green" id="cap-certified">0</div></div>
          <div class="card"><div class="card-title">Quarantined</div><div class="card-value text-amber" id="cap-quarantined">0</div></div>
        </div>
        <div class="card xr-s-6">
          <div class="card-header"><span class="card-title">Discovery by task / trust constraints</span></div>
          <div class="xr-s-37">
            <input id="cap-search" class="input" placeholder="e.g. summarize repository, send email, local OCR" aria-label="Search capabilities" />
            <button class="btn btn-primary" data-xr-action="loadCapabilities(true)">Discover</button>
          </div>
          <div class="muted">Evidence-weighted ranking only — no popularity-only trust score.</div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Capabilities</span></div>
          <div id="capabilities-list"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Panel 13: MCP Servers -->
      <div class="panel" tabindex="-1" id="panel-mcp">
        <div class="section-header">
          <div><h1>Model Context Protocol (MCP)</h1><div class="section-sub">Add external server toolkits (Github, Postgres, etc)</div></div>
          <button class="btn" data-xr-action="loadMcp()">↻ Refresh</button>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><span class="card-title">Register MCP Server</span></div>
            <div class="xr-s-15">
              <input id="mcp-create-id" class="input" placeholder="Server ID (e.g. github)" aria-label="MCP server ID" />
              <input id="mcp-create-cmd" class="input" placeholder="Execution command (e.g. npx)" aria-label="MCP server execution command" />
              <input id="mcp-create-args" class="input" placeholder="Arguments (e.g. -y @modelcontextprotocol/server-github)" aria-label="MCP server arguments" />
              <button class="btn btn-primary xr-s-16" data-xr-action="registerMcp()">Add MCP Server</button>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Active MCP Connections</span></div>
            <div id="mcp-servers-list"><div class="muted">No MCP servers registered. Use the configuration terminal or add a preset command.</div></div>
          </div>
        </div>
      </div>

      <!-- Panel 13: Business OS CRM -->
      <div class="panel" tabindex="-1" id="panel-business">
        <div class="section-header">
          <div><h1>Business OS CRM</h1><div class="section-sub">Enterprise metrics automation, CRM assistant logs, and financial flows</div></div>
        </div>
        <div class="grid grid-4 xr-s-6">
          <div class="card"><div class="card-title">Customer Pipelines</div><div class="card-value">12</div><div class="card-sub">Active CRM accounts</div></div>
          <div class="card"><div class="card-title">Invoices audited</div><div class="card-value">$4,850</div><div class="card-sub">Automated monthly audit</div></div>
          <div class="card"><div class="card-title">Workflows triggered</div><div class="card-value">84</div><div class="card-sub">Cron scheduler jobs</div></div>
          <div class="card"><div class="card-title">Skill integrations</div><div class="card-value text-cyan">Healthy</div><div class="card-sub">CRM Assistant active</div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Business modules integration</span></div>
          <p class="muted xr-s-7">
            Business OS CRM features run inside XR using dedicated Enterprise Skill Packs. Activate the matching skill sets inside the Skills Marketplace to enable.
          </p>
          <button class="btn btn-primary" data-xr-action="setMarketQuery('business crm'); navigateTo('skills');">Browse CRM Skill Packs</button>
        </div>
      </div>

      <!-- Panel 14: Computer Control -->
      <div class="panel" tabindex="-1" id="panel-control">
        <div class="section-header">
          <div><h1>Computer Control</h1><div class="section-sub">Vision and system command automation permissions</div></div>
          <button class="btn btn-danger xr-s-38" data-xr-action="emergencyStopControl()">🚨 Emergency Stop</button>
        </div>
        <div class="grid grid-4 xr-s-6">
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
            <div id="control-history-list" class="xr-s-39"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Panel 15: Shield (Security) -->
      <div class="panel" tabindex="-1" id="panel-shield">
        <div class="section-header">
          <div><h1>🛡️ XR Shield — Security & Privacy</h1><div class="section-sub">EDR endpoint checking, processes manager, and Dojo testing lab</div></div>
          <div class="xr-s-17">
            <button class="btn btn-primary" data-xr-action="runShieldScan('quick')">Quick Scan</button>
            <button class="btn btn-ghost" data-xr-action="runShieldScan('full')">Full Scan</button>
          </div>
        </div>

        <div class="grid grid-4 xr-s-6">
          <div class="card card-glow-green" id="shield-card-score">
            <div class="card-header"><span class="card-title">Privacy Score</span></div>
            <div class="card-value" id="shield-score-val">100/100</div>
            <div class="card-sub">Local environment audit</div>
          </div>
          <div class="card" id="shield-card-threats">
            <div class="card-header"><span class="card-title">Active threats</span></div>
            <div class="card-value xr-s-40" id="shield-threats-val">0</div>
            <div class="card-sub">Malware or miner triggers</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Quarantined files</span></div>
            <div class="card-value" id="shield-quarantined-val">0</div>
            <div class="card-sub">Isolated attachments</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Ad Block filtering</span></div>
            <div class="card-value text-cyan xr-s-41" id="shield-adblock-val" data-xr-action="toggleShieldAdBlock()">Enabled</div>
            <div class="card-sub">Sinkhole tracking servers</div>
          </div>
        </div>

        <!-- Sub-tabs row -->
        <div class="xr-s-42">
          <button class="btn btn-ghost active" id="shield-tab-overview" data-xr-action="switchShieldTab('overview')">Anomalies Scan</button>
          <button class="btn btn-ghost" id="shield-tab-processes" data-xr-action="switchShieldTab('processes')">Process Tree</button>
          <button class="btn btn-ghost" id="shield-tab-startup" data-xr-action="switchShieldTab('startup')">Startup tasks</button>
          <button class="btn btn-ghost" id="shield-tab-downloads" data-xr-action="switchShieldTab('downloads')">Downloads scanner</button>
          <button class="btn btn-ghost" id="shield-tab-browser" data-xr-action="switchShieldTab('browser')">Browser Privacy</button>
          <button class="btn btn-ghost" id="shield-tab-lab" data-xr-action="switchShieldTab('lab')">Dojo test lab</button>
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

        <div id="shield-subpanel-processes" class="xr-s-43">
          <div class="card">
            <div class="card-header"><span class="card-title">Running Processes EDR inspection</span></div>
            <div class="xr-s-44">
              <table class="proc-table">
                <thead><tr><th>PID</th><th>PPID</th><th>Name</th><th>CPU%</th><th>Memory</th><th>Signature</th><th>Remediate</th></tr></thead>
                <tbody id="shield-processes-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-startup" class="xr-s-43">
          <div class="card">
            <div class="card-header"><span class="card-title">Persistent registry startup logs</span></div>
            <div class="xr-s-44">
              <table class="proc-table">
                <thead><tr><th>Name</th><th>Registry location</th><th>Task commands</th><th>Integrity status</th></tr></thead>
                <tbody id="shield-startup-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-downloads" class="xr-s-43">
          <div class="card">
            <div class="card-header"><span class="card-title">Downloads Directory inspector</span></div>
            <div class="xr-s-44">
              <table class="proc-table">
                <thead><tr><th>Filename</th><th>File size</th><th>Risk assessment</th><th>Actions</th></tr></thead>
                <tbody id="shield-downloads-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="shield-subpanel-browser" class="xr-s-43">
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

        <div id="shield-subpanel-lab" class="xr-s-43">
          <div class="grid grid-2">
            <div class="card">
              <div class="card-header"><span class="card-title">Dojo Prompt Injection Attack Benchmarks</span></div>
              <div class="xr-s-45">
                <p class="muted">Run standard AgentDojo prompt injection attack payloads against local filters to assess safety resistance index.</p>
                <div id="sec-lab-result"><div class="muted">Click test button to initialize attack simulation...</div></div>
                <button class="btn btn-primary xr-s-16" data-xr-action="runSecLab()">Run Dojo Lab</button>
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
      <div class="panel" tabindex="-1" id="panel-audit">
        <div class="section-header">
          <div><h1>Audit Log</h1><div class="section-sub">Tamper-evident append-only ledger with cryptographic hash checks</div></div>
          <div class="xr-s-17">
            <button class="btn btn-primary" data-xr-action="verifyAuditLedger()">Verify Hash integrity</button>
            <button class="btn btn-ghost" data-xr-action="loadAuditLog()">↻ Refresh</button>
          </div>
        </div>
        <div class="card xr-s-6">
          <div class="card-header"><span class="card-title">Ledger verification</span><span id="audit-chain-badge" class="badge badge-gray">checking...</span></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Cryptographic entries</span></div>
          <div id="audit-log-list" class="xr-s-14"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Panel 17: Cost & Budget -->
      <div class="panel" tabindex="-1" id="panel-budget">
        <div class="section-header">
          <div><h1>Cost & Budget Governor</h1><div class="section-sub">Resource spending trackers and pricing limit controls</div></div>
          <button class="btn" data-xr-action="loadBudgetPanel()">↻ Refresh</button>
        </div>
        <div class="grid grid-4 xr-s-6">
          <div class="card"><div class="card-title">Per-task USD limit</div><div class="card-value" id="bud-cap-task">$0.00</div></div>
          <div class="card"><div class="card-title">Daily spend</div><div class="card-value" id="bud-day-spend">$0.00</div></div>
          <div class="card"><div class="card-title">Monthly total</div><div class="card-value" id="bud-month-spend">$0.00</div></div>
          <div class="card"><div class="card-title">Highest model spend</div><div class="card-value text-cyan" id="bud-top-model">—</div></div>
        </div>
        <div class="grid grid-2 xr-s-6">
          <div class="card">
            <div class="card-header"><span class="card-title">Configure caps limits</span></div>
            <div class="xr-s-26">
              <label>Per-task hard USD ceiling
                <input id="bud-input-task" type="number" step="0.01" class="input" aria-label="Budget limit per task (USD)" />
              </label>
              <label>Monthly hard USD cap
                <input id="bud-input-month" type="number" step="0.01" class="input" aria-label="Budget limit per month (USD)" />
              </label>
              <label>Daily warning threshold cap
                <input id="bud-input-day" type="number" step="0.01" class="input" aria-label="Budget limit per day (USD)" />
              </label>
              <div class="xr-s-46">
                <label class="xr-s-47"><input id="bud-toggle-warn" type="checkbox"/> Warning notifications</label>
                <label class="xr-s-47"><input id="bud-toggle-fallback" type="checkbox"/> Auto routing fallback</label>
              </div>
              <button class="btn btn-primary xr-s-16" data-xr-action="saveBudgetConfig()">Save limit ceilings</button>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Spend metrics ledger list</span></div>
            <div id="bud-recent" class="xr-s-28"><div class="spinner"></div></div>
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
      <div class="panel" tabindex="-1" id="panel-files">
        <div class="section-header">
          <div><h1>Files & Produced Artifacts</h1><div class="section-sub">Browser of documents, plans, and files generated in chats</div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Produced workspace files</span></div>
          <div id="workspace-files-list"><div class="muted">No produced artifacts present. Start chat sessions to write code files, reports, and checklists.</div></div>
        </div>
      </div>

      <!-- Panel 19: Downloads Security -->
      <div class="panel" tabindex="-1" id="panel-downloads">
        <div class="section-header">
          <div><h1>Downloads Folder Security Scanner</h1><div class="section-sub">Scans local Downloads for malware and alerts on unsafe files</div></div>
        </div>
        <div class="card xr-s-6">
          <div class="card-header"><span class="card-title">Downloads telemetry scan</span></div>
          <p class="muted xr-s-7">This panel monitors file additions inside the standard Downloads folder and alerts if downloaded scripts contain crypto-miner payloads or suspicious command triggers.</p>
          <button class="btn btn-primary" data-xr-action="switchShieldTab('downloads'); navigateTo('shield');">Open Shield Downloads scanner</button>
        </div>
      </div>

      <!-- Panel 20: Devices Link -->
      <div class="panel" tabindex="-1" id="panel-devices">
        <div class="section-header">
          <div><h1>Devices Sync</h1><div class="section-sub">Synchronize terminal clients, VS Code workspaces, and mobile Termux interfaces</div></div>
        </div>
        <div class="grid grid-3">
          <div class="card">
            <div class="card-header"><span class="card-title">VS Code Extension</span></div>
            <p class="xr-s-48">Deploy XR inside editor panes. Share context, models, and local-key configuration with active files.</p>
            <button class="btn" data-xr-action="toast('VS Code API port listening on 127.0.0.1:3141', 'ok')">Integrate Port</button>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Termux Android Sync</span></div>
            <p class="xr-s-48">Integrate Termux prompt on Android devices to access models, CRM, and files remotely via Telegram.</p>
            <button class="btn" data-xr-action="toast('Mobile webhook sync ready', 'ok')">Show instructions</button>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">CLI Daemon State</span></div>
            <p class="xr-s-48">Local background runner checks on cron scheduled tasks, webhooks, and wake phrases.</p>
            <span class="badge badge-green">Healthy</span>
          </div>
        </div>
      </div>

      <!-- Panel 21: Scheduled Tasks -->
      <div class="panel" tabindex="-1" id="panel-automation">
        <div class="section-header">
          <div><h1>Scheduled Automation</h1><div class="section-sub">Execute recurring prompts or scripts via local cron scheduling</div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Cron Automation Tasks</span></div>
          <div class="stat-row"><div class="stat-key">No scheduled cron automation jobs.</div></div>
          <div class="xr-s-49">
            <p class="muted xr-s-27">Register scheduling scripts via terminal commands: <code class="mono text-cyan">xr cron add "0 9 * * *" "xr 'Run daily research summary'"</code></p>
          </div>
        </div>
      </div>

      <!-- Panel 22: Webhooks API -->
      <div class="panel" tabindex="-1" id="panel-integrations">
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
      <div class="panel" tabindex="-1" id="panel-notifications">
        <div class="section-header">
          <div><h1>Alerts Hub</h1><div class="section-sub">System notices, telemetry flags, and safety block indicators</div></div>
          <button class="btn btn-ghost" data-xr-action="clearNotifications()">Clear list</button>
        </div>
        <div class="card">
          <div id="alerts-list"><div class="muted">No unread alerts. Active console is safe.</div></div>
        </div>
      </div>

      <!-- Panel 24: Core Settings -->
      <div class="panel" tabindex="-1" id="panel-settings">
        <div class="section-header">
          <div><h1>Core Settings</h1><div class="section-sub">Configure XR kernel preferences, budget caps, and egress rules</div></div>
          <div class="xr-s-17">
            <input id="settings-search" class="input xr-s-50" placeholder="Search settings..." data-xr-keyup="filterSettings()" aria-label="Search settings" />
            <button class="btn btn-primary" data-xr-action="saveAllSettings()">Save Configuration</button>
          </div>
        </div>

        <div class="settings-wrap">
          <aside class="settings-nav">
            <button class="settings-nav-item active" data-set-pane="general" data-xr-action="switchSettingsPane('general')">General</button>
            <button class="settings-nav-item" data-set-pane="providers" data-xr-action="switchSettingsPane('providers')">Cloud Keys</button>
            <button class="settings-nav-item" data-set-pane="local" data-xr-action="switchSettingsPane('local')">Local Models</button>
            <button class="settings-nav-item" data-set-pane="budget" data-xr-action="switchSettingsPane('budget')">Budget caps</button>
            <button class="settings-nav-item" data-set-pane="trust" data-xr-action="switchSettingsPane('trust')">Trust & Safety</button>
            <button class="settings-nav-item" data-set-pane="voice" data-xr-action="switchSettingsPane('voice')">Voice & Audio</button>
          </aside>

          <div class="settings-content xr-s-51">
            <!-- Settings Pane 1: General -->
            <div class="settings-pane active" id="set-pane-general">
              <div class="settings-group">
                <div class="settings-title">User Ergonomics</div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Interface Density</div>
                    <div class="settings-desc">Adjust size of tables, lists, and spacing layout.</div>
                  </div>
                  <select id="set-general-density" class="settings-field" aria-label="Layout density">
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
                  <label class="toggle"><input type="checkbox" id="set-general-startup" aria-label="Launch XR Control Center on login"/><div class="toggle-slider"></div></label>
                </div>
              </div>
            </div>

            <!-- Settings Pane 2: Cloud Keys -->
            <div class="settings-pane" id="set-pane-providers">
              <div class="settings-group">
                <div class="settings-title">BYOK Cloud API Keys</div>
                <p class="muted xr-s-7">Cloud keys are stored inside the encrypted OS keychain or local encrypted configs. Raw secret tags are never returned over HTTP API requests.</p>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Anthropic Claude Key</div>
                    <div class="settings-desc">Enables claude-3-5-sonnet model features.</div>
                  </div>
                  <input type="password" id="set-prov-key-anthropic" class="input settings-field" placeholder="••••••••••••" aria-label="Anthropic API key" autocomplete="off" />
                </div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">OpenAI API Key</div>
                    <div class="settings-desc">Enables gpt-4o endpoints.</div>
                  </div>
                  <input type="password" id="set-prov-key-openai" class="input settings-field" placeholder="••••••••••••" aria-label="OpenAI API key" autocomplete="off" />
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
                  <select id="set-local-runtime" class="settings-field" aria-label="Default local runtime">
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
                  <input type="number" id="set-budget-task" step="0.01" class="input settings-field" aria-label="Default budget per task (USD)" />
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
                  <label class="toggle"><input type="checkbox" id="set-trust-approval" checked aria-label="Require approval for elevated actions"/><div class="toggle-slider"></div></label>
                </div>
                <div class="settings-row">
                  <div class="settings-meta">
                    <div class="settings-key">Egress filtering restrictor</div>
                    <div class="settings-desc">Limit network requests to allowlisted domains alone.</div>
                  </div>
                  <label class="toggle"><input type="checkbox" id="set-trust-egress" aria-label="Restrict network egress for sandboxed tools"/><div class="toggle-slider"></div></label>
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
                  <label class="toggle"><input type="checkbox" id="set-voice-ptt" checked aria-label="Push-to-talk voice capture default"/><div class="toggle-slider"></div></label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Panel 25: About Build -->
      <div class="panel" tabindex="-1" id="panel-about">
        <div class="section-header">
          <div><h1>About XR Control Center</h1><div class="section-sub">System build identity metadata</div></div>
        </div>
        <div class="card xr-s-6">
          <div class="xr-s-52">
            <div class="logo-mark xr-s-53" aria-hidden="true">▀▄▀</div>
            <div>
              <h2>XR Unified AI OS Control Center</h2>
              <p class="muted">__XR_VERSION__ — Control Center</p>
              <p class="muted">Server location: Islamabad, PK (Asia/Karachi timezone)</p>
            </div>
          </div>
          <div class="stat-row"><div class="stat-key">License</div><div class="stat-val">MIT Licensed (Open Source)</div></div>
          <div class="stat-row"><div class="stat-key">Author</div><div class="stat-val">Muhammad Ahmad (@ahmadrrrtx)</div></div>
          <div class="stat-row"><div class="stat-key">Repository</div><div class="stat-val">github.com/ahmadrrrtx/xr</div></div>
          <div class="stat-row"><div class="stat-key">Telemetry policy</div><div class="stat-val text-green">Telemetry disabled completely. Private & local.</div></div>
        </div>
        <button class="btn btn-primary" data-xr-action="exportFullData()">Export full workspace backup package (JSON)</button>
      </div>

    </div><!-- /content -->
  </main><!-- /main -->
</div><!-- /app -->

<!-- ── Script Logic (backward-compatible, optimized) ──────────────────── -->
<script src="/assets/dashboard.js" defer></script>
</body>
</html>`;

