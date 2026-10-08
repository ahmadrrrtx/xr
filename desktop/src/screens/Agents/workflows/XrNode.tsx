/*
 * Canvas node (Phase 19). One component for every kind; colour, shape and
 * ports come from canvasCore's kind metadata. Run state is read per node
 * from the editor store (engine events only — nothing is scripted).
 * Human nodes show inline Approve/Deny while the engine is waiting; the
 * same decision endpoint backs the central modal and Shield.
 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Check, Clock, X } from 'lucide-react';
import { memo } from 'react';

import { kindMeta, type XrFlowNode } from '@/agents/canvasCore';
import { nodeRunAttr } from '@/agents/reduce';
import { useWorkflowEditorStore } from '@/stores/workflowEditorStore';

function subtitle(kind: string, config: Record<string, unknown>): string {
  const s = (k: string): string => String(config[k] ?? '').trim();
  switch (kind) {
    case 'input':
      return s('paramName') ? `${s('paramName')} · ${s('paramType') || 'string'}${config.required ? ' · required' : ''}` : 'unnamed parameter';
    case 'llm':
      return s('instruction') ? s('instruction') : `${s('agentRole') || 'executor'} · $${Number(config.maxUsd ?? 0.5).toFixed(2)} cap`;
    case 'subagent':
      return s('agentId') || 'no agent chosen';
    case 'tool':
      return s('tool') ? `${s('tool')}${config.requiresApproval ? ' · asks first' : ''}` : 'no tool chosen';
    case 'branch':
      return s('conditionType') === 'field_compare' ? `${s('field') || '?'} ${s('operator') || 'eq'} ${s('value')}` : s('conditionType').replace(/_/g, ' ');
    case 'join':
      return `${s('strategy') || 'all'}${s('strategy') === 'n_of_m' ? ` · n=${String(config.n ?? 1)}` : ''}`;
    case 'human_approval':
    case 'human_review':
      return s('summary') || 'no summary yet';
    case 'wait':
      return s('mode') === 'event' ? `event · ${s('eventName') || '?'}` : `${Math.round(Number(config.durationMs ?? 0) / 1000)} s`;
    case 'notification':
      return s('message') || 'empty message';
    case 'artifact':
      return `${s('type') || 'report'} · ${s('format') || 'markdown'}`;
    case 'output':
      return s('outcome') || 'success';
    default:
      return '';
  }
}

function XrNodeImpl({ id, data, selected }: NodeProps<XrFlowNode>) {
  const meta = kindMeta(data.kind);
  const run = useWorkflowEditorStore((s) => s.progress?.nodes[id]?.state);
  const error = useWorkflowEditorStore((s) => s.progress?.nodes[id]?.error);
  const deciding = useWorkflowEditorStore((s) => s.deciding === id);
  const pending = useWorkflowEditorStore((s) => s.progress?.pendingHuman.some((h) => h.nodeId === id) ?? false);
  const runState = nodeRunAttr(run);
  const pill = meta.shape === 'pill';
  const sub = subtitle(data.kind, data.config);
  const isHuman = data.kind === 'human_approval' || data.kind === 'human_review';

  return (
    <div
      className={`xw-node${pill ? ' xw-node--pill' : ''}${selected ? ' xw-node--selected' : ''}`}
      style={{ ['--xw-color' as string]: meta.color }}
      data-run={runState}
      data-kind={data.kind}
      data-testid={`wf-node-${id}`}
      aria-label={`${meta.label} node ${data.label}${run ? `, ${run.replace(/_/g, ' ')}` : ''}`}
      title={error ?? undefined}
    >
      {meta.targets.map((t) => (
        <Handle key={t} id={t} type="target" position={Position.Left} />
      ))}
      {pill ? (
        <>
          <span className="xw-node-kind">{meta.label}</span>
          <span className="xw-node-name" title={data.label}>
            {data.label}
          </span>
        </>
      ) : (
        <>
          <div className="xw-node-head">
            <span className="xw-node-kind">{meta.label}</span>
            <span className="xw-node-name" title={data.label}>
              {data.label}
            </span>
          </div>
          <span className="xw-node-sub" title={sub}>
            {sub}
          </span>
          {isHuman && pending && runState === 'waiting' ? (
            <div className="xw-node-actions nodrag nopan" role="group" aria-label="Decide now">
              <button type="button" disabled={deciding} onClick={() => void useWorkflowEditorStore.getState().decide(id, 'approve')} data-testid={`wf-node-approve-${id}`}>
                {data.kind === 'human_review' ? 'Accept' : 'Approve'}
              </button>
              <button type="button" disabled={deciding} onClick={() => void useWorkflowEditorStore.getState().decide(id, data.kind === 'human_review' ? 'reject' : 'deny')} data-testid={`wf-node-deny-${id}`}>
                {data.kind === 'human_review' ? 'Reject' : 'Deny'}
              </button>
            </div>
          ) : null}
        </>
      )}
      {runState === 'completed' ? (
        <span className="xw-node-badge" aria-hidden="true">
          <Check size={11} strokeWidth={2.5} />
        </span>
      ) : runState === 'failed' ? (
        <span className="xw-node-badge" aria-hidden="true">
          {run === 'blocked' ? <AlertTriangle size={10} strokeWidth={2.5} /> : <X size={11} strokeWidth={2.5} />}
        </span>
      ) : runState === 'waiting' ? (
        <span className="xw-node-badge" aria-hidden="true" style={{ color: 'var(--warning)' }}>
          <Clock size={10} strokeWidth={2.5} />
        </span>
      ) : null}
      {meta.sources.length === 2 ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: '35%' }} />
          <span className="xw-port-label" style={{ top: 'calc(35% - 7px)' }}>
            true
          </span>
          <Handle id="false" type="source" position={Position.Right} style={{ top: '72%' }} />
          <span className="xw-port-label" style={{ top: 'calc(72% - 7px)' }}>
            false
          </span>
        </>
      ) : (
        meta.sources.map((s) => <Handle key={s} id={s} type="source" position={Position.Right} />)
      )}
    </div>
  );
}

export const XrNode = memo(XrNodeImpl);
