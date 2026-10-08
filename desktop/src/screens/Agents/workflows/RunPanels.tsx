/*
 * Run-time panels (Phase 19):
 *   RunParamsDialog   values for Input nodes, typed per parameter
 *   ApprovalModal     central decision for a waiting human node; the same
 *                     POST /workflows/runs/{id}/human-decision the inline
 *                     buttons and Shield use — the engine enforces it
 *   CompletionSummary duration · cost · nodes · artifacts, Re-run,
 *                     Save as template
 *   FailureBanner     the engine's error, verbatim
 *   HistorySheet      past runs of this definition (engine list)
 */
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { HumanDecision, PendingHuman } from '@/agents/api';
import { completionSummary, fmtDuration, isActive, isTerminal, runStateLabel } from '@/agents/reduce';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useApprovalStore } from '@/stores/approvalStore';
import { useWorkflowEditorStore } from '@/stores/workflowEditorStore';

const NO_PENDING: PendingHuman[] = [];

function coerce(type: string, raw: string): unknown {
  const t = raw.trim();
  if (type === 'number') return t === '' ? undefined : Number(t);
  if (type === 'boolean') return t === '' ? undefined : t === 'true' || t === '1' || t === 'yes';
  if (type === 'json') {
    if (t === '') return undefined;
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return t;
    }
  }
  return raw;
}

