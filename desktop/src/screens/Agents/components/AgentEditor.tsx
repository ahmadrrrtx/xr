/*
 * Agent editor (Phase 19) — 480 px slide-over. Identity · system prompt
 * (mono editor / markdown preview) · tools (engine capability list) ·
 * model (Chat's catalogue) · budget · Constitution overrides. Saving posts
 * to the engine, which validates and versions the JSON document; field
 * errors come back under the field they belong to.
 *
 * "Destructive actions need approval" is always on and disabled: the
 * engine refuses documents that turn it off (custom-store.ts), and the
 * daemon's executor gates destructive tools regardless of the agent.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Eye, Pencil, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { AGENT_EMOJIS, AGENT_LIMITS, AGENT_ROLES, ROLE_FAMILIES, familyOf, roleLabel, type AgentRole, type CustomAgentConstitution } from '@/agents/core';
import { Switch } from '@/components/ui/switch';
import { MarkdownRenderer } from '@/lib/markdown';
import { useAgentsStore } from '@/stores/agentsStore';

import { ModelSelect } from './ModelSelect';

const CONSTITUTION_ROWS: { key: keyof Omit<CustomAgentConstitution, 'destructiveApproval'>; title: string; help: string }[] = [
  { key: 'askBeforeFileWrites', title: 'Ask before file writes', help: 'Every write_file goes through Shield approval.' },
  { key: 'askBeforeShell', title: 'Ask before shell commands', help: 'Every shell call waits for you.' },
  { key: 'allowPublicWeb', title: 'Allow public web', help: 'Off: fetch_url and web_search stay local-only.' },
  { key: 'memoryWrite', title: 'Write to memory', help: 'Off: the agent reads memory but never saves to it.' },
  { key: 'shareData', title: 'Share data between agents', help: 'Off: outputs stay with this agent\u2019s run.' },
];

export function AgentEditor() {
  const ed = useAgentsStore((s) => s.editor);
  const tools = useAgentsStore((s) => s.tools);
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (ed.open) nameRef.current?.focus();
  }, [ed.open, ed.mode, ed.id]);

  useEffect(() => {
    if (!ed.open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        useAgentsStore.getState().closeEditor();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void useAgentsStore.getState().save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ed.open]);

  const problemFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of ed.problems) if (!map.has(p.path)) map.set(p.path, p.message);
    return (path: string): string | undefined => map.get(path);
  }, [ed.problems]);
  const general = ed.problems.filter((p) => !p.path).map((p) => p.message);

  const f = ed.form;
  const patch = useAgentsStore.getState().patchForm;
  const rolesByFamily = useMemo(() => {
    const out = new Map<string, AgentRole[]>();
    for (const r of AGENT_ROLES) out.set(familyOf(r), [...(out.get(familyOf(r)) ?? []), r]);
    return out;
  }, []);

  return (
    <AnimatePresence>
      {ed.open && (
        <motion.aside
          key="agent-editor"
          role="dialog"
          aria-modal="false"
          aria-label={ed.mode === 'edit' ? `Edit ${f.name || 'agent'}` : 'New agent'}
          data-testid="agent-editor"
          className="xa-sheet"
          initial={reduced ? { opacity: 0 } : { x: 32, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
          exit={{ x: reduced ? 0 : 32, opacity: 0, transition: { duration: 0.16 } }}
          transition={{ type: 'spring', stiffness: 480, damping: 34 }}
        >
          <div className="xa-sheet-head">
            <h3>{ed.mode === 'edit' ? 'Edit agent' : ed.basedOn ? 'Duplicate to My Agents' : 'New agent'}</h3>
            <button type="button" className="xa-btn xa-btn--icon" aria-label="Close editor" onClick={() => useAgentsStore.getState().closeEditor()}>
              <X size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <form
            className="xa-sheet-body"
            onSubmit={(e) => {
              e.preventDefault();
              void useAgentsStore.getState().save();
            }}
            noValidate
          >
            {general.length ? (
              <div className="xa-note xa-note--danger" role="alert">
                {general.join(' ')}
              </div>
            ) : null}

            {/* Identity */}
            <section className="xa-section" aria-labelledby="ae-identity">
              <h4 className="xa-section-title" id="ae-identity">
                Identity
              </h4>
              <div className="xa-row" style={{ alignItems: 'flex-start' }}>
                <div className="xa-emoji-preview" aria-hidden="true">
                  {f.emoji || '🤖'}
                </div>
                <div className="xa-field" style={{ flex: 1 }}>
                  <label htmlFor="ae-name">Name</label>
                  <input
                    id="ae-name"
                    ref={nameRef}
                    className="xa-input"
                    value={f.name}
                    maxLength={AGENT_LIMITS.nameMax}
                    aria-invalid={!!problemFor('name')}
                    aria-describedby={problemFor('name') ? 'ae-name-err' : undefined}
                    onChange={(e) => patch({ name: e.target.value })}
                    data-testid="ae-name"
                  />
                  {problemFor('name') ? (
                    <span className="xa-error" id="ae-name-err">
                      {problemFor('name')}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="xa-field">
                <label htmlFor="ae-desc">Description</label>
                <input
                  id="ae-desc"
                  className="xa-input"
                  value={f.description}
                  maxLength={AGENT_LIMITS.descriptionMax}
                  placeholder="One line on what it does and what it will not do"
                  aria-invalid={!!problemFor('description')}
                  onChange={(e) => patch({ description: e.target.value })}
                  data-testid="ae-description"
                />
                {problemFor('description') ? <span className="xa-error">{problemFor('description')}</span> : null}
              </div>
              <div className="xa-field">
                <span className="xa-label" id="ae-emoji-label">
                  Icon
                </span>
                <div className="xa-emoji-grid" role="radiogroup" aria-labelledby="ae-emoji-label">
                  {AGENT_EMOJIS.map((e) => (
                    <button key={e} type="button" className="xa-emoji" role="radio" aria-checked={f.emoji === e} aria-pressed={f.emoji === e} aria-label={`Icon ${e}`} onClick={() => patch({ emoji: e })}>
                      {e}
                    </button>
                  ))}
                </div>
                <div className="xa-row">
                  <label htmlFor="ae-emoji-free" className="xa-label" style={{ flex: 'none' }}>
                    Or type one
                  </label>
                  <input id="ae-emoji-free" className="xa-input" style={{ width: 90 }} value={f.emoji} maxLength={AGENT_LIMITS.emojiMax} onChange={(e) => patch({ emoji: e.target.value })} />
                </div>
              </div>
              <div className="xa-field">
                <label htmlFor="ae-role">Role</label>
                <select id="ae-role" className="xa-select" value={f.role} onChange={(e) => patch({ role: e.target.value as AgentRole })} data-testid="ae-role">
                  {ROLE_FAMILIES.map((fam) => {
                    const roles = rolesByFamily.get(fam.id) ?? [];
                    if (!roles.length) return null;
                    return (
                      <optgroup key={fam.id} label={fam.label}>
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <span className="xa-help">Sets the colour family and how the engine's planner describes the agent to others.</span>
              </div>
            </section>

            {/* System prompt */}
            <section className="xa-section" aria-labelledby="ae-prompt-title">
              <div className="xa-row xa-row--between">
                <h4 className="xa-section-title" id="ae-prompt-title">
                  System prompt
                </h4>
                <button type="button" className="xa-btn xa-btn--sm" aria-pressed={ed.preview} onClick={() => useAgentsStore.getState().togglePreview()} data-testid="ae-preview-toggle">
                  {ed.preview ? <Pencil size={12} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={12} strokeWidth={1.75} aria-hidden="true" />}
                  {ed.preview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {ed.preview ? (
                <div className="xa-prose" style={{ minHeight: 180, padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)' }} data-testid="ae-preview">
                  {f.systemPrompt.trim() ? <MarkdownRenderer content={f.systemPrompt} /> : <span className="xa-help">Nothing to preview yet.</span>}
                </div>
              ) : (
                <textarea
                  id="ae-prompt"
                  aria-label="System prompt"
                  className="xa-textarea xa-textarea--mono"
                  value={f.systemPrompt}
                  spellCheck={false}
                  placeholder="You are … Read before you write. Quote exact lines. Never …"
                  aria-invalid={!!problemFor('systemPrompt')}
                  onChange={(e) => patch({ systemPrompt: e.target.value })}
                  data-testid="ae-prompt"
                />
              )}
              <div className="xa-row xa-row--between">
                {problemFor('systemPrompt') ? <span className="xa-error">{problemFor('systemPrompt')}</span> : <span className="xa-help">Markdown is fine. At least {AGENT_LIMITS.promptMin} characters.</span>}
                <span className="xa-help" style={{ fontFamily: 'var(--font-mono)' }}>
                  {f.systemPrompt.length.toLocaleString()}
                </span>
              </div>
            </section>

            {/* Tools */}
            <section className="xa-section" aria-labelledby="ae-tools-title">
              <h4 className="xa-section-title" id="ae-tools-title">
                Tools · {f.tools.length} of {tools.length || '—'}
              </h4>
              {tools.length === 0 ? (
                <span className="xa-help">The engine's tool list is not available right now.</span>
              ) : (
                <div className="xa-toolchips" role="group" aria-label="Tools the agent may call">
                  {tools.map((t) => {
                    const on = f.tools.includes(t.name);
                    return (
                      <button
                        key={t.name}
                        type="button"
                        className="xa-toolchip"
                        aria-pressed={on}
                        title={t.description}
                        onClick={() => patch({ tools: on ? f.tools.filter((x) => x !== t.name) : [...f.tools, t.name] })}
                        data-testid={`ae-tool-${t.name}`}
                      >
                        {t.name}
                        {t.requiresApproval ? (
                          <span className="xa-toolchip-warn" title="Needs approval each call">
                            ·ask
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
              {problemFor('tools') ? <span className="xa-error">{problemFor('tools')}</span> : null}
            </section>

            {/* Model */}
            <section className="xa-section" aria-labelledby="ae-model-title">
              <h4 className="xa-section-title" id="ae-model-title">
                Model
              </h4>
              <div className="xa-field">
                <label htmlFor="ae-model">Provider / model</label>
                <ModelSelect id="ae-model" value={f.model} invalid={!!problemFor('model')} allowDefault={false} onChange={({ model, provider }) => patch({ model, provider })} />
                {problemFor('model') ? <span className="xa-error">{problemFor('model')}</span> : <span className="xa-help">Local models cost $0; cloud prices are estimates until the invoice.</span>}
              </div>
            </section>

            {/* Budget */}
            <section className="xa-section" aria-labelledby="ae-budget-title">
              <h4 className="xa-section-title" id="ae-budget-title">
                Budget
              </h4>
              <BudgetSlider id="ae-budget-run" label="Per run" value={f.budget.perRunUsd} onChange={(v) => patch({ budget: { ...f.budget, perRunUsd: v } })} error={problemFor('budget.perRunUsd')} />
              <BudgetSlider id="ae-budget-day" label="Per day" value={f.budget.perDayUsd} onChange={(v) => patch({ budget: { ...f.budget, perDayUsd: v } })} error={problemFor('budget.perDayUsd')} />
              <span className="xa-help">Hitting a cap pauses the agent and asks you through Shield; nothing continues on its own.</span>
            </section>

            {/* Constitution */}
            <section className="xa-section" aria-labelledby="ae-const-title">
              <h4 className="xa-section-title" id="ae-const-title">
                Constitution overrides
              </h4>
              <div>
                {CONSTITUTION_ROWS.map((row) => (
                  <div key={row.key} className="xa-toggle-row">
                    <div>
                      <strong>{row.title}</strong>
                      <span>{row.help}</span>
                    </div>
                    <Switch
                      checked={f.constitution[row.key]}
                      onCheckedChange={(v) => patch({ constitution: { ...f.constitution, [row.key]: v } })}
                      aria-label={row.title}
                      data-testid={`ae-const-${row.key}`}
                    />
                  </div>
                ))}
                <div className="xa-toggle-row">
                  <div>
                    <strong>
                      Destructive actions need approval <span className="xa-enforced">Enforced</span>
                    </strong>
                    <span>Always on. The engine rejects agents without it and gates destructive tools itself.</span>
                  </div>
                  <Switch checked disabled aria-label="Destructive actions need approval (always on)" />
                </div>
              </div>
            </section>
          </form>

          <div className="xa-sheet-foot">
            {ed.mode === 'edit' && ed.id ? (
              <>
                <button
                  type="button"
                  className="xa-btn"
                  onClick={() => {
                    const id = ed.id;
                    if (!id) return;
                    void useAgentsStore.getState().save().then((a) => {
                      if (a) navigate(`/chat?agent=${encodeURIComponent(a.id)}`);
                    });
                  }}
                  title="Save, then open a chat as this agent"
                  data-testid="ae-test"
                >
                  Test in chat
                </button>
                <button type="button" className="xa-btn xa-btn--danger" onClick={() => useAgentsStore.getState().requestDelete(ed.id)} data-testid="ae-delete">
                  Delete
                </button>
                <button type="button" className="xa-btn" onClick={() => void useAgentsStore.getState().duplicate(ed.id!)} data-testid="ae-duplicate">
                  Duplicate
                </button>
              </>
            ) : null}
            <span style={{ flex: 1 }} />
            <button type="button" className="xa-btn" onClick={() => useAgentsStore.getState().closeEditor()}>
              Cancel
            </button>
            <button type="button" className="xa-btn xa-btn--primary" disabled={ed.saving} onClick={() => void useAgentsStore.getState().save()} data-testid="ae-save">
              {ed.saving ? 'Saving…' : ed.mode === 'edit' ? 'Save' : 'Create'}
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function BudgetSlider({ id, label, value, onChange, error }: { id: string; label: string; value: number; onChange: (v: number) => void; error?: string }) {
  return (
    <div className="xa-field">
      <div className="xa-row xa-row--between">
        <label htmlFor={id}>{label}</label>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>${value.toFixed(2)}</span>
      </div>
      <input
        id={id}
        type="range"
        className="xa-range"
        min={AGENT_LIMITS.budgetMinUsd}
        max={AGENT_LIMITS.budgetMaxUsd}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`$${value.toFixed(2)}`}
      />
      {error ? <span className="xa-error">{error}</span> : null}
    </div>
  );
}
