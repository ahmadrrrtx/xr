/**
 * XR Control Center served-page fragment — panels 8-25 (research, voice, skills, plugins, capabilities, mcp, control, shield, audit, budget, files, downloads, devices, automation, integrations, alerts, settings, about).
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const PAGE_PANELS_B = `      <!-- Panel 8: Research Runs -->
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
            <span class="xr-s-33"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></span>
            <h2>Voice — terminal-driven in this build</h2>
            <p class="muted xr-s-34">
              XR's voice pipeline (STT, TTS, wake word) runs locally and is configured and controlled from the terminal. The dashboard does not yet drive the audio pipeline directly, so it makes no promise it cannot keep — voice actions still pass through the same governed pipeline, so approvals apply.
            </p>
            <div class="voice-state-line">
              <span class="badge badge-gray" id="voice-config-state" role="status">Loading voice config…</span>
            </div>
            <p class="voice-note" id="voice-offline-note"></p>
            <div class="voice-copy-row">
              <button class="btn btn-ghost" data-xr-action="copyText('xr voice status')" title="Copy to clipboard"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> xr voice status</button>
              <button class="btn btn-ghost" data-xr-action="copyText('xr voice setup')" title="Copy to clipboard"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> xr voice setup</button>
              <button class="btn btn-ghost" data-xr-action="copyText('xr voice start')" title="Copy to clipboard"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> xr voice start</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Voice commands — the real CLI surface</span></div>
          <div class="stat-row"><div class="stat-key">Voice stack health</div><div class="stat-val text-cyan">xr voice status</div></div>
          <div class="stat-row"><div class="stat-key">Configure STT/TTS backends</div><div class="stat-val text-cyan">xr voice setup</div></div>
          <div class="stat-row"><div class="stat-key">Start the voice service</div><div class="stat-val text-cyan">xr voice start</div></div>
        </div>
      </div>

      <!-- Panel 10: Skills Marketplace -->
      <div class="panel" tabindex="-1" id="panel-skills">
        <div class="mp-hero">
          <div class="mp-hero-grid">
            <div>
              <div class="mp-kicker"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14"><path d="M10 8.6V6a2 2 0 0 1 4 0v2.6c.4-.1.8-.2 1.2-.2 1.6 0 2.8 1.2 2.8 2.8 0 .4-.1.8-.2 1.2H20a2 2 0 0 1 0 4h-2.2c.1.4.2.8.2 1.2 0 1.6-1.2 2.8-2.8 2.8-.4 0-.8-.1-1.2-.2V20a2 2 0 0 1-4 0v-2.2c-.4.1-.8.2-1.2.2-1.6 0-2.8-1.2-2.8-2.8 0-.4.1-.8.2-1.2H4a2 2 0 0 1 0-4h2.2c-.1-.4-.2-.8-.2-1.2 0-1.6 1.2-2.8 2.8-2.8.4 0 .8.1 1.2.2z"/></svg> App Store Skills Catalog</div>
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
          <div class="card"><div class="card-title">Sandbox indexes</div><div class="card-value" id="market-runtime">—</div></div>
        </div>

        <div class="mp-shell">
          <aside class="mp-card mp-side">
            <div class="mp-section-title">Filter by domains</div>
            <div id="market-categories"></div>
            <div class="mp-section-title xr-s-36">Quick categories</div>
            <div class="mp-cat" data-xr-action="setMarketQuery('security soci alert')"><b><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="12" height="12"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Security Ops</b></div>
            <div class="mp-cat" data-xr-action="setMarketQuery('developer python react')"><b><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg> Software suite</b></div>
            <div class="mp-cat" data-xr-action="setMarketQuery('research academic citation')"><b><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="12" height="12"><path d="M10 2v6L4.5 17.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3.5L14 8V2"/><path d="M8.5 2h7"/><line x1="7" y1="15" x2="17" y2="15"/></svg> Deep Research</b></div>
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
          <button class="btn btn-danger xr-s-38" data-xr-action="emergencyStopControl()"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Emergency Stop</button>
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
          <div><h1><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="12" height="12"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> XR Shield — Security & Privacy</h1><div class="section-sub">EDR endpoint checking, processes manager, and Dojo testing lab</div></div>
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
          <div>
            <h1>Workspace Files</h1>
            <div class="section-sub">Real file browser for this project — scoped to the workspace root</div>
          </div>
          <div class="xr-files-tools">
            <span class="badge badge-amber" title="Experimental: the coding workspace is a read-only browser in this build">experimental</span>
            <button class="btn" data-xr-action="loadFiles()">↻ Refresh</button>
          </div>
        </div>
        <div class="card xr-s-6" id="files-git-meta"><div class="muted">Loading project…</div></div>
        <div class="files-browser">
          <div class="files-pane files-tree" aria-label="Project files">
            <div class="files-breadcrumb" id="files-breadcrumb"></div>
            <div id="files-list" class="files-list"><div class="muted">Loading…</div></div>
            <div class="files-note" id="files-note"></div>
          </div>
          <div class="files-pane files-viewer" aria-label="File preview">
            <div id="files-viewer"><div class="muted files-empty">Select a file to preview it.</div></div>
          </div>
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
        <div class="card">
          <div class="card-header"><span class="card-title">Future &amp; experimental surfaces (honest status)</span></div>
          <div class="stat-row"><div class="stat-key">Embedded web terminal (xterm.js)</div><div class="stat-val">planned — needs a PTY route behind the daemon token</div></div>
          <div class="stat-row"><div class="stat-key">3D avatar</div><div class="stat-val">planned — needs an authored GLB rig; 2D state treatment ships today</div></div>
          <div class="stat-row"><div class="stat-key">Floating companion mode</div><div class="stat-val">planned — needs a daemon event path</div></div>
          <div class="stat-row"><div class="stat-key">In-browser voice mic</div><div class="stat-val">planned — needs browser APIs + a daemon audio contract; voice runs in the terminal today</div></div>
          <div class="stat-row"><div class="stat-key">Light theme</div><div class="stat-val">planned — tokens are dark-first</div></div>
          <div class="stat-row"><div class="stat-key">Workspace file browser</div><div class="stat-val text-cyan">experimental — read-only, scope-enforced (this build)</div></div>
        </div>
        <button class="btn btn-primary" data-xr-action="exportFullData()">Export full workspace backup package (JSON)</button>
      </div>

    </div><!-- /content -->
  </main><!-- /main -->
`;
