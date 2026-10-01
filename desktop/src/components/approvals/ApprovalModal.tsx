/*
 * The Approval Modal (Phase 7) — "You approve every action that matters."
 *
 * Rendered ONCE at the app root (main window only) and fully controlled by
 * the approval store: whoever requests a permission, the oldest pending
 * request shows here, above every route. Safe defaults everywhere:
 *   - Escape / backdrop click / 60s-away countdown → DENY
 *   - initial focus lands on DENY (design-system spec)
 *   - Enter approves only when APPROVE itself is focused
 *   - "Allow once" is the default; remembering is opt-in
 */
import { Info, ShieldCheck } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import {
  ActionRow,
  BodyPreviewRow,
  JustificationRow,
  ResourceRow,
  RiskRow,
  SkillRow,
} from '@/components/approvals/ApprovalInfo';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  parseAutoDenyMs,
  remember1hLabel,
  rememberAlwaysLabel,
  type RememberKey,
} from '@/lib/approvalCore';
import { decideApproval } from '@/lib/approvalEvents';
import { cn } from '@/lib/utils';
import { useApprovalStore } from '@/stores/approvalStore';

const AUTO_DENY_STORAGE_KEY = 'xr.approval.autoDenyMs';

/** Read the (dev-overridable) auto-deny budget, in ms. */
function readAutoDenyMs(): number {
  try {
    return parseAutoDenyMs(window.localStorage.getItem(AUTO_DENY_STORAGE_KEY));
  } catch {
    return parseAutoDenyMs(null);
  }
}

/** The three remember options — radio-like checkboxes (spec wording). */
function RememberSection({
  alwaysLabel,
  hourLabel,
  value,
  onChange,
}: {
  alwaysLabel: string;
  hourLabel: string;
  value: RememberKey | null;
  onChange: (next: RememberKey | null) => void;
}) {
  const opts: { key: RememberKey | null; label: string }[] = [
    { key: 'always', label: alwaysLabel },
    { key: '1h', label: hourLabel },
    { key: null, label: 'Allow once' },
  ];
  return (
    <div className="mt-4 flex flex-col gap-2" role="group" aria-label="Remember this decision">
      {opts.map((opt) => (
        <label
          key={opt.key ?? 'once'}
          className="hover:bg-bg-raised/40 text-text-secondary flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[13px] transition-colors"
        >
          {/** radio semantics dressed as checkboxes — the three options are exclusive */}
          <input
            type="radio"
            name="xr-approval-remember"
            className="sr-only"
            checked={value === opt.key}
            onChange={() => onChange(opt.key)}
          />
          <span
            aria-hidden="true"
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-150',
              'border-border-default bg-bg-raised/40',
              value === opt.key && 'border-accent bg-accent text-accent-contrast'
            )}
          >
            {value === opt.key && (
              <span className="bg-accent-contrast size-1.5 rounded-full" />
            )}
          </span>
          {opt.label}
        </label>
      ))}
    </div>
  );
}

