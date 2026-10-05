/*
 * Inline tool-call card (Phase 4, Phase 9 trace link) — collapsed row
 * (icon + summary + status + chevron), expands to pretty-printed
 * input/output. Category-colored left border; "waiting approval" surfaces
 * the Phase 7 modal. Phase 9 adds a "View trace ↗" link that opens the
 * Brain run (reuses a live run when one is streaming, otherwise starts a
 * fresh demo run — real span deep-linking arrives with Phase 14).
 */
import {
  ChevronDown,
  Database,
  FileEdit,
  Loader2,
  Mail,
  Search,
  ShieldAlert,
  ShieldX,
  SquareArrowOutUpRight,
  Terminal,
  Wrench,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ToolCallRecord } from '@/lib/chat-db';
import { useApprovalStore } from '@/stores/approvalStore';
import { useBrainStore } from '@/stores/brainStore';

const ICONS: Record<string, typeof Mail> = {
  gmail: Mail,
  mail: Mail,
  email: Mail,
  web_search: Search,
  search: Search,
  write_file: FileEdit,
  read_file: FileEdit,
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
      <span
        aria-label="done"
        className="text-success text-[13px] leading-none font-bold"
      >
        ✓
      </span>
    );
  if (status === 'error')
    return (
      <span
        aria-label="failed"
        className="text-danger text-[13px] leading-none font-bold"
      >
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
  const navigate = useNavigate();
  if (!call) return null;
  const Icon = ICONS[call.tool] ?? Wrench;

  const statusLabel: Record<ToolCallRecord['status'], string> = {
    running: 'running',
    done: 'done',
    error: 'failed',
    'waiting-approval': 'waiting approval',
  };

  /**
   * Phase 9: open the Brain run behind this tool call. Loose coupling —
   * reuse a live run when one is streaming (it's almost certainly the same
   * agent loop), otherwise start a fresh demo run. Phase 14 replaces this
   * with a real `?span=sp_xxx` deep link into the production trace.
   */
  const openTrace = (): void => {
    const st = useBrainStore.getState();
    const live = st.runOrder.find(
      (id) =>
        st.runs[id]?.status === 'running' || st.runs[id]?.status === 'waiting'
    );
    const id = live ?? st.startMockRun(call.summary);
    navigate(`/brain/${id}`);
  };

  return (
    <div
      role="region"
      aria-label={`Tool call: ${call.summary} — ${call.blocked ? 'blocked by XR Shield' : statusLabel[call.status]}`}
      data-blocked={call.blocked ? 'true' : undefined}
      className="border-border-subtle my-2 w-full overflow-hidden rounded-lg border border-l-[3px] bg-black/20"
      style={{ borderLeftColor: CATEGORY_BORDER[call.category] }}
    >
      <div className="flex items-stretch">
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
          className="hover:bg-bg-raised/40 flex min-h-12 min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left transition-colors"
        >
          <Icon
            aria-hidden="true"
            className="text-text-secondary size-4 shrink-0"
            strokeWidth={1.5}
          />
          <span className="text-text-primary min-w-0 flex-1 truncate text-[14px]">
            {call.summary}
          </span>
          {call.blocked ? (
            // Phase 12: Shield answered by policy — no human was asked.
            <span
              data-testid="tool-blocked-badge"
              className="text-danger flex shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--danger)_45%,transparent)] px-1.5 py-px font-mono text-[10px] select-none"
            >
              <ShieldX size={11} strokeWidth={1.75} aria-hidden="true" />
              Blocked by XR Shield
            </span>
          ) : null}
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

        {/* Phase 9 — Brain trace link (running: ⌁ indicator, done: link) */}
        {call.status === 'running' ? (
          <button
            type="button"
            onClick={openTrace}
            title="Watch this run in the Brain"
            className="text-accent flex w-14 shrink-0 items-center justify-end gap-1 pr-3 font-mono text-[11px]"
            aria-label="Watch this run in the Brain"
          >
            <span
              aria-hidden="true"
              className="inline-block size-1.5 rounded-full bg-current"
              style={{ animation: 'xr-dot-pulse 1500ms ease-out infinite' }}
            />
            trace
          </button>
        ) : (
          <button
            type="button"
            onClick={openTrace}
            title="Open the full trace in the Brain"
            className="text-text-tertiary hover:text-accent focus-visible:ring-accent flex w-20 shrink-0 items-center justify-end gap-1 pr-3 font-mono text-[11px] focus-visible:ring-1 focus-visible:outline-none"
            aria-label={`View trace for ${call.summary} in the Brain`}
          >
            View trace
            <SquareArrowOutUpRight
              size={12}
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

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
              <pre className="overflow-x-auto rounded bg-black/30 p-2 font-mono text-[12px] leading-5">
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
                <pre className="overflow-x-auto rounded bg-black/30 p-2 font-mono text-[12px] leading-5">
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
