/**
 * XR Control Center served-page fragment — onboarding overlay + script tag + document close.
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

export const PAGE_TAIL = `</div><!-- /app -->

<!-- ── Script Logic (backward-compatible, optimized) ──────────────────── -->
<!-- Phase B · B-1 — first-run onboarding overlay (real engines, no fakes) -->
<div class="onboarding-overlay" id="onboarding-root" hidden>
  <div class="onboarding-card" role="dialog" aria-modal="true" aria-label="Set up XR">
    <header class="onboarding-head">
      <div class="onboarding-brand">
        <img class="onboarding-avatar" src="__XR_AVATAR__" alt="" aria-hidden="true" />
        <div>
          <h1 id="onb-title">Welcome to XR</h1>
          <p class="onboarding-sub" id="onb-sub">Your local-first AI agent — auditable, spend-capped, on your own providers.</p>
        </div>
      </div>
      <ol class="onboarding-progress" id="onb-progress" aria-label="Setup steps"></ol>
    </header>
    <div class="onboarding-steps">
      <section class="onb-step" data-step="welcome">
        <p class="onb-lead">XR is an AI agent that runs on <strong>your</strong> machine, with <strong>your</strong> provider keys or local models. Nothing leaves your machine unless you set it up — and every action is recorded in an audit log you can verify.</p>
        <div class="onb-actions">
          <button type="button" class="btn btn-primary" data-xr-action="onbNext()">Get started</button>
        </div>
      </section>
      <section class="onb-step" data-step="mode" hidden>
        <h2 class="onb-step-title">How do you want to run XR?</h2>
        <p class="onb-step-sub">You can change this anytime from the Models and Providers panels.</p>
        <div class="onb-cards">
          <button type="button" class="onb-card" data-xr-action="onbPickMode('cloud')">
            <span class="onb-card-name">Cloud — bring your own key</span>
            <span class="onb-card-desc">Use a provider like OpenAI or Anthropic with your own API key. Requires network; costs whatever the provider charges.</span>
          </button>
          <button type="button" class="onb-card" data-xr-action="onbPickMode('local')">
            <span class="onb-card-name">Local model</span>
            <span class="onb-card-desc">Run a model on this machine (e.g. via Ollama). Works offline, costs nothing per message.</span>
          </button>
          <button type="button" class="onb-card" data-xr-action="onbPickMode('both')">
            <span class="onb-card-name">Both (recommended)</span>
            <span class="onb-card-desc">Local for everyday work, cloud when you need a bigger model.</span>
          </button>
        </div>
      </section>
      <section class="onb-step" data-step="cloud" hidden>
        <h2 class="onb-step-title">Add a cloud provider</h2>
        <p class="onb-step-sub">Pick a provider and paste your key. XR stores it in your OS keychain (or a sealed file) and never shows it again.</p>
        <div id="onb-cloud-providers" class="onb-provider-list" aria-label="Provider presets"></div>
        <label class="onb-field" for="onb-api-key">API key</label>
        <input id="onb-api-key" class="input" type="password" autocomplete="off" aria-label="Provider API key" placeholder="sk-…" />
        <div class="onb-actions">
          <button type="button" class="btn btn-primary" data-xr-action="onbConnectProvider()" id="onb-connect-btn">Save &amp; test connection</button>
          <span class="onb-result" id="onb-connect-result" role="status"></span>
        </div>
      </section>
      <section class="onb-step" data-step="local" hidden>
        <h2 class="onb-step-title">Local model</h2>
        <div id="onb-local-content" class="onb-local"><div class="muted">Detecting your hardware…</div></div>
      </section>
      <section class="onb-step" data-step="security" hidden>
        <h2 class="onb-step-title">Permissions &amp; security</h2>
        <p class="onb-step-sub">These come from your actual XR configuration — read-only here. XR asks you before consequential actions and keeps a tamper-evident audit log.</p>
        <div id="onb-security-content" class="onb-security"><div class="muted">Loading…</div></div>
      </section>
      <section class="onb-step" data-step="budget" hidden>
        <h2 class="onb-step-title">Set a spending cap (optional)</h2>
        <p class="onb-step-sub">A monthly cap protects you on cloud providers. You can change or remove it anytime from the Budget panel.</p>
        <label class="onb-field" for="onb-budget-monthly">Monthly cap (USD)</label>
        <input id="onb-budget-monthly" class="input" type="number" min="0" step="1" inputmode="decimal" aria-label="Monthly spending cap in US dollars" placeholder="e.g. 10" />
        <div class="onb-actions">
          <button type="button" class="btn" data-xr-action="onbSetBudget()" id="onb-budget-btn">Save cap</button>
          <span class="onb-result" id="onb-budget-result" role="status"></span>
        </div>
      </section>
      <section class="onb-step" data-step="done" hidden>
        <h2 class="onb-step-title">You're ready.</h2>
        <p class="onb-step-sub" id="onb-done-sub">XR is set up. Your first task will be recorded in the audit log.</p>
        <div class="onb-actions">
          <button type="button" class="btn btn-primary" data-xr-action="onbComplete()">Start chatting</button>
          <button type="button" class="btn btn-ghost" data-xr-action="onbGo('models')">Open models</button>
          <button type="button" class="btn btn-ghost" data-xr-action="onbGo('providers')">Open providers</button>
        </div>
      </section>
    </div>
    <footer class="onboarding-foot">
      <button type="button" class="btn btn-ghost" data-xr-action="onbBack()" id="onb-back-btn" hidden>Back</button>
      <button type="button" class="btn btn-ghost" data-xr-action="onbSkip()" id="onb-skip-btn">Skip setup</button>
      <span class="onb-foot-status" id="onb-foot-status" role="status"></span>
    </footer>
  </div>
</div>

<script src="/assets/dashboard.js" defer></script>
</body>
</html>`;
