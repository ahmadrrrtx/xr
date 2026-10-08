/*
 * Agents screen (Phase 19) — three tabs over the EXISTING engine:
 *   Prebuilt   the agent registry (src/agents/registry.ts) as a gallery
 *   My Agents  the user's versioned custom agents (engine-validated JSON)
 *   Workflows  React Flow canvas that compiles DOWN to WorkflowDefinition
 *
 * URL intents (consumed once, then cleared):
 *   ?tab=prebuilt|mine|workflows   active tab (also persisted in settings)
 *   ?new=agent | ?new=workflow     open the editor / a starter canvas
 *   ?open=<definitionId>           open a saved workflow
 *   ?run=1                         focus the Run control (palette "Run workflow…")
 *   ?via=voice                     toast naming the voice intent
 */
import { Bot, Plus, Upload, Workflow } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { selectCustom, useAgentsStore } from '@/stores/agentsStore';
import { useSettingsStore, type AgentsTab } from '@/stores/settingsStore';
import '@/styles/agents.css';

import { AgentConfigSheet } from './components/AgentConfigSheet';
import { AgentEditor } from './components/AgentEditor';
import { DeleteAgentDialog } from './components/DeleteAgentDialog';
import { MyAgentsTab } from './components/MyAgentsTab';
import { PrebuiltTab } from './components/PrebuiltTab';

const WorkflowsTab = lazy(() => import('./workflows/WorkflowsTab'));

// The workflow store pulls in React Flow; keep it out of this chunk so the
// gallery tabs load without the canvas runtime.
const loadWorkflowStore = () => import('@/stores/workflowEditorStore').then((m) => m.useWorkflowEditorStore);

function useWorkflowCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;
    void loadWorkflowStore().then((store) => {
      if (!alive) return;
      setCount(store.getState().definitions.length);
      unsub = store.subscribe((st) => setCount(st.definitions.length));
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, []);
  return count;
}

const TABS: { id: AgentsTab; label: string }[] = [
  { id: 'prebuilt', label: 'Prebuilt' },
  { id: 'mine', label: 'My Agents' },
  { id: 'workflows', label: 'Workflows' },
];

function isTab(v: string | null): v is AgentsTab {
  return v === 'prebuilt' || v === 'mine' || v === 'workflows';
}

export default function AgentsScreen() {
  const [params, setParams] = useSearchParams();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const savedTab = useSettingsStore((s) => s.settings.agents.tab);
  const urlTab = params.get('tab');
  const tab: AgentsTab = isTab(urlTab) ? urlTab : savedTab;
  const customCount = useAgentsStore((s) => selectCustom(s).length);
  const definitionsCount = useWorkflowCount();
  const handledIntent = useRef<string | null>(null);

  const setTab = useCallback(
    (next: AgentsTab) => {
      useSettingsStore.getState().update('agents', { tab: next });
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('tab', next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // A tab reached by URL (palette, voice, a link) is the one we come back to.
  useEffect(() => {
    if (isTab(urlTab) && urlTab !== useSettingsStore.getState().settings.agents.tab) {
      useSettingsStore.getState().update('agents', { tab: urlTab });
    }
  }, [urlTab]);

  // Boot: both lists (cheap, one call each). The screen never caches.
  useEffect(() => {
    void useAgentsStore.getState().load();
    void loadWorkflowStore().then((store) => void store.getState().loadDefinitions());
    return () => {
      void loadWorkflowStore().then((store) => store.getState().leaveScreen());
    };
  }, []);

  // One-shot intents. The `new`/`open` params stay in the URL until the
  // workflow store has acted, so the Workflows tab does not reopen the last
  // document underneath a fresh one.
  useEffect(() => {
    const next = params.get('new');
    const open = params.get('open');
    const via = params.get('via');
    const run = params.get('run');
    if (!next && !open && !via && !run) return;
    const sig = params.toString();
    if (handledIntent.current === sig) return;
    handledIntent.current = sig;
    const p = new URLSearchParams(params);
    p.delete('new');
    p.delete('open');
    p.delete('via');
    p.delete('run');
    if (via === 'voice') toast('Opened from voice', { description: 'Nothing was started. Pick an agent or a workflow.' });
    const finish = (): void => setParams(p, { replace: true });
    if (next === 'agent') {
      useSettingsStore.getState().update('agents', { tab: 'mine' });
      p.set('tab', 'mine');
      useAgentsStore.getState().openCreate();
      finish();
    } else if (next === 'workflow' || open) {
      useSettingsStore.getState().update('agents', { tab: 'workflows' });
      p.set('tab', 'workflows');
      void loadWorkflowStore().then((store) => {
        if (open) void store.getState().open(open);
        else store.getState().newWorkflow();
        finish();
      });
    } else {
      if (run === '1') {
        useSettingsStore.getState().update('agents', { tab: 'workflows' });
        p.set('tab', 'workflows');
      }
      finish();
    }
  }, [params, setParams]);

  const onImportFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const agent = await useAgentsStore.getState().importFromText(text);
    if (agent) setTab('mine');
  }, [setTab]);

  return (
    <div className="xa-root" data-testid="agents-screen" data-tab={tab}>
      <div className="xa-head">
        <div className="min-w-0">
          <h2 className="xa-title">Agents</h2>
          <p className="xa-subtitle">Prebuilt specialists, custom agents, and visual workflows.</p>
        </div>
        <div className="xa-actions">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void onImportFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button type="button" className="xa-btn" onClick={() => fileRef.current?.click()} data-testid="agents-import">
            <Upload size={14} strokeWidth={1.75} aria-hidden="true" />
            Import agent
          </button>
          <button
            type="button"
            className="xa-btn"
            data-testid="agents-new-agent"
            onClick={() => {
              setTab('mine');
              useAgentsStore.getState().openCreate();
            }}
          >
            <Bot size={14} strokeWidth={1.75} aria-hidden="true" />
            New agent
          </button>
          <button
            type="button"
            className="xa-btn xa-btn--primary"
            data-testid="agents-new-workflow"
            onClick={() => {
              setTab('workflows');
              void loadWorkflowStore().then((store) => store.getState().newWorkflow());
            }}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            New workflow
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Agents sections" className="xa-tabs">
        {TABS.map((t, i) => {
          const active = tab === t.id;
          const count = t.id === 'mine' ? customCount : t.id === 'workflows' ? definitionsCount : null;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`agents-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`agents-panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              data-testid={`agents-tab-${t.id}`}
              className="xa-tab"
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!delta) return;
                e.preventDefault();
                const next = TABS[(i + delta + TABS.length) % TABS.length];
                setTab(next.id);
                document.getElementById(`agents-tab-${next.id}`)?.focus();
              }}
            >
              {t.id === 'workflows' ? <Workflow size={13} strokeWidth={1.75} aria-hidden="true" /> : null}
              {t.label}
              {count !== null && count > 0 ? <span className="xa-count">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`agents-panel-${tab}`} aria-labelledby={`agents-tab-${tab}`} className="xa-panel">
        {tab === 'prebuilt' && <PrebuiltTab />}
        {tab === 'mine' && <MyAgentsTab />}
        {tab === 'workflows' && (
          <Suspense fallback={<div className="bg-bg-void h-full w-full" aria-busy="true" aria-label="Loading workflow canvas" />}>
            <WorkflowsTab />
          </Suspense>
        )}
        <AgentEditor />
        <AgentConfigSheet />
        <DeleteAgentDialog />
      </div>
    </div>
  );
}
