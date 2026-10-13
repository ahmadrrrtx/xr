/*
 * Settings → Billing & Account (Phase 30).
 *
 * ## The rule this screen exists to keep
 *
 * XR Personal is free forever and fully functional, and this page is where that
 * claim is either kept or broken. So the free state is not an advertisement: it
 * is a **statement of what you have**, followed by one — exactly one — card that
 * mentions the paid tier. No popup, no watermark, no "Upgrade to use" on any
 * control, no countdown, no badge, no second nag on the way out.
 *
 * The paid state is the same page with the team's real numbers in place of the
 * upgrade card, because an owner with a subscription does not need to be sold
 * anything and Billing is the one screen where selling is actively unwelcome.
 *
 * ## Local-first
 *
 * Every fact on this page comes from the daemon, which verifies the licence
 * **offline**. Nothing here requires the cloud service to be reachable, and the
 * panel says so. Signing out changes nothing except the token: local memory,
 * workspaces, agents and settings are untouched, and the copy states it rather
 * than implying it.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  BadgeCheck,
  CircleAlert,
  CreditCard,
  ExternalLink,
  Loader2,
  LogOut,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { openUrl } from '@/lib/settingsApi';
import {
  license,
  session,
  signOut,
  usd,
  type BusinessFeature,
  type LicenseView,
  type SessionView,
} from '@/cloud/api';

/** Where the account screens live. One constant so it is changed in one place. */
const WEB = 'https://xr.rrrtx.ai';

/** Human labels for the eight gates. All of them are hosted services. */
const FEATURE_LABELS: Record<BusinessFeature, string> = {
  'team': 'Team members and roles',
  'team-workspaces': 'Shared team workspaces',
  'sso-admin': 'SSO administration',
  'managed-models': 'Managed cloud models',
  'relay': 'Cloud relay',
  'memory-sync': 'Team memory sync',
  'audit-export': 'Audit log and export',
  'admin-console': 'Admin console',
};

