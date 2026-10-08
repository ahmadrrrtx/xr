/*
 * Workflow toolbar (Phase 19): name · version · state · counts · run
 * progress · Save (dirty dot) · Run / Stop · zoom · arrange · ⋮ menu.
 * Run/Stop talk to the engine; Stop really cancels (engine `cancelRun`).
 */
import { useReactFlow } from '@xyflow/react';
import { ChevronLeft, LayoutGrid, Maximize2, Minus, MoreHorizontal, Pause, Play, Plus, Save, Square } from 'lucide-react';
import { useMemo, useState } from 'react';

import { countsLine, graphCounts } from '@/agents/canvasCore';
import { isActive, runFraction, runStateLabel } from '@/agents/reduce';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useWorkflowEditorStore } from '@/stores/workflowEditorStore';

export function Toolbar() {
  const rf = useReactFlow();
  const name = useWorkflowEditorStore((s) => s.name);
  const version = useWorkflowEditorStore((s) => s.version);
  const dirty = useWorkflowEditorStore((s) => s.dirty);
  const saving = useWorkflowEditorStore((s) => s.saving);
  const starting = useWorkflowEditorStore((s) => s.starting);
  const runState = useWorkflowEditorStore((s) => s.progress?.state ?? null);
  const fraction = useWorkflowEditorStore((s) => runFraction(s.progress, s.nodes.length));
  const summary = useWorkflowEditorStore((s) => s.summary);
  const nodeList = useWorkflowEditorStore((s) => s.nodes);
  const counts = useMemo(() => summary ?? graphCounts(nodeList), [summary, nodeList]);
  const problems = useWorkflowEditorStore((s) => s.problems);
  const problemsOpen = useWorkflowEditorStore((s) => s.problemsOpen);
  const cost = useWorkflowEditorStore((s) => s.progress?.cost?.actualUsd ?? 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const live = isActive(runState);
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.length - errors;

  return (
    <div className="xw-toolbar" role="toolbar" aria-label="Workflow actions" data-testid="wf-toolbar">
      <button type="button" className="xa-btn xa-btn--icon" aria-label="Back to workflows" title="Back to workflows" onClick={() => useWorkflowEditorStore.getState().closeDocument()} data-testid="wf-back">
        <ChevronLeft size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <input
        className="xw-name"
        value={name}
        aria-label="Workflow name"
        placeholder="Untitled workflow"
        maxLength={120}
        onChange={(e) => useWorkflowEditorStore.getState().setName(e.target.value)}
        data-testid="wf-name"
      />
      <span className="xw-tag" title="Saved version">
        {version ? `v${version}` : 'unsaved'}
      </span>
      <span className="xw-tag xw-tag--state" data-state={runState ?? 'idle'} aria-live="polite" data-testid="wf-state">
        {runStateLabel(runState)}
      </span>
      <span className="xw-tag" title="What the graph contains">
        {countsLine(counts)}
      </span>
      <button
        type="button"
        className="xw-tag"
        style={{ cursor: 'pointer', color: errors ? 'var(--danger)' : warnings ? 'var(--warning)' : undefined }}
        aria-pressed={problemsOpen}
        onClick={() => useWorkflowEditorStore.getState().setProblemsOpen(!problemsOpen)}
        data-testid="wf-problems-toggle"
      >
        {errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : 'no problems'}
      </button>
      {live || runState ? (
        <div className="xw-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-label="Run progress" title={cost ? `$${cost.toFixed(4)} so far` : undefined}>
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      ) : null}
      <span style={{ flex: 1 }} />
      <button type="button" className="xa-btn" disabled={saving || !dirty} onClick={() => void useWorkflowEditorStore.getState().save()} title="Save (⌘S)" data-testid="wf-save">
        <Save size={14} strokeWidth={1.75} aria-hidden="true" />
        {saving ? 'Saving…' : 'Save'}
        {dirty ? <span className="xw-dirty" aria-label="Unsaved changes" /> : null}
      </button>
      {live ? (
        <>
          {runState === 'paused' ? (
            <button type="button" className="xa-btn" onClick={() => void useWorkflowEditorStore.getState().resumeRun()} data-testid="wf-resume">
              <Play size={14} strokeWidth={1.75} aria-hidden="true" />
              Resume
            </button>
          ) : runState === 'running' || runState === 'queued' ? (
            <button type="button" className="xa-btn" onClick={() => void useWorkflowEditorStore.getState().pauseRun()} data-testid="wf-pause">
              <Pause size={14} strokeWidth={1.75} aria-hidden="true" />
              Pause
            </button>
          ) : null}
          <button type="button" className="xa-btn xw-stop" onClick={() => setConfirmStop(true)} disabled={runState === 'cancelling'} data-testid="wf-stop">
            <Square size={12} strokeWidth={2} aria-hidden="true" fill="currentColor" />
            {runState === 'cancelling' ? 'Stopping…' : 'Stop'}
          </button>
        </>
      ) : (
        <button type="button" className="xa-btn xw-run" disabled={starting || errors > 0} title={errors ? 'Fix the errors first' : 'Run (⌘↵)'} onClick={() => void useWorkflowEditorStore.getState().requestRun()} data-testid="wf-run">
          <Play size={13} strokeWidth={2} aria-hidden="true" fill="currentColor" />
          {starting ? 'Starting…' : 'Run'}
        </button>
      )}
      <span className="xw-sep" aria-hidden="true" />
      <button type="button" className="xa-btn xa-btn--icon" aria-label="Fit view" title="Fit view (⇧1)" onClick={() => void rf.fitView({ padding: 0.2, duration: 200 })}>
        <Maximize2 size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="xa-btn xa-btn--icon" aria-label="Zoom in" title="Zoom in (⌘+)" onClick={() => void rf.zoomIn({ duration: 120 })}>
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="xa-btn xa-btn--icon" aria-label="Zoom out" title="Zoom out (⌘−)" onClick={() => void rf.zoomOut({ duration: 120 })}>
        <Minus size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="xa-btn xa-btn--icon"
        aria-label="Auto-arrange"
        title="Auto-arrange (layered, left to right)"
        onClick={() => {
          useWorkflowEditorStore.getState().autoArrange();
          window.setTimeout(() => void rf.fitView({ padding: 0.2, duration: 200 }), 30);
        }}
        data-testid="wf-arrange"
      >
        <LayoutGrid size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="xa-btn xa-btn--icon" aria-label="More workflow actions" data-testid="wf-more">
            <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[210px]">
          <DropdownMenuItem onSelect={() => void useWorkflowEditorStore.getState().duplicate()}>Duplicate</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void useWorkflowEditorStore.getState().exportJson()}>Export JSON</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useWorkflowEditorStore.getState().setHistoryOpen(true)} data-testid="wf-history-open">
            Run history
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useWorkflowEditorStore.getState().closeDocument()}>All workflows</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => setConfirmDelete(true)}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name || 'this workflow'}?</AlertDialogTitle>
            <AlertDialogDescription>Every saved version is removed from the engine. Past runs stay in history. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-danger text-white hover:bg-danger/90" onClick={() => void useWorkflowEditorStore.getState().remove()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent data-testid="wf-stop-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this run?</AlertDialogTitle>
            <AlertDialogDescription>The engine cancels the running node and marks the rest cancelled. Work already written to disk stays.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Keep running</AlertDialogCancel>
            <AlertDialogAction className="bg-danger text-white hover:bg-danger/90" onClick={() => void useWorkflowEditorStore.getState().cancelRun()} data-testid="wf-stop-confirm">
              Stop run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
