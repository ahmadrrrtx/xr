/*
 * Audit entry slide-over (Phase 12): 420 px panel from the right with
 * Detail / Payload / Chain tabs and "Copy entry JSON". Escape closes (the
 * screen's key handler). Chain tab shows the entry's links and can verify
 * the whole chain on demand — the verdict is phrased as what was checked.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Copy, Link2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { fmtCost, fmtWhen } from '@/shield/core';
import type { AuditEntry } from '@/shield/types';
import { useShieldStore } from '@/stores/shieldStore';

import { ActorChip, DecisionMark, JsonView, Mono, RiskChip } from './shared';

type Pane = 'detail' | 'payload' | 'chain';
const PANES: { id: Pane; label: string }[] = [
  { id: 'detail', label: 'Detail' },
  { id: 'payload', label: 'Payload' },
  { id: 'chain', label: 'Chain' },
];

export function AuditSlideOver({
  extra = [],
  engineChainValid = null,
}: {
  /** Phase 14: engine-recorded rows shown alongside the desktop log. */
  extra?: AuditEntry[];
  engineChainValid?: boolean | null;
}) {
  const selectedId = useShieldStore((s) => s.selectedAuditId);
  const local = useShieldStore((s) =>
    selectedId ? s.audit.find((e) => e.id === selectedId) : undefined
  );
  const entry = local ?? (selectedId ? extra.find((e) => e.id === selectedId) : undefined);
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {entry && (
        <motion.aside
          key={entry.id}
          role="dialog"
          aria-modal="false"
          aria-label={`Audit entry ${entry.id}`}
          data-testid="audit-slideover"
          initial={reduced ? { opacity: 0 } : { x: 24, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
          exit={{
            x: reduced ? 0 : 24,
            opacity: 0,
            transition: { duration: 0.16 },
          }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="border-border-subtle bg-bg-ink absolute top-0 right-0 bottom-0 z-30 flex w-[420px] max-w-full flex-col border-l shadow-xl"
        >
          <Body entry={entry} engineChainValid={engineChainValid} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Body({ entry, engineChainValid }: { entry: AuditEntry; engineChainValid: boolean | null }) {
  const [pane, setPane] = useState<Pane>('detail');
  const fromEngine = entry.id.startsWith('eng_');
  const closeRef = useRef<HTMLButtonElement>(null);
  const chain = useShieldStore((s) => s.chain);
  const audit = useShieldStore((s) => s.audit);
  const position = audit.length - audit.findIndex((e) => e.id === entry.id);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
  }, [entry.id]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      toast('Copied entry JSON');
    } catch {
      toast('Copy failed — clipboard unavailable');
    }
  };

  const verify = async (): Promise<void> => {
    setVerifying(true);
    try {
      const res = await useShieldStore.getState().verifyChain();
      if (res.valid)
        toast.success('Audit chain intact', { description: res.detail });
      else toast.error('Audit chain broken', { description: res.detail });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <header className="border-border-subtle flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <DecisionMark
          decision={entry.decision}
          className="text-text-primary text-[13px] font-medium"
        />
        <Mono className="text-text-tertiary ml-1 truncate text-[11px]">
          {entry.id}
        </Mono>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          data-testid="slideover-close"
          onClick={() => useShieldStore.getState().selectAudit(null)}
          className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </header>

      <div
        role="tablist"
        aria-label="Entry views"
        className="border-border-subtle flex h-9 shrink-0 items-center border-b px-2"
      >
        {PANES.map((p) => (
          <button
            key={p.id}
            role="tab"
            type="button"
            aria-selected={pane === p.id}
            onClick={() => setPane(p.id)}
            className={cn(
              'relative h-full cursor-pointer px-3 text-[12px] transition-colors',
              pane === p.id
                ? 'text-text-primary font-medium'
                : 'text-text-tertiary hover:text-text-secondary'
            )}
          >
            {p.label}
            {pane === p.id && (
              <span
                aria-hidden="true"
                className="bg-accent absolute right-1 -bottom-px left-1 h-[1.5px] rounded-full"
              />
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void copy()}
          data-testid="copy-entry-json"
          className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised ml-auto flex h-6 cursor-pointer items-center gap-1 rounded px-2 font-mono text-[11px]"
        >
          <Copy size={11} strokeWidth={1.5} aria-hidden="true" />
          Copy entry JSON
        </button>
      </div>

      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
        {pane === 'detail' && (
          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2.5 text-[12px]">
            <Field label="Time">{fmtWhen(entry.ts)}</Field>
            <Field label="Actor">
              <ActorChip actor={entry.actor} />
            </Field>
            <Field label="Skill">{entry.skill ?? '—'}</Field>
            <Field label="Action">
              <span className="text-text-primary">{entry.action}</span>
            </Field>
            <Field label="Resource">
              <Mono className="break-all">{entry.resource ?? '—'}</Mono>
            </Field>
            <Field label="Decision">
              <DecisionMark decision={entry.decision} />
            </Field>
            <Field label="Risk">
              <RiskChip risk={entry.risk} />
            </Field>
            <Field label="Cost">
              <Mono>{fmtCost(entry.costUsd)}</Mono>
            </Field>
            <Field label="Rule ID">
              <Mono className="break-all">{entry.ruleId ?? '—'}</Mono>
            </Field>
            <Field label="Detail">
              <span className="text-text-secondary leading-relaxed">
                {entry.detail ?? '—'}
              </span>
            </Field>
          </dl>
        )}
        {pane === 'payload' && (
          <JsonView value={entry} maxHeight={520} testId="entry-payload" />
        )}
        {pane === 'chain' && fromEngine && (
          <div className="flex flex-col gap-3 text-[12px]" data-testid="audit-chain-engine">
            <p className="text-text-tertiary leading-relaxed">
              This entry was recorded by the XR engine in its own append-only,
              hash-chained log. The engine verifies that chain itself; the
              desktop shows the result and never recomputes it.
            </p>
            <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2.5">
              <Field label="hash">
                <Mono className="break-all">{entry.hash}</Mono>
              </Field>
              <Field label="engine chain">
                {engineChainValid === null
                  ? 'Not reported'
                  : engineChainValid
                    ? 'Verified by the engine'
                    : 'Broken — the engine reports a chain mismatch'}
              </Field>
            </dl>
          </div>
        )}
        {pane === 'chain' && !fromEngine && (
          <div className="flex flex-col gap-3 text-[12px]">
            <p className="text-text-tertiary leading-relaxed">
              Each entry stores the SHA-256 of its canonical form and the hash
              of the entry before it. Hash-chained — Ed25519 checkpoint
              signatures are planned, so <Mono>signature</Mono> is null today.
            </p>
            <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2.5">
              <Field label="Position">
                #{position} of {audit.length}
              </Field>
              <Field label="prevHash">
                <Mono className="break-all">
                  {entry.prevHash ?? 'null (genesis)'}
                </Mono>
              </Field>
              <Field label="hash">
                <Mono className="break-all">{entry.hash}</Mono>
              </Field>
              <Field label="signature">
                <Mono>null</Mono>
              </Field>
            </dl>
            <div className="border-border-subtle bg-bg-raised/40 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-primary flex items-center gap-1.5 font-medium">
                  <Link2 size={13} strokeWidth={1.75} aria-hidden="true" />
                  Whole chain
                </span>
                <button
                  type="button"
                  onClick={() => void verify()}
                  disabled={verifying}
                  data-testid="verify-chain"
                  className="border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised h-7 cursor-pointer rounded-md border px-2 text-[12px] disabled:cursor-progress"
                >
                  {verifying ? 'Verifying…' : 'Verify now'}
                </button>
              </div>
              <p
                className="text-text-tertiary mt-1.5 leading-relaxed"
                data-testid="chain-verdict"
              >
                {chain
                  ? `${chain.valid ? 'Intact' : 'Broken'} — ${chain.detail}`
                  : 'Not verified in this session.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-tertiary pt-0.5">{label}</dt>
      <dd className="text-text-secondary min-w-0">{children}</dd>
    </>
  );
}
