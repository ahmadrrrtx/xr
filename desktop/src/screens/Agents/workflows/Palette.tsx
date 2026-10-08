/*
 * Node palette (Phase 19). Drag a stencil onto the canvas, or click /
 * press Enter to add it to the right of the current selection. Grouped
 * exactly like the brief (Flow · AI · Actions · Human). No Loop stencil:
 * the engine's DAG has no loop primitive and we do not fake one.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { NODE_KINDS, PALETTE_GROUPS, type XrFlowNode } from '@/agents/canvasCore';
import type { CanvasNodeKind } from '@/agents/api';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkflowEditorStore } from '@/stores/workflowEditorStore';

import { DRAG_MIME, KIND_ICON } from '../icons';

function nextPosition(nodes: XrFlowNode[], selectedId: string | null): { x: number; y: number } {
  const anchor = nodes.find((n) => n.id === selectedId) ?? nodes[nodes.length - 1];
  if (!anchor) return { x: 80, y: 120 };
  return { x: anchor.position.x + 280, y: anchor.position.y };
}

export function Palette() {
  const collapsed = useSettingsStore((s) => s.settings.agents.paletteCollapsed);
  const toggle = (): void => useSettingsStore.getState().update('agents', { paletteCollapsed: !collapsed });
  const add = (kind: CanvasNodeKind): void => {
    const s = useWorkflowEditorStore.getState();
    s.addNode(kind, nextPosition(s.nodes, s.selectedNodeId));
  };

  return (
    <aside className={`xw-palette${collapsed ? ' xw-palette--collapsed' : ''}`} aria-label="Node palette" data-testid="wf-palette">
      <button type="button" className="xa-btn xa-btn--icon" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand palette' : 'Collapse palette'} style={{ alignSelf: collapsed ? 'center' : 'flex-end' }}>
        {collapsed ? <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /> : <ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />}
      </button>
      {PALETTE_GROUPS.map((g) => (
        <div key={g.id} className="xw-palette-group" role="group" aria-label={g.label}>
          {!collapsed ? <h4>{g.label}</h4> : null}
          {NODE_KINDS.filter((k) => k.group === g.id).map((k) => {
            const Icon = KIND_ICON[k.kind];
            return (
              <button
                key={k.kind}
                type="button"
                className="xw-stencil"
                style={{ ['--xw-color' as string]: k.color }}
                draggable
                title={collapsed ? `${k.label} — ${k.hint}` : k.hint}
                aria-label={`Add ${k.label} node`}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, k.kind);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => add(k.kind)}
                data-testid={`wf-stencil-${k.kind}`}
              >
                <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
                {!collapsed ? <span>{k.label}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
