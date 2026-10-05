/*
 * Shield enforcement wiring (Phase 12). Called once from the main-window
 * AppShell (`initShield()`); idempotent.
 *
 *   1. Installs the policy gate on the approval queue (lib/approvalGate.ts)
 *      — paused / shell-off / removed-skill → blocked; quarantined skill →
 *      prompt without remember rules; low risk + policy → auto-approved.
 *   2. Observes every approval outcome and writes the audit entry, whatever
 *      surface decided (modal, bell, Shield card, bulk, timeout, policy).
 *   3. Cross-window: `shield:emergency-revoke` / `shield:resumed` from Rust
 *      (another window pressed the button) close/open the local gate too.
 *   4. Compromised state → orb error blink + toast + bell notification.
 *   5. Settings → Privacy ⇄ policy mirror (PII redaction, data sharing).
 */
import { toast } from 'sonner';

import type { ApprovalRequest } from '@/lib/approvalCore';
import { decideApproval, sendNotification } from '@/lib/approvalEvents';
import {
  onApprovalEvent,
  setApprovalGate,
  type ApprovalEvent,
} from '@/lib/approvalGate';
import { orbSetState } from '@/lib/orb';
import { isTauri } from '@/lib/tauri';
import { deriveState, gateRequest } from '@/shield/core';
import type {
  AuditDecision,
  AuditInput,
  DecidedBy,
  RememberChoice,
} from '@/shield/types';
import { useApprovalStore } from '@/stores/approvalStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useShieldStore } from '@/stores/shieldStore';

let initialised = false;

/** Which agent a request came from — the mock surfaces don't say, yet. */
function actorFor(req: ApprovalRequest): string {
  return req.id.startsWith('brain-appr-') ? 'agent:brain' : 'agent:main';
}

/** The audit rule id that encodes who decided (history derives it back). */
function ruleIdFor(
  decidedBy: DecidedBy,
  remember: RememberChoice | null,
  ruleId: string | undefined
): string | null {
  switch (decidedBy) {
    case 'auto-rule':
      return `rule.${ruleId ?? 'remembered'}`;
    case 'auto-timeout':
      return 'auto.timeout';
    case 'bulk':
      return 'user.bulk';
    case 'policy':
      return ruleId ?? 'policy';
    default:
      return remember && remember !== 'once'
        ? `user.remember.${remember}`
        : null;
  }
}

function recordEvent(e: ApprovalEvent): void {
  const shield = useShieldStore.getState();
  const req = e.request;
  const base = {
    skill: req.skillId,
    action: req.action,
    resource: req.resource,
    risk: req.risk,
    costUsd: null,
  };
  let input: AuditInput;
  if (e.kind === 'queued') {
    if (!e.quarantined) return; // the decision is the record, not the ask
    input = {
      ...base,
      actor: actorFor(req),
      decision: 'quarantined',
      ruleId: 'policy.quarantine',
      detail: `${req.skillName} is quarantined — held for explicit approval (remember rules ignored).`,
    };
  } else if (e.kind === 'gated') {
    input = {
      ...base,
      actor: actorFor(req),
      decision: e.outcome.decision,
      ruleId: e.outcome.ruleId,
      detail: e.outcome.reason,
    };
  } else {
    const approved = e.decision.status === 'approved';
    const decision: AuditDecision =
      e.auditDecision ??
      (approved
        ? e.decidedBy === 'auto-rule'
          ? 'auto-approved'
          : 'allowed'
        : 'denied');
    const by =
      e.decidedBy === 'user' || e.decidedBy === 'bulk'
        ? 'user'
        : e.decidedBy === 'auto-timeout'
          ? 'system'
          : actorFor(req);
    input = {
      ...base,
      actor: by,
      decision,
      ruleId: ruleIdFor(e.decidedBy, e.remember, e.decision.ruleId),
      detail:
        e.decision.reason ??
        (e.decidedBy === 'auto-rule'
          ? 'A remember rule matched.'
          : approved
            ? e.remember && e.remember !== 'once'
              ? `Approved and remembered (${e.remember}).`
              : 'Approved from the prompt.'
            : 'Denied from the prompt.'),
    };
  }
  void shield.addAuditEntry(input);
}

/** Deny everything pending with the paused reason (another window revoked). */
function denyPendingPaused(): void {
  for (const r of useApprovalStore.getState().pending) {
    decideApproval(r.id, 'denied', {
      decidedBy: 'bulk',
      reason: 'XR is paused — all actions blocked',
      auditDecision: 'blocked',
      silent: true,
    });
  }
}

let blinkTimer: number | null = null;