export function ApprovalModal() {
  const activeId = useApprovalStore((s) => s.activeId);
  const pending = useApprovalStore((s) => s.pending);
  const hydrate = useApprovalStore((s) => s.hydrate);
  const active = pending.find((r) => r.id === activeId) ?? null;
  const open = active !== null;

  const denyRef = useRef<HTMLButtonElement | null>(null);
  const reduced = useReducedMotion();

  // Per-request remember choice + countdown. Both reset when the shown
  // request changes — via the render-time reset below (no effect needed).
  const [remember, setRemember] = useState<RememberKey | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [prevActiveId, setPrevActiveId] = useState(activeId);

  // Auto-deny countdown — only while the user is AWAY (window blurred or
  // tab hidden). Refocusing cancels it; a fresh request resets it.
  const [away, setAway] = useState(false);

  if (prevActiveId !== activeId) {
    setPrevActiveId(activeId);
    setRemember(null);
    setSecondsLeft(null);
  }

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Track presence: window blur/focus + tab visibility.
  useEffect(() => {
    let blurred = false;
    const recompute = (): void =>
      setAway(blurred || (typeof document !== 'undefined' && document.hidden));
    const onWindowBlur = (): void => {
      blurred = true;
      recompute();
    };
    const onWindowFocus = (): void => {
      blurred = false;
      recompute();
    };
    const onVisibility = (): void => recompute();
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibility);
    recompute();
    return () => {
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Countdown engine: away + open → tick to zero → auto-deny. State only
  // ever changes from the async interval callback; the pill renders just the
  // derived `counting` view.
  const counting = open && away;
  useEffect(() => {
    if (!counting || !active) return;
    const totalMs = readAutoDenyMs();
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const left = Math.ceil((totalMs - (Date.now() - startedAt)) / 1000);
      if (left <= 0) {
        window.clearInterval(timer);
        setSecondsLeft(0);
        decideApproval(active.id, 'denied', {
          reason: 'Timed out — you were away',
        });
      } else {
        setSecondsLeft(left);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [counting, active]);

  if (!active) return null;

  const deny = (reason?: string): void =>
    decideApproval(active.id, 'denied', { reason });
  const approve = (): void =>
    decideApproval(active.id, 'approved', { remember: remember ?? undefined });

  const alwaysLabel =
    active.rememberOptions?.find((o) => o.key === 'always')?.label ??
    rememberAlwaysLabel(active);
  const hourLabel =
    active.rememberOptions?.find((o) => o.key === '1h')?.label ??
    remember1hLabel(active);

  return (
    <Dialog open={open}>
      <DialogContent
        role="alertdialog"
        aria-modal="true"
        showCloseButton={false}
        onEscapeKeyDown={() => deny('Dismissed with Escape')}
        onPointerDownOutside={() => deny('Dismissed — clicked outside')}
        onOpenAutoFocus={(e) => {
          // Safe default: land on DENY, never APPROVE.
          e.preventDefault();
          requestAnimationFrame(() => denyRef.current?.focus());
        }}
        className="bg-bg-ink approval-glow border-accent border-2 sm:max-w-[520px] w-[calc(100%-2rem)] rounded-xl p-6 duration-200"
      >
        {/** Screen-reader announcement (assertive) when the dialog opens. */}
        <p role="status" aria-live="assertive" className="sr-only">
          Permission required: {active.skillName} wants to{' '}
          {active.action.toLowerCase()}
          {active.resource ? ` — ${active.resource}` : ''}. Approve or deny.
        </p>

        {/* Header — Title/Description are the alertdialog's accessible name
            and description (Radix wires aria-labelledby/-describedby). */}
        <div className="mb-4 flex items-center gap-3">
          <span className="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-lg">
            <ShieldCheck size={22} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-text-primary text-left text-[20px] leading-tight font-bold">
              Permission required
            </DialogTitle>
            <DialogDescription className="text-text-secondary mt-0.5 truncate text-left text-[14px]">
              {active.skillName} wants to take an action.
            </DialogDescription>
          </div>
        </div>

        {/* Info cards */}
        <div className="flex flex-col gap-2">
          <SkillRow req={active} />
          <ActionRow req={active} />
          <ResourceRow req={active} />
          <BodyPreviewRow req={active} />
          <RiskRow req={active} />
          <JustificationRow req={active} />
        </div>

        {/* Remember options */}
        <RememberSection
          alwaysLabel={alwaysLabel}
          hourLabel={hourLabel}
          value={remember}
          onChange={setRemember}
        />

        {/* Decision buttons */}
        <div className="mt-6 flex gap-3">
          <motion.button
            ref={denyRef}
            type="button"
            onClick={() => deny()}
            whileTap={reduced ? undefined : { scale: 0.97 }}
            className={cn(
              'border-danger text-danger hover:bg-danger/10 focus-visible:ring-danger/40',
              'flex h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold tracking-wide uppercase',
              'focus-visible:ring-2 focus-visible:ring-offset-bg-ink focus-visible:outline-none'
            )}
          >
            Deny
          </motion.button>
          <motion.button
            type="button"
            onClick={approve}
            whileTap={reduced ? undefined : { scale: 0.97 }}
            autoFocus={false}
            className={cn(
              'bg-accent text-accent-contrast hover:bg-accent-hover focus-visible:ring-accent/40',
              'flex h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold tracking-wide uppercase',
              'focus-visible:ring-2 focus-visible:ring-offset-bg-ink focus-visible:outline-none'
            )}
          >
            Approve
            {counting && secondsLeft !== null && secondsLeft > 0 && (
              <span className="bg-accent-contrast/20 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium">
                {secondsLeft}s
              </span>
            )}
          </motion.button>
        </div>

        {/* Trust footer */}
        <p className="text-text-tertiary mt-4 flex items-center justify-center gap-1.5 text-center text-[12px]">
          <Info size={12} strokeWidth={1.5} aria-hidden="true" />
          XR will never auto-approve without your consent.
        </p>
      </DialogContent>
    </Dialog>
  );
}
