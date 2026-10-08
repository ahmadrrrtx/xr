/*
 * Read-only config slide-over (Phase 19) — the engine's AgentDefinition
 * as it is, no editing. "Duplicate to My Agents" seeds the editor.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { createElement, useEffect } from 'react';

import { familyLabel, familyOf, roleLabel } from '@/agents/core';
import { useAgentsStore } from '@/stores/agentsStore';

import { roleIcon } from '../icons';

export function AgentConfigSheet() {
  const agent = useAgentsStore((s) => (s.configId ? s.agents.find((a) => a.id === s.configId) : undefined));
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!agent) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useAgentsStore.getState().openConfig(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent]);

  return (
    <AnimatePresence>
      {agent && (
        <motion.aside
          key="agent-config"
          role="dialog"
          aria-modal="false"
          aria-label={`${agent.label} configuration`}
          className="xa-sheet xa-sheet--narrow"
          data-testid="agent-config-sheet"
          initial={reduced ? { opacity: 0 } : { x: 32, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
          exit={{ x: reduced ? 0 : 32, opacity: 0, transition: { duration: 0.16 } }}
          transition={{ type: 'spring', stiffness: 480, damping: 34 }}
        >
          <div className="xa-sheet-head">
            <div className="xa-row">
              <span className="xa-avatar" style={{ width: 36, height: 36, borderRadius: 10, ['--xa-color' as string]: `var(--xa-${familyOf(agent.role)})` }} aria-hidden="true">
                {agent.custom?.emoji ? <span style={{ fontSize: 18 }}>{agent.custom.emoji}</span> : createElement(roleIcon(agent.role), { size: 18, strokeWidth: 1.5 })}
              </span>
              <div className="min-w-0">
                <h3 style={{ margin: 0 }}>{agent.label}</h3>
                <span className="xa-help">
                  {roleLabel(agent.role)} · {familyLabel(familyOf(agent.role))} · v{agent.version}
                </span>
              </div>
            </div>
            <button type="button" className="xa-btn xa-btn--icon" aria-label="Close" onClick={() => useAgentsStore.getState().openConfig(null)}>
              <X size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <div className="xa-sheet-body">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{agent.description}</p>
            <section className="xa-section">
              <h4 className="xa-section-title">Tools · {agent.toolScope.mode}</h4>
              <div className="xa-toolchips">
                {agent.toolScope.tools.length ? agent.toolScope.tools.map((t) => <span key={t} className="xa-toolchip">{t}</span>) : <span className="xa-help">none</span>}
              </div>
            </section>
            <section className="xa-section">
              <h4 className="xa-section-title">Capabilities</h4>
              <div className="xa-toolchips">
                {agent.capabilities.map((c) => (
                  <span key={c} className="xa-toolchip">{c}</span>
                ))}
              </div>
            </section>
            <section className="xa-section">
              <h4 className="xa-section-title">Permissions</h4>
              <dl className="xa-kv">
                {Object.entries(agent.permissions).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v ? 'yes' : 'no'}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="xa-section">
              <h4 className="xa-section-title">Memory &amp; model</h4>
              <dl className="xa-kv">
                <div>
                  <dt>memory</dt>
                  <dd>
                    {agent.memoryScope.kind} · max {agent.memoryScope.maxEntries}
                    {agent.memoryScope.sharedWithSupervisor ? ' · shared' : ''}
                  </dd>
                </div>
                <div>
                  <dt>provider</dt>
                  <dd>{agent.providerScope.provider ?? 'default'}</dd>
                </div>
                <div>
                  <dt>model</dt>
                  <dd>{agent.providerScope.model ?? 'default'}</dd>
                </div>
                {agent.providerScope.strategy ? (
                  <div>
                    <dt>strategy</dt>
                    <dd>{agent.providerScope.strategy}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
            {agent.custom ? (
              <section className="xa-section">
                <h4 className="xa-section-title">System prompt</h4>
                <pre className="xa-textarea xa-textarea--mono" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 280, overflow: 'auto' }}>{agent.custom.systemPrompt}</pre>
              </section>
            ) : (
              <p className="xa-help">Built-in prompts live in the engine (src/agents/registry.ts) and are not shown here.</p>
            )}
          </div>
          <div className="xa-sheet-foot">
            <span style={{ flex: 1 }} />
            <button type="button" className="xa-btn" onClick={() => useAgentsStore.getState().openConfig(null)}>
              Close
            </button>
            {agent.builtin ? (
              <button
                type="button"
                className="xa-btn xa-btn--primary"
                onClick={() => {
                  useAgentsStore.getState().openConfig(null);
                  useAgentsStore.getState().openDuplicateFromPrebuilt(agent.id);
                }}
              >
                Duplicate to My Agents
              </button>
            ) : (
              <button
                type="button"
                className="xa-btn xa-btn--primary"
                onClick={() => {
                  useAgentsStore.getState().openConfig(null);
                  useAgentsStore.getState().openEdit(agent.id);
                }}
              >
                Edit
              </button>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
