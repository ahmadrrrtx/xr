/*
 * Workflows tab (Phase 19) — lazy chunk that owns React Flow (and its
 * stylesheet). Layout: toolbar · palette | canvas | inspector · problems.
 *
 * The canvas is a view of workflowEditorStore. Everything that persists or
 * runs goes through the engine: save compiles the graph server-side into a
 * canonical WorkflowDefinition, run streams engine events back. No local
 * simulation anywhere.
 */
import { Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type EdgeTypes, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { describeGraph, isCanvasKind, kindMeta, NODE_KINDS } from '@/agents/canvasCore';
import type { CanvasNodeKind } from '@/agents/api';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkflowEditorStore } from '@/stores/workflowEditorStore';

import { Inspector } from './Inspector';
import { DRAG_MIME } from '../icons';
import { Palette } from './Palette';
import { ProblemsPanel } from './ProblemsPanel';
import { ApprovalModal, CompletionSummary, FailureBanner, HistorySheet, RunParamsDialog } from './RunPanels';
import { Toolbar } from './Toolbar';
import { WorkflowLibrary } from './WorkflowLibrary';
import { XrEdge } from './XrEdge';
import { XrNode } from './XrNode';

const nodeTypes: NodeTypes = { xr: XrNode };
const edgeTypes: EdgeTypes = { xr: XrEdge };

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function WorkflowsTab() {
  const hasDoc = useWorkflowEditorStore((s) => s.nodes.length > 0 || s.definitionId !== null);
  const loadingDoc = useWorkflowEditorStore((s) => s.loadingDoc);
  const [params] = useSearchParams();
  const openedLast = useRef(false);

  // First visit with nothing open: reopen the last workflow (settings) —
  // unless the URL carries its own intent (handled by AgentsScreen).
  useEffect(() => {
    if (openedLast.current) return;
    openedLast.current = true;
    if (hasDoc || params.get('new') || params.get('open')) return;
    const last = useSettingsStore.getState().settings.agents.lastWorkflowId;
    if (last) void useWorkflowEditorStore.getState().open(last);
  }, [hasDoc, params]);

  if (!hasDoc) {
    return (
      <div className="xw-root" data-testid="workflows-tab">
        <FailureBanner />
        {loadingDoc ? <div className="xa-scroll" aria-busy="true"><div className="xa-skeleton" style={{ height: 120 }} /></div> : <WorkflowLibrary />}
        <HistorySheet />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

function Editor() {
  const rf = useReactFlow();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const edges = useWorkflowEditorStore((s) => s.edges);
  const name = useWorkflowEditorStore((s) => s.name);
  const problemsOpen = useWorkflowEditorStore((s) => s.problemsOpen);
  const inspectorOpen = useWorkflowEditorStore((s) => s.inspectorOpen);
  const announce = useWorkflowEditorStore((s) => s.announce);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [ctxNode, setCtxNode] = useState<string | null>(null);
  const [ctxPoint, setCtxPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const focusName = useCallback((): void => {
    window.requestAnimationFrame(() => {
      const el = document.getElementById('xw-insp-name') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isEditable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const st = useWorkflowEditorStore.getState();
      const k = e.key;
      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        st.deleteSelection();
      } else if (mod && k.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && k.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
      } else if (mod && k.toLowerCase() === 'c') {
        e.preventDefault();
        st.copy();
      } else if (mod && k.toLowerCase() === 'x') {
        e.preventDefault();
        st.cut();
      } else if (mod && k.toLowerCase() === 'v') {
        e.preventDefault();
        st.paste();
      } else if (mod && k.toLowerCase() === 'd') {
        e.preventDefault();
        st.duplicateSelection();
      } else if (mod && k.toLowerCase() === 'a') {
        e.preventDefault();
        st.selectAll();
      } else if (mod && k.toLowerCase() === 's') {
        e.preventDefault();
        void st.save();
      } else if (mod && k === 'Enter') {
        e.preventDefault();
        void st.requestRun();
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        void rf.zoomIn({ duration: 120 });
      } else if (mod && k === '-') {
        e.preventDefault();
        void rf.zoomOut({ duration: 120 });
      } else if (e.shiftKey && k === '!') {
        e.preventDefault();
        void rf.fitView({ padding: 0.2, duration: 200 });
      } else if (k.startsWith('Arrow')) {
        if (!st.nodes.some((n) => n.selected)) return;
        e.preventDefault();
        const step = e.shiftKey ? 20 : 5;
        st.nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
      } else if (k === 'Enter' && st.selectedNodeId) {
        e.preventDefault();
        st.setInspectorOpen(true);
        focusName();
      } else if (k === 'Escape') {
        st.selectNode(null);
      }
    },
    [rf, focusName],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const kind = e.dataTransfer.getData(DRAG_MIME);
      if (!isCanvasKind(kind)) return;
      e.preventDefault();
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      useWorkflowEditorStore.getState().addNode(kind, { x: Math.round(p.x - 110), y: Math.round(p.y - 24) });
    },
    [rf],
  );

  const addAt = (kind: CanvasNodeKind): void => {
    const p = rf.screenToFlowPosition(ctxPoint);
    useWorkflowEditorStore.getState().addNode(kind, { x: Math.round(p.x), y: Math.round(p.y) });
  };

  return (
    <div className="xw-root" data-testid="workflows-tab" ref={rootRef} onKeyDown={onKeyDown}>
      <Toolbar />
      <FailureBanner />
      <div className="xw-body">
        <Palette />
        <div className="xw-canvas-col">
          <ContextMenu onOpenChange={(o) => !o && setCtxNode(null)}>
            <ContextMenuTrigger asChild>
              <div
                className="xw-canvas"
                data-testid="wf-canvas"
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(DRAG_MIME)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={onDrop}
              >
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={useWorkflowEditorStore.getState().onNodesChange}
                  onEdgesChange={useWorkflowEditorStore.getState().onEdgesChange}
                  onConnect={useWorkflowEditorStore.getState().onConnect}
                  onNodeDragStart={() => useWorkflowEditorStore.getState().beginDrag()}
                  onNodeDragStop={() => useWorkflowEditorStore.getState().endDrag()}
                  onNodeDoubleClick={(_, n) => {
                    useWorkflowEditorStore.getState().selectNode(n.id);
                    focusName();
                  }}
                  onNodeContextMenu={(e, n) => {
                    setCtxNode(n.id);
                    setCtxPoint({ x: e.clientX, y: e.clientY });
                    useWorkflowEditorStore.getState().selectNode(n.id);
                  }}
                  onPaneContextMenu={(e) => {
                    setCtxNode(null);
                    setCtxPoint({ x: e.clientX, y: e.clientY });
                  }}
                  onPaneClick={() => useWorkflowEditorStore.getState().selectNode(null)}
                  defaultEdgeOptions={{ type: 'xr' }}
                  connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 1.5 }}
                  deleteKeyCode={null}
                  panActivationKeyCode="Space"
                  selectionKeyCode="Shift"
                  multiSelectionKeyCode={['Meta', 'Control']}
                  zoomOnDoubleClick={false}
                  minZoom={0.25}
                  maxZoom={2}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  proOptions={{ hideAttribution: true }}
                  nodesFocusable
                  edgesFocusable
                  aria-label={`Workflow canvas: ${name}`}
                >
                  <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border-default)" />
                  <MiniMap pannable zoomable nodeColor={(n) => kindMeta((n.data as { kind: CanvasNodeKind }).kind).color} maskColor="color-mix(in srgb, var(--bg-void) 70%, transparent)" style={{ width: 160, height: 100 }} ariaLabel="Mini-map" />
                </ReactFlow>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-[200px]">
              {ctxNode ? (
                <>
                  <ContextMenuLabel>{nodes.find((n) => n.id === ctxNode)?.data.label ?? 'Node'}</ContextMenuLabel>
                  <ContextMenuItem onSelect={() => { useWorkflowEditorStore.getState().setInspectorOpen(true); focusName(); }}>Rename</ContextMenuItem>
                  <ContextMenuItem onSelect={() => useWorkflowEditorStore.getState().duplicateSelection()}>Duplicate</ContextMenuItem>
                  <ContextMenuItem onSelect={() => useWorkflowEditorStore.getState().copy()}>Copy</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem className="text-danger focus:text-danger" onSelect={() => useWorkflowEditorStore.getState().deleteSelection()}>
                    Delete
                  </ContextMenuItem>
                </>
              ) : (
                <>
                  <ContextMenuLabel>Add here</ContextMenuLabel>
                  {NODE_KINDS.filter((k) => ['llm', 'tool', 'branch', 'human_approval', 'output'].includes(k.kind)).map((k) => (
                    <ContextMenuItem key={k.kind} onSelect={() => addAt(k.kind)}>
                      {k.label}
                    </ContextMenuItem>
                  ))}
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => useWorkflowEditorStore.getState().paste()}>Paste</ContextMenuItem>
                  <ContextMenuItem onSelect={() => useWorkflowEditorStore.getState().selectAll()}>Select all</ContextMenuItem>
                  <ContextMenuItem onSelect={() => useWorkflowEditorStore.getState().autoArrange()}>Auto-arrange</ContextMenuItem>
                  <ContextMenuItem onSelect={() => void rf.fitView({ padding: 0.2, duration: reduced ? 0 : 200 })}>Fit view</ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
          <CompletionSummary />
          {problemsOpen ? <ProblemsPanel /> : null}
        </div>
        {inspectorOpen ? <Inspector /> : null}
      </div>

      {/* Screen-reader channel: live status + an on-demand graph description. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="wf-announce">
        {announce?.text ?? ''}
      </div>
      <details className="sr-only">
        <summary>Describe workflow</summary>
        <p>{describeGraph(name, nodes, edges)}</p>
      </details>

      <RunParamsDialog />
      <ApprovalModal />
      <HistorySheet />
    </div>
  );
}