export function BillingTab() {
  const [state, setState] = useState<LicenseView | null>(null);
  const [account, setAccount] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Continuation shape for the same reason as the team-workspaces list: the
  // effect below starts the request, and every setState happens in a callback
  // rather than in the effect's own frame.
  const load = useCallback((): Promise<void> => {
    return Promise.all([license(), session()]).then(([licence, sess]) => {
      setState(licence);
      setAccount(sess);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const entitled = state?.entitled ?? false;

  async function onSignOut() {
    setBusy(true);
    try {
      await signOut();
      toast.success('Signed out', {
        description: 'Local memory, workspaces and settings are untouched.',
      });
      await load();
    } catch {
      toast.error('Could not sign out', {
        description: 'The engine link is not responding. Nothing local is affected.',
      });
    } finally {
      setBusy(false);
    }
  }

  function openWeb(path: string) {
    void openUrl(`${WEB}${path}`);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-[13px] text-text-tertiary">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        Reading licence state…
      </div>
    );
  }

  return (
    <>
      {/* ── the headline: what you have, right now ───────────────────────── */}
      <SettingsSection>
        <SettingRow
          label={
            <span className="flex items-center gap-1.5">
              {entitled ? (
                <BadgeCheck size={14} className="text-accent" aria-hidden="true" />
              ) : (
                <Sparkles size={14} className="text-text-tertiary" aria-hidden="true" />
              )}
              {entitled ? (state?.orgName ?? 'XR Business') : 'XR Personal'}
            </span>
          }
          description={
            entitled ? (
              <span>
                {state?.seats ?? 0} seat{state?.seats === 1 ? '' : 's'} ·{' '}
                {state?.plan === 'business' ? 'Business' : (state?.plan ?? 'Business')}
                {state?.daysRemaining != null ? ` · licence refreshes in ${state.daysRemaining} day${state.daysRemaining === 1 ? '' : 's'}` : ''}
              </span>
            ) : (
              <span>Free forever. Every feature in this app, on this machine, with no account.</span>
            )
          }
        >
          {entitled ? (
            <Button variant="secondary" size="sm" onClick={() => openWeb('/dashboard/billing')}>
              <ExternalLink size={13} aria-hidden="true" className="mr-1.5" />
              Open billing
            </Button>
          ) : null}
        </SettingRow>

        {/* The licence line is on every state, free included: a user should be
            able to see that nothing is being phoned home, not just be told it. */}
        <SettingRow
          label={
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-text-tertiary" aria-hidden="true" />
              Licence verification
            </span>
          }
          description="Signed tokens, verified offline against a key built into XR. No check-in, no heartbeat, no remote disable."
        >
          <span className="text-text-tertiary text-[12px]">
            {state?.status === 'none' ? 'No team' : state?.status}
          </span>
        </SettingRow>
      </SettingsSection>

      {/* ── a licence problem, stated once and never as an emergency ─────── */}
      {state?.reason ? (
        <SettingsSection>
          <SettingRow
            label={
              <span className="flex items-center gap-1.5">
                <CircleAlert size={14} className="text-accent" aria-hidden="true" />
                {state.status === 'grace' ? 'Licence past its renewal date' : 'About your team licence'}
              </span>
            }
            description={state.reason}
          >
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Check again
            </Button>
          </SettingRow>
        </SettingsSection>
      ) : null}

      {/* ── paid: what the team has, in plain rows ───────────────────────── */}
      {entitled ? (
        <>
          <SettingsSection
            title="Team"
            description="Included with Business. Every one of these is a hosted service — none of them is a switch on this machine."
          >
            {(state?.features ?? []).map((feature) => (
              <SettingRow key={feature} label={FEATURE_LABELS[feature] ?? feature}>
                <span className="text-[12px] text-accent">Included</span>
              </SettingRow>
            ))}
            <SettingRow
              label="Members and roles"
              description="Who is in the team, and what each of them can do."
            >
              <Button variant="ghost" size="sm" onClick={() => openWeb('/dashboard/members')}>
                Open
              </Button>
            </SettingRow>
            <SettingRow
              label="Team memory"
              description="Facts your team chose to share. Your private memory never leaves this machine."
            >
              <Button variant="ghost" size="sm" onClick={() => openWeb('/dashboard/memory')}>
                Open
              </Button>
            </SettingRow>
            <SettingRow label="Audit log" description="Administrative actions and data access, hash-chained.">
              <Button variant="ghost" size="sm" onClick={() => openWeb('/dashboard/audit')}>
                Open
              </Button>
            </SettingRow>
          </SettingsSection>

          <SettingsSection title="Account">
            <SettingRow
              label={
                <span className="flex items-center gap-1.5">
                  <CreditCard size={14} className="text-text-tertiary" aria-hidden="true" />
                  Payment method and invoices
                </span>
              }
              description="Handled entirely by Stripe. No card number reaches XR or this machine."
            >
              <Button variant="secondary" size="sm" onClick={() => openWeb('/dashboard/billing')}>
                Manage
              </Button>
            </SettingRow>
            <SettingRow
              label="Signed in as"
              description={account?.orgId ? `Organization ${account.orgId}` : 'Team session active.'}
            >
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onSignOut()}>
                <LogOut size={13} aria-hidden="true" className="mr-1.5" />
                Sign out
              </Button>
            </SettingRow>
            <SettingRow
              label="Signing out leaves everything in place"
              description="Local memory, workspaces, agents, skills and settings are untouched. This only removes the team session."
            />
          </SettingsSection>
        </>
      ) : null}

      {/* ── free: the single upgrade card, and nothing else ──────────────── */}
      {!entitled ? (
        <SettingsSection title="Team features">
          <SettingRow
            label="XR Business — $15 per user / month"
            description="Team members and roles, shared workspaces, SSO, pooled managed models, team memory, audit export and the admin console. 30-day trial, no card needed, capped at 5 seats while you try it."
          >
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => openWeb('/pricing')}>
                Details
              </Button>
              <Button variant="secondary" size="sm" onClick={() => openWeb('/auth/signup?intent=business')}>
                Start a trial
              </Button>
            </div>
          </SettingRow>
          <SettingRow
            label="Nothing here is required"
            description="XR works exactly as it does now whether you are signed in or not. There is no seat count, no expiry and no feature on this machine that a licence can turn off."
          />
        </SettingsSection>
      ) : null}

      {/* ── BYOK: free on every tier, and said so on the billing page ────── */}
      <SettingsSection title="Your own provider keys">
        <SettingRow
          label="Bring your own keys"
          description="Free on every plan, including Personal. Requests go from this machine straight to the provider — XR does not proxy them, meter them or see them."
        >
          <Button variant="ghost" size="sm" onClick={() => void openWeb('/dashboard/policies')}>
            Provider settings
          </Button>
        </SettingRow>
        {entitled ? (
          <SettingRow
            label="Managed models"
            description={`Pooled across the team with a per-user cap. ${usd(20_000_000)} per user per month included by default, and an organization ceiling above it.`}
          />
        ) : null}
      </SettingsSection>
    </>
  );
}
