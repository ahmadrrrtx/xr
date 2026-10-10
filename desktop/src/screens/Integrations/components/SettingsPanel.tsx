/*
 * Settings popover body for a connected integration: who is connected, what XR
 * can and cannot do (plain English), last sync, Sync now, and Disconnect (with a
 * confirmation dialog that has a visible Cancel).
 */
import { Loader2, Minus, RefreshCw, Check, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { IntegrationView } from '@/integrations/api';
import { connectedSince, lastSyncLabel, requestedScopeLines } from '@/integrations/core';
import { useIntegrationsStore } from '@/stores/integrationsStore';

export function SettingsPanel({ view }: { view: IntegrationView }) {
  const busy = useIntegrationsStore((s) => s.busyId === view.id);
  const sync = useIntegrationsStore((s) => s.sync);
  const disconnect = useIntegrationsStore((s) => s.disconnect);
  const openPopover = useIntegrationsStore((s) => s.openPopover);
  const lines = requestedScopeLines(view);
  const since = connectedSince(view.connectedAt);
  const account = view.account?.login ?? view.account?.name ?? null;

  return (
    <div className="ix-settings" role="dialog" aria-label={`${view.name} settings`}>
      <header className="ix-settings__head">
        <div>
          <h4 className="ix-settings__title">{view.name}</h4>
          <p className="ix-settings__since">
            <span className="ix-dot ix-dot--ok" aria-hidden="true" /> {since ?? 'Connected'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => openPopover(null)} aria-label="Close settings">
          <X size={14} aria-hidden="true" />
        </Button>
      </header>

      <section className="ix-settings__section" aria-labelledby={`${view.id}-account`}>
        <h5 id={`${view.id}-account`} className="ix-settings__label">Account</h5>
        <p className="ix-settings__value">{account ?? 'Account not shown by the provider'}</p>
      </section>

      <section className="ix-settings__section" aria-labelledby={`${view.id}-perms`}>
        <h5 id={`${view.id}-perms`} className="ix-settings__label">Permissions</h5>
        <p className="ix-settings__sub">Will access</p>
        <ul className="ix-perm-list">
          {lines.willAccess.map((l) => (
            <li key={l}><Check size={12} aria-hidden="true" className="ix-perm--yes" /> {l}</li>
          ))}
        </ul>
        {lines.willNotAccess.length > 0 && (
          <>
            <p className="ix-settings__sub">Will NOT access</p>
            <ul className="ix-perm-list">
              {lines.willNotAccess.map((l) => (
                <li key={l}><Minus size={12} aria-hidden="true" className="ix-perm--no" /> {l}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="ix-settings__section" aria-labelledby={`${view.id}-sync`}>
        <h5 id={`${view.id}-sync`} className="ix-settings__label">Sync</h5>
        <div className="ix-settings__row">
          <span className="ix-settings__value" aria-live="polite">{lastSyncLabel(view.lastSyncAt)}</span>
          <Button variant="outline" size="sm" onClick={() => void sync(view.id)} disabled={busy} aria-busy={busy || undefined}>
            {busy ? <Loader2 size={14} className="ix-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
            Sync now
          </Button>
        </div>
      </section>

      {view.error && <p role="alert" className="ix-settings__error">{view.error}</p>}

      <footer className="ix-settings__foot">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="ix-danger" disabled={busy}>
              Disconnect
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect {view.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                XR will revoke its access where {view.name} supports it, then delete the stored sign-in from this computer.
                Nothing in {view.name} itself is deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="ix-danger-solid" onClick={() => void disconnect(view.id)}>
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </footer>
    </div>
  );
}
