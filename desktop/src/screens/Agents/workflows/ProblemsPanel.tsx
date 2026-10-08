/*
 * Problems panel (Phase 19). The engine's lint (POST /workflows/inspect)
 * with a few local hints while the engine is unreachable. Errors block
 * save; click jumps to the node.
 */
import { useReactFlow } from '@xyflow/react';
import { AlertCircle, AlertTriangle, X } from 'lucide-react';

import { useWorkflowEditorStore } from '@/stores/workflowEditorStore';

export function ProblemsPanel() {
  const rf = useReactFlow();
  const problems = useWorkflowEditorStore((s) => s.problems);
  const source = useWorkflowEditorStore((s) => s.problemsSource);
  const inspecting = useWorkflowEditorStore((s) => s.inspecting);
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const labelOf = (id?: string): string => (id ? nodes.find((n) => n.id === id)?.data.label ?? id : 'Workflow');
  const errors = problems.filter((p) => p.severity === 'error').length;

  return (
    <section className="xw-problems" aria-label="Problems" data-testid="wf-problems">
      <div className="xw-problems-head">
        <strong>Problems</strong>
        <span className="xa-help">
          {inspecting ? 'checking…' : source === 'engine' ? 'engine lint' : 'local hints only'}
          {errors ? ` · ${errors} ${errors === 1 ? 'error blocks' : 'errors block'} saving` : ''}
        </span>
        <button type="button" className="xa-btn xa-btn--icon" aria-label="Close problems" style={{ marginLeft: 'auto' }} onClick={() => useWorkflowEditorStore.getState().setProblemsOpen(false)}>
          <X size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <ul className="xw-problems-list">
        {problems.length === 0 ? <li className="xa-help" style={{ padding: '6px 10px' }}>No problems. The graph compiles to a valid definition.</li> : null}
        {problems.map((p, i) => (
          <li key={`${p.code}-${p.nodeId ?? ''}-${i}`}>
            <button
              type="button"
              className="xw-problem"
              data-severity={p.severity}
              onClick={() => {
                if (!p.nodeId) return;
                useWorkflowEditorStore.getState().selectNode(p.nodeId);
                const n = nodes.find((x) => x.id === p.nodeId);
                if (n) void rf.setCenter(n.position.x + 110, n.position.y + 32, { zoom: Math.max(rf.getZoom(), 1), duration: 220 });
              }}
              data-testid={`wf-problem-${i}`}
            >
              {p.severity === 'error' ? <AlertCircle size={13} strokeWidth={2} aria-hidden="true" /> : <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />}
              <span>
                <b>{labelOf(p.nodeId)}</b> · {p.message}
              </span>
              <code>{p.code}</code>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