export function RunParamsDialog() {
  const dlg = useWorkflowEditorStore((s) => s.runDialog);
  const starting = useWorkflowEditorStore((s) => s.starting);
  const missing = dlg.parameters.filter((p) => p.required && !(dlg.values[p.name] ?? '').trim()).map((p) => p.name);
  return (
    <Dialog open={dlg.open} onOpenChange={(open) => !open && useWorkflowEditorStore.getState().closeRunDialog()}>
      <DialogContent className="max-w-[460px]" data-testid="wf-run-dialog">
        <DialogHeader>
          <DialogTitle>Run parameters</DialogTitle>
          <DialogDescription>Values for the workflow's Input nodes. They are recorded with the run.</DialogDescription>
        </DialogHeader>
        <form
          id="wf-run-form"
          className="xa-section"
          onSubmit={(e) => {
            e.preventDefault();
            if (missing.length) return;
            const out: Record<string, unknown> = {};
            for (const p of dlg.parameters) {
              const v = coerce(p.type, dlg.values[p.name] ?? '');
              if (v !== undefined) out[p.name] = v;
            }
            void useWorkflowEditorStore.getState().startRun(out);
          }}
        >
          {dlg.parameters.map((p) => (
            <div key={p.name} className="xa-field">
              <label htmlFor={`rp-${p.name}`}>
                {p.name} <span className="xa-help">· {p.type}{p.required ? ' · required' : ''}</span>
              </label>
              {p.type === 'boolean' ? (
                <select id={`rp-${p.name}`} className="xa-select" value={dlg.values[p.name] ?? ''} onChange={(e) => useWorkflowEditorStore.getState().setRunValue(p.name, e.target.value)}>
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : p.type === 'json' ? (
                <textarea id={`rp-${p.name}`} className="xa-textarea xa-textarea--mono" style={{ minHeight: 70 }} value={dlg.values[p.name] ?? ''} onChange={(e) => useWorkflowEditorStore.getState().setRunValue(p.name, e.target.value)} />
              ) : (
                <input id={`rp-${p.name}`} className="xa-input" type={p.type === 'number' ? 'number' : 'text'} value={dlg.values[p.name] ?? ''} onChange={(e) => useWorkflowEditorStore.getState().setRunValue(p.name, e.target.value)} data-testid={`wf-param-${p.name}`} />
              )}
              {p.description ? <span className="xa-help">{p.description}</span> : null}
            </div>
          ))}
        </form>
        <DialogFooter>
          <button type="button" className="xa-btn" onClick={() => useWorkflowEditorStore.getState().closeRunDialog()}>
            Cancel
          </button>
          <button type="submit" form="wf-run-form" className="xa-btn xa-btn--primary" disabled={starting || missing.length > 0} title={missing.length ? `Missing: ${missing.join(', ')}` : undefined} data-testid="wf-run-start">
            {starting ? 'Starting…' : 'Start run'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApprovalModal() {
  const pending = useWorkflowEditorStore((s) => s.progress?.pendingHuman ?? NO_PENDING);
  const runState = useWorkflowEditorStore((s) => s.progress?.state ?? null);
  const deciding = useWorkflowEditorStore((s) => s.deciding);
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const current = pending[0];
  // Deferral is keyed per pending node, so a new one re-opens the modal on its own.
  const key = current ? `${current.nodeId}:${current.approvalId}` : null;
  const open = !!current && isActive(runState) && dismissed !== key;
  // The same check is also bridged into the Shield queue (it is a real
  // approval record). While this dialog is up it IS the approval surface, so
  // the root modal yields instead of covering the same question twice.
  const setInlineSurface = useApprovalStore((s) => s.setInlineSurface);
  useEffect(() => {
    if (!open) return;
    setInlineSurface(true);
    return () => setInlineSurface(false);
  }, [open, setInlineSurface]);

  if (!current) return null;
  const node = nodes.find((n) => n.id === current.nodeId);
  const cfg = node?.data.config ?? {};
  const review = current.kind === 'review';
  const decide = (d: HumanDecision): void => {
    void useWorkflowEditorStore.getState().decide(current.nodeId, d, comment.trim() || undefined).then(() => setComment(''));
  };
  const busy = deciding === current.nodeId;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDismissed(key)}>
      <DialogContent className="max-w-[480px]" data-testid="wf-approval-modal" onEscapeKeyDown={() => setDismissed(key)}>
        <DialogHeader>
          <DialogTitle>{review ? 'Review needed' : 'Approval needed'}</DialogTitle>
          <DialogDescription>
            {node?.data.label ?? current.nodeId} is waiting. The run cannot continue until you decide; the engine enforces this.
          </DialogDescription>
        </DialogHeader>
        <div className="xa-section">
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{current.summary || String(cfg.summary ?? '') || 'No summary provided'}</p>
          {String(cfg.detail ?? '').trim() ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{String(cfg.detail)}</p> : null}
          <dl className="xa-kv">
            {!review ? (
              <div>
                <dt>risk</dt>
                <dd>{String(cfg.riskLevel ?? 'medium')}</dd>
              </div>
            ) : null}
            <div>
              <dt>approval id</dt>
              <dd>{current.approvalId}</dd>
            </div>
          </dl>
          <div className="xa-field">
            <label htmlFor="wf-decide-comment">{review ? 'Steer (comment for the re-run)' : 'Comment (optional)'}</label>
            <textarea id="wf-decide-comment" className="xa-textarea" style={{ minHeight: 60 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={review ? 'What should change?' : 'Recorded with the decision'} />
          </div>
          <span className="xa-help">Also answerable from Shield → Approvals. Whichever answers first wins.</span>
        </div>
        <DialogFooter>
          <button type="button" className="xa-btn" onClick={() => setDismissed(key)}>
            Decide later
          </button>
          {review ? (
            <>
              <button type="button" className="xa-btn xa-btn--danger" disabled={busy} onClick={() => decide('reject')} data-testid="wf-decide-reject">
                Reject
              </button>
              <button type="button" className="xa-btn" disabled={busy} onClick={() => decide('changes_requested')} data-testid="wf-decide-changes">
                Request changes
              </button>
              <button type="button" className="xa-btn xa-btn--primary" disabled={busy} onClick={() => decide('approve')} data-testid="wf-decide-accept">
                Accept
              </button>
            </>
          ) : (
            <>
              <button type="button" className="xa-btn xa-btn--danger" disabled={busy} onClick={() => decide('deny')} data-testid="wf-decide-deny">
                Deny
              </button>
              <button type="button" className="xa-btn xa-btn--primary" disabled={busy} onClick={() => decide('approve')} data-testid="wf-decide-approve" autoFocus>
                Approve
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CompletionSummary() {
  const progress = useWorkflowEditorStore((s) => s.progress);
  // Artifact nodes that actually completed — the canvas knows which nodes declare one.
  const artifacts = useWorkflowEditorStore((s) => s.nodes.filter((n) => n.data.kind === 'artifact' && s.progress?.nodes[n.id]?.state === 'completed').length);
  if (!progress || !isTerminal(progress.state)) return null;
  const s = completionSummary(progress, artifacts);
  const good = progress.state === 'completed';
  return (
    <div className="xw-summary" data-state={progress.state} role="status" data-testid="wf-summary">
      <div className="xa-row xa-row--between">
        <strong className="xa-row" style={{ gap: 6 }}>
          {good ? <CheckCircle2 size={15} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--success)' }} /> : <Info size={15} strokeWidth={2} aria-hidden="true" />}
          {runStateLabel(progress.state)}
        </strong>
        <button type="button" className="xa-btn xa-btn--icon" aria-label="Dismiss summary" onClick={() => useWorkflowEditorStore.getState().clearRun()}>
          <X size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="xw-summary-stats">
        <span>
          <b>{fmtDuration(s.durationMs)}</b> duration
        </span>
        <span>
          <b>{s.costUsd > 0 ? `$${s.costUsd.toFixed(4)}` : 'free'}</b> {s.costUsd > 0 ? 'cost' : 'local'}
        </span>
        <span>
          <b>{s.nodesCompleted}</b> done{s.nodesFailed ? ` · ${s.nodesFailed} failed` : ''}{s.nodesSkipped ? ` · ${s.nodesSkipped} skipped` : ''}
        </span>
        <span>
          <b>{s.artifacts}</b> {s.artifacts === 1 ? 'artifact' : 'artifacts'}
        </span>
      </div>
      {s.error ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--danger)' }}>{s.error}</p> : null}
      <div className="xa-row">
        <button type="button" className="xa-btn xa-btn--sm xa-btn--primary" onClick={() => void useWorkflowEditorStore.getState().rerun()} data-testid="wf-rerun">
          Re-run
        </button>
        <button type="button" className="xa-btn xa-btn--sm" onClick={() => void useWorkflowEditorStore.getState().saveAsTemplate()}>
          Save as template
        </button>
      </div>
    </div>
  );
}

export function FailureBanner() {
  const runError = useWorkflowEditorStore((s) => s.runError);
  const docError = useWorkflowEditorStore((s) => s.docError);
  const engineDown = useWorkflowEditorStore((s) => s.engineDown);
  const msg = runError ?? docError;
  if (!msg && !engineDown) return null;
  return (
    <div className={`xw-banner ${msg ? 'xw-banner--danger' : 'xw-banner--warn'}`} role="alert" data-testid="wf-banner">
      <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
      <span>{msg ?? 'The engine is not reachable. You can keep editing; saving and running need it.'}</span>
      {msg ? (
        <button type="button" className="xa-btn xa-btn--sm" style={{ marginLeft: 'auto' }} onClick={() => useWorkflowEditorStore.setState({ runError: null, docError: null })}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export function HistorySheet() {
  const open = useWorkflowEditorStore((s) => s.historyOpen);
  const history = useWorkflowEditorStore((s) => s.history);
  const current = useWorkflowEditorStore((s) => s.progress?.runId ?? null);
  return (
    <Dialog open={open} onOpenChange={(o) => useWorkflowEditorStore.getState().setHistoryOpen(o)}>
      <DialogContent className="max-w-[520px]" data-testid="wf-history">
        <DialogHeader>
          <DialogTitle>Run history</DialogTitle>
          <DialogDescription>Runs of this workflow recorded by the engine. Opening one re-attaches to its state.</DialogDescription>
        </DialogHeader>
        <ul className="xw-list" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {history.length === 0 ? <li className="xa-help">No runs yet.</li> : null}
          {history.map((r) => (
            <li key={r.runId}>
              <button
                type="button"
                className="xw-list-item"
                aria-current={r.runId === current}
                onClick={() => {
                  useWorkflowEditorStore.getState().setHistoryOpen(false);
                  void useWorkflowEditorStore.getState().attachRun(r.runId);
                }}
              >
                <strong>
                  v{r.definitionVersion} · {runStateLabel(r.state)}
                </strong>
                <span>
                  {new Date(r.createdAt).toLocaleString()} · {r.nodesCompleted}/{r.nodeCount} nodes · {r.cost.actualUsd > 0 ? `$${r.cost.actualUsd.toFixed(4)}` : 'free'}
                  {r.error ? ` · ${r.error}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
