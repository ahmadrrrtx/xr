/*
 * Inline tool-call card (Phase 4) — collapsed row (icon + summary + status +
 * chevron), expands to pretty-printed input/output. Category-colored left
 * border; "waiting approval" is visual-only this phase (auto-continues in
 * the mock; the real Approval Modal is Phase 7).
 */
import {
  ChevronDown,
  Database,
  FileEdit,
  Loader2,
  Mail,
  Search,
  ShieldAlert,
  Terminal,
  Wrench,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import type { ToolCallRecord } from '@/lib/chat-db';
import { useApprovalStore } from '@/stores/approvalStore';

const ICONS: Record<string, typeof Mail> = {
  gmail: Mail,
  mail: Mail,
  email: Mail,
  web_search: Search,
  search: Search,
  write_file: FileEdit,
  file: FileEdit,
  shell: Terminal,
  terminal: Terminal,
  db: Database,
  database: Database,
};

const CATEGORY_BORDER: Record<ToolCallRecord['category'], string> = {
  llm: 'var(--accent)',
  tool: 'var(--wait)',
  file: 'var(--warning)',
  network: 'var(--success)',
  shell: 'var(--danger)',
  approval: 'var(--warning)',
};

function StatusIcon({ status }: { status: ToolCallRecord['status'] }) {
  if (status === 'running')
    return (
      <Loader2
        aria-hidden="true"
        className="text-wait size-4 shrink-0 animate-spin"
        strokeWidth={1.5}
      />
    );
  if (status === 'done')
    return (
      <span aria-label="done" className="text-success text-[13px] leading-none font-bold">
        ✓
      </span>
    );
  if (status === 'error')
    return (
      <span aria-label="failed" className="text-danger text-[13px] leading-none font-bold">
        ✗
      </span>
    );
  return (
    <ShieldAlert
      aria-label="waiting approval"
      className="text-warning size-4 shrink-0"
      strokeWidth={1.5}
    />
  );
}

function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

export function ToolCallCard({ call }: { call: ToolCallRecord | null }) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  if (!call) return null;
  const Icon = ICONS[call.tool] ?? Wrench;

  const statusLabel: Record<ToolCallRecord['status'], string> = {
    running: 'running',
    done: 'done',
    error: 'failed',
    'waiting-approval': 'waiting approval',
  };

  return (
    <div
      role="region"
      aria-label={`Tool call: ${call.summary} — ${statusLabel[call.status]}`}
      className="border-border-subtle bg-black/20 my-2 w-full overflow-hidden rounded-lg border border-l-[3px]"
      style={{ borderLeftColor: CATEGORY_BORDER[call.category] }}
    >
      <button
        type="button"
        onClick={() => {
          if (call.status === 'waiting-approval') {
            // Surface the approval this call is parked on (queue-aware:
            // bring it to the modal even if others are queued ahead).
            const { pending, activate } = useApprovalStore.getState();
            const linked = call.approvalId
              ? pending.find((r) => r.id === call.approvalId)
              : pending[0];
            if (linked) activate(linked.id);
          }
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        title={
          call.status === 'waiting-approval'
            ? 'Waiting for your approval — click to review'
            : undefined
        }
        className="hover:bg-bg-raised/40 flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
      >
        <Icon aria-hidden="true" className="text-text-secondary size-4 shrink-0" strokeWidth={1.5} />
        <span className="text-text-primary min-w-0 flex-1 truncate text-[14px]">
          {call.summary}
        </span>
        <span className="text-text-tertiary font-mono text-[10px] uppercase select-none">
          {call.tool}
        </span>
        <StatusIcon status={call.status} />
        <ChevronDown
          aria-hidden="true"
          className="text-text-tertiary size-3.5 shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
          strokeWidth={1.5}
        />
      </button>

      {expanded && (
        <motion.div
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="border-border-subtle max-h-[200px] overflow-y-auto border-t px-3 py-2"
        >
          {call.input !== undefined && (
            <div className="mb-2">
              <div className="text-text-tertiary mb-1 font-mono text-[10px] tracking-wide uppercase">
                input
              </div>
              <pre className="bg-black/30 rounded p-2 font-mono text-[12px] leading-5 overflow-x-auto">
                <code>{pretty(call.input)}</code>
              </pre>
            </div>
          )}
          {call.error ? (
            <div>
              <div className="text-text-tertiary mb-1 font-mono text-[10px] tracking-wide uppercase">
                error
              </div>
              <pre className="text-danger rounded p-2 font-mono text-[12px] leading-5">
                <code>{call.error}</code>
              </pre>
            </div>
          ) : (
            call.output && (
              <div>
                <div className="text-text-tertiary mb-1 font-mono text-[10px] tracking-wide uppercase">
                  output
                </div>
                <pre className="bg-black/30 rounded p-2 font-mono text-[12px] leading-5 overflow-x-auto">
                  <code>{call.output}</code>
                </pre>
              </div>
            )
          )}
        </motion.div>
      )}
    </div>
  );
}
