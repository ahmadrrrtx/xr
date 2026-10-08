/*
 * Canvas edge (Phase 19). Bezier; while a run is live the edge between a
 * completed node and a running one marches (400 ms), and settled edges
 * turn green. Both derive from engine node states via reduce.ts.
 */
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';

import { edgeActive, edgeDone } from '@/agents/reduce';
import { useWorkflowEditorStore } from '@/stores/workflowEditorStore';

function XrEdgeImpl({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, sourceHandleId }: EdgeProps) {
  const active = useWorkflowEditorStore((s) => edgeActive(s.progress, source, target));
  const done = useWorkflowEditorStore((s) => edgeDone(s.progress, source, target));
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const cls = active ? 'xw-edge-active' : done ? 'xw-edge-done' : undefined;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={cls}
        style={{ stroke: selected ? 'var(--accent)' : 'var(--border-default)', strokeWidth: selected ? 2 : 1.5 }}
      />
      {sourceHandleId === 'false' || sourceHandleId === 'true' ? (
        <text x={labelX} y={labelY - 6} textAnchor="middle" style={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>
          {sourceHandleId}
        </text>
      ) : null}
    </>
  );
}

export const XrEdge = memo(XrEdgeImpl);