/** Compromised: brief orb red blink, then back to whatever the queue says. */
function orbBlink(): void {
  void orbSetState('error');
  if (blinkTimer !== null) window.clearTimeout(blinkTimer);
  blinkTimer = window.setTimeout(() => {
    blinkTimer = null;
    const pending = useApprovalStore.getState().pending.length > 0;
    void orbSetState(pending ? 'waiting-approval' : 'idle');
  }, 1200);
}

export function initShield(): void {
  if (initialised) return;
  initialised = true;

  // 1. The gate reads live state on every call — no stale closure.
  setApprovalGate((req) => {
    const s = useShieldStore.getState();
    return gateRequest(req, {
      paused: s.paused,
      policy: s.policy,
      quarantine: s.quarantine,
    });
  });

  // 2. Every outcome becomes evidence.
  onApprovalEvent(recordEvent);

  // 3. Cross-window pause/resume (Rust re-broadcast).
  if (isTauri()) {
    void import('@tauri-apps/api/event')
      .then(({ listen }) => {
        void listen('shield:emergency-revoke', () => {
          if (!useShieldStore.getState().paused)
            useShieldStore.setState({ paused: true });
          denyPendingPaused();
        });
        void listen('shield:resumed', () => {
          useShieldStore.setState({ paused: false });
        });
      })
      .catch(() => undefined);
  }

  // 4. Compromised transitions.
  useShieldStore.subscribe((st, prev) => {
    if (st.checks === prev.checks) return;
    const now = deriveState(st.checks);
    const before = deriveState(prev.checks);
    if (now === 'compromised' && before !== 'compromised') {
      orbBlink();
      toast.error('XR Shield needs your attention.', {
        description: 'An integrity check failed. Open Shield to resolve it.',
        duration: 8000,
      });
      sendNotification({
        type: 'error',
        title: 'XR Shield needs your attention',
        body: 'An integrity check failed. Open Shield → Status to resolve it.',
        data: { route: '/shield' },
      });
    } else if (now === 'attention' && before === 'protected') {
      sendNotification({
        type: 'warning',
        title: 'Shield needs attention',
        body:
          st.checks.find((c) => c.status === 'warn' || c.status === 'fail')
            ?.detail ?? '',
        data: { route: '/shield' },
      });
    }
  });

  // 5. Settings → Privacy is the source of truth for two policy rows.
  useSettingsStore.subscribe((st, prev) => {
    if (st.settings.privacy === prev.settings.privacy) return;
    const shield = useShieldStore.getState();
    const { redactPii, telemetry } = st.settings.privacy;
    if (
      shield.policy.piiRedaction !== redactPii ||
      shield.policy.dataSharing !== telemetry
    ) {
      void shield.setPolicy({
        piiRedaction: redactPii,
        dataSharing: telemetry,
      });
    }
  });

  void useShieldStore.getState().load();
}

// Dev-only window hook (never shipped in prod): queue a few mixed-risk
// requests so the Approvals tab, bulk actions and quarantine badge can be
// exercised without a chat session. Mirrors paletteCommands' hook.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (
    window as unknown as { __xrShieldDemo?: (n?: number) => void }
  ).__xrShieldDemo = (n = 3) => {
    void import('@/lib/approvalEvents').then(({ requestApproval }) => {
      const specs = [
        {
          skillId: 'gmail-skill',
          skillName: 'gmail-skill',
          skillVersion: 'v1.2',
          skillIcon: 'mail',
          action: 'Send email',
          resource: 'sarah@company.com',
          risk: 'medium' as const,
          justification:
            'You asked me to send the Q3 portfolio update to Sarah.',
        },
        {
          skillId: 'shell-skill',
          skillName: 'shell-skill',
          skillVersion: 'v0.9',
          skillIcon: 'terminal',
          action: 'Run a shell command',
          resource: 'brew upgrade && brew cleanup',
          risk: 'high' as const,
          justification:
            'Homebrew packages are 3 weeks behind; upgrading fixes the ffmpeg error.',
        },
        {
          skillId: 'figma-plugin',
          skillName: 'figma-plugin',
          skillVersion: 'v0.3.1',
          skillIcon: 'web',
          action: 'Export frames',
          resource: 'Onboarding v3',
          risk: 'medium' as const,
          justification:
            'The design review needs PNGs of the four onboarding frames.',
        },
        {
          skillId: 'web-skill',
          skillName: 'web-skill',
          skillVersion: 'v2.0',
          skillIcon: 'globe',
          action: 'Fetch a web page',
          resource: 'https://docs.rs/sha2',
          risk: 'low' as const,
          justification:
            'Checking the sha2 crate API before suggesting a change.',
        },
      ];
      specs.slice(0, n).forEach((spec, i) => {
        window.setTimeout(() => {
          void requestApproval({
            id: `demo-${Date.now()}-${i}`,
            createdAt: Date.now(),
            ...spec,
          });
        }, i * 120);
      });
    });
  };
}
