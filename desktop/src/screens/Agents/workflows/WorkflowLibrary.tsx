/*
 * Workflow library (Phase 19) — what the engine's repository holds, shown
 * when no document is open. Each row: name, version, honest counts line,
 * last run. "New workflow" starts the four-node starter graph.
 */
import { AlertTriangle, Plus, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';

import { countsLine } from '@/agents/canvasCore';
import { useWorkflowEditorStore } from '@/stores/workflowEditorStore';

function relative(ts: number, now: number): string {
  const d = now - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`;
  return `${Math.floor(d / 86_400_000)} d ago`;
}

export function WorkflowLibrary() {
  const defs = useWorkflowEditorStore((s) => s.definitions);
  const loading = useWorkflowEditorStore((s) => s.definitionsLoading);
  const error = useWorkflowEditorStore((s) => s.definitionsError);
  const loadingDoc = useWorkflowEditorStore((s) => s.loadingDoc);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="xa-scroll" data-testid="wf-library">
      {error ? (
        <div className="xa-note xa-note--warn" role="status" style={{ marginBottom: 14 }}>
          <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
          {error}
          <button type="button" className="xa-btn xa-btn--sm" style={{ marginLeft: 'auto' }} onClick={() => void useWorkflowEditorStore.getState().loadDefinitions()}>
            Retry
          </button>
        </div>
      ) : null}
      {!loading && !error && defs.length === 0 ? (
        <div className="xw-empty" data-testid="wf-empty">
          <Workflow size={28} strokeWidth={1.25} aria-hidden="true" style={{ color: 'var(--text-tertiary)' }} />
          <h3>No workflows yet</h3>
          <p>A workflow is a small graph: inputs, LLM or tool steps, a human check, an output. The engine runs it and enforces every approval.</p>
          <button type="button" className="xa-btn xa-btn--primary" onClick={() => useWorkflowEditorStore.getState().newWorkflow()} data-testid="wf-empty-new">
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            New workflow
          </button>
        </div>
      ) : (
        <ul className="xw-list" aria-busy={loading || loadingDoc}>
          <li>
            <button type="button" className="xw-list-item" onClick={() => useWorkflowEditorStore.getState().newWorkflow()} data-testid="wf-library-new">
              <strong className="xa-row" style={{ gap: 6 }}>
                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                New workflow
              </strong>
              <span>Starts with Input → LLM → Approval → Output.</span>
            </button>
          </li>
          {loading && defs.length === 0 ? Array.from({ length: 3 }, (_, i) => <li key={i} className="xa-skeleton" style={{ height: 56 }} />) : null}
          {defs.map((d) => (
            <li key={d.definitionId}>
              <button type="button" className="xw-list-item" onClick={() => void useWorkflowEditorStore.getState().open(d.definitionId)} data-testid={`wf-library-${d.definitionId}`}>
                <strong>
                  {d.name} <span className="xa-pill">v{d.version}</span>
                  {d.tags.includes('template') ? <span className="xa-pill xa-pill--custom">template</span> : null}
                </strong>
                <span>
                  {countsLine(d.summary)}
                  {d.lastRun ? ` · last run ${d.lastRun.state.replace(/_/g, ' ')} ${relative(d.lastRun.endedAt ?? d.lastRun.createdAt, now)}` : ' · never run'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
