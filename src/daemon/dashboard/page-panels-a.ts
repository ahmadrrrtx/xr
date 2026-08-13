/**
 * XR Control Center served-page fragment — panels 1-7 (overview, chat, sessions, workspaces, providers, models, memory).
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const PAGE_PANELS_A = `      <!-- Panel 1: Overview (Home) -->
      <div class="panel" tabindex="-1" id="panel-dashboard">
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
            <div class="card-value" id="d-sec-score">—</div>
            <div class="card-sub">Dojo injection block-rate</div>
          </div>
          <div class="card card-glow-green">
            <div class="card-header"><span class="card-title">Protection Log</span><span class="card-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span></div>
            <div class="card-value" id="d-shield-health">—</div>
            <div class="card-sub" id="d-shield-scans">—</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Immutable Ledger</span><span class="card-icon"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span></div>
            <div class="card-value" id="d-audit-val">—</div>
            <div class="card-sub" id="d-audit-entries">checking ledger…</div>
          </div>
        </div>

        <h2 class="xr-s-7">System Health Bento Matrix</h2>
        <p id="bento-summary" class="xr-sr-only" aria-live="polite">System health: loading…</p>
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
            <div class="matrix-cell-head"><span class="matrix-cell-title">4. Voice runtime</span><div class="matrix-cell-status" id="h-cell-voice"></div></div>
            <div class="matrix-cell-val" id="h-val-voice">—</div>
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
      <div class="panel xr-s-10 active" tabindex="-1" id="panel-chat">
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
              <div class="chat-state-orb idle" id="chat-state-orb" role="status" aria-label="XR is idle" title="XR state — idle">
                <img class="chat-state-avatar" src="__XR_AVATAR__" alt="" aria-hidden="true" />
              </div>
              <div class="chat-title-block">
                <div class="chat-header-title" id="chat-title">Universal Composer</div>
                <div class="chat-header-model" id="chat-model-label">local-first · BYOK</div>
              </div>
              <div class="chat-status-row" id="chat-status-row"></div>
              <div class="topbar-spacer"></div>
              <button class="btn btn-ghost" data-xr-action="chatTogglePin()" id="chat-pin-btn">Pin</button>
              <button class="btn btn-ghost" data-xr-action="chatBranchFromLast()">Branch</button>
              <button class="btn btn-ghost" data-xr-action="chatExportActive()">Export</button>
              <button class="btn btn-ghost" data-xr-action="toggleInspector()" id="inspector-toggle-btn" aria-pressed="false">Inspector</button>
              <button class="btn btn-danger" data-xr-action="chatArchiveActive()">Archive</button>
            </header>

            <div class="chat-empty-state" id="chat-empty-state" hidden>
              <div class="chat-empty-orb idle" id="chat-empty-orb" role="status" aria-label="XR is idle">
                <img class="chat-empty-avatar" src="__XR_AVATAR__" alt="" aria-hidden="true" />
              </div>
              <h2 class="chat-empty-title">What can I help you with?</h2>
              <p class="chat-empty-sub">XR runs on your machine with your own providers — local-first, auditable, spend-capped. Try one of these:</p>
              <div class="chat-empty-prompts">
                <button type="button" class="btn btn-ghost" data-xr-action="quickPrompt('/status')"><span class="chat-prompt-cmd">/status</span> Check system status</button>
                <button type="button" class="btn btn-ghost" data-xr-action="quickPrompt('/budget')"><span class="chat-prompt-cmd">/budget</span> See spend &amp; caps</button>
                <button type="button" class="btn btn-ghost" data-xr-action="quickPrompt('/memory')"><span class="chat-prompt-cmd">/memory</span> Search what XR remembers</button>
                <button type="button" class="btn btn-ghost" data-xr-action="insertHint('/plan ')"><span class="chat-prompt-cmd">/plan</span> Plan a multi-step task</button>
              </div>
              <div class="chat-empty-caps">
                <button type="button" class="cap-chip" data-xr-action="navigateTo('models')">Models</button>
                <button type="button" class="cap-chip" data-xr-action="navigateTo('providers')">Providers</button>
                <button type="button" class="cap-chip" data-xr-action="navigateTo('skills')">Skills</button>
                <button type="button" class="cap-chip" data-xr-action="navigateTo('memory')">Memory</button>
                <button type="button" class="cap-chip" data-xr-action="navigateTo('shield')">Security</button>
                <button type="button" class="cap-chip" data-xr-action="navigateTo('budget')">Budget</button>
              </div>
            </div>

            <div class="chat-messages" id="chat-messages" role="log"></div>
            <span id="xr-stream-announcer" class="xr-sr-only" aria-live="polite"></span>

            <footer class="chat-composer" id="composer-drop-zone">
              <div class="composer-card">
                <div class="composer-context" id="composer-context"></div>
                <div class="composer-meta" id="composer-meta" aria-live="polite"></div>
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
                  <button class="composer-flag-chip memory" data-xr-action="toggleComposerFlag('memory')"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="12" height="12"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/></svg> Memory</button>
                  <button class="composer-flag-chip research" data-xr-action="toggleComposerFlag('research')"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="12" height="12"><path d="M10 2v6L4.5 17.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3.5L14 8V2"/><path d="M8.5 2h7"/><line x1="7" y1="15" x2="17" y2="15"/></svg> Research</button>
                  <button class="composer-flag-chip shield" data-xr-action="toggleComposerFlag('shield')"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="12" height="12"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Shield</button>
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
              <div class="inspector-title">Approvals</div>
              <div id="approval-list" aria-live="polite"><div class="muted">No pending authorizations.</div></div>
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
            <div class="xr-s-15">
              <input id="sess-search" class="input" placeholder="Search sessions by title, id or status…" aria-label="Search sessions by title, id or status" />
            </div>
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

`;
