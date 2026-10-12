/*
 * WhatsApp (Phase 26) dialogs.
 *   WhatsAppConnectDialog   risk acknowledgement → QR (live) → linked → contacts
 *   WhatsAppSettingsDialog  link state, contacts, outbox, limits, logs, unpair
 *
 * The risk checkbox is not decoration: linking uses an unofficial client, so the
 * user has to say they understand before a QR is even minted. The disclosure
 * text comes from the engine (`status.notice`) so the dialog, the README and the
 * code all say the same thing.
 *
 * The QR area is 300×300 and seeded from the engine's SSE stream: WhatsApp
 * rotates the code every ~20 seconds, and the countdown tells the user when the
 * picture they are looking at stops being valid.
 */
import { useId, useState, type FormEvent } from 'react';
import { Check, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { secondsUntil, useNow } from '@/integrations/clock';
import {
  addWhatsAppContact,
  closeWhatsAppPairing,
  getWhatsAppLogs,
  openWhatsAppPairing,
  removeWhatsAppContact,
  startWhatsApp,
  stopWhatsApp,
  unpairWhatsApp,
  updateWhatsAppSettings,
  useWhatsAppQr,
  useWhatsAppStatus,
  type WhatsAppLogLine,
} from '@/integrations/whatsapp';
import { useIntegrationsStore } from '@/stores/integrationsStore';

const LIVE_NOTE = 'XR must be running on your computer for this chat to answer.';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Try again.';
}

/**
 * The 300×300 QR area. While `state === 'qr'` a countdown runs against the frame
 * the engine said would expire; otherwise the area explains what it is waiting for.
 */
function QrArea({ active, onRefresh, refreshBusy }: { active: boolean; onRefresh: () => void; refreshBusy: boolean }) {
  const { state, png, reason, expiresAt } = useWhatsAppQr(active);
  // The countdown is derived, not stored: the clock ticks, the deadline comes
  // from the frame. No state is written from an effect.
  const now = useNow(1000);
  const left = secondsUntil(expiresAt, now);

  return (
    <div className="ix-qr" data-testid="whatsapp-qr">
      <div className="ix-qr__frame" style={{ width: 300, height: 300 }} aria-busy={state === 'streaming' || undefined}>
        {png ? (
          <img src={png} width={300} height={300} alt="WhatsApp pairing QR code" className="ix-qr__img" />
        ) : (
          <div className="ix-qr__placeholder" role="status" aria-live="polite">
            {state === 'idle' && 'Not pairing yet.'}
            {state === 'streaming' && 'Waiting for WhatsApp to send a code…'}
            {state === 'open' && (
              <span>
                <Check size={20} aria-hidden="true" /> Linked.
              </span>
            )}
            {state === 'timeout' && 'The pairing window closed. Nothing was linked.'}
            {state === 'closed' && 'Pairing stopped.'}
            {state === 'error' && (reason ?? 'Could not get a QR code.')}
          </div>
        )}
      </div>
      <div className="ix-qr__meta">
        {state === 'qr' && left !== null && <span role="timer">New code in {left}s</span>}
        {(state === 'timeout' || state === 'closed' || state === 'error') && (
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshBusy}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </Button>
        )}
      </div>
    </div>
  );
}

export function WhatsAppConnectDialog() {
  const close = useIntegrationsStore((s) => s.closeDialog);
  const { status, refresh } = useWhatsAppStatus(3000);
  const [understood, setUnderstood] = useState(false);
  // Whether the QR stream should be open: we asked for it and the link has not landed yet.
  const [pairingRequested, setPairingRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactDraft, setContactDraft] = useState('');
  const formId = useId();

  const linked = Boolean(status?.linked);

  const startPairing = async () => {
    setBusy(true);
    setError(null);
    try {
      await openWhatsAppPairing();
      setPairingRequested(true);
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onAddContact = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addWhatsAppContact(contactDraft.trim());
      setContactDraft('');
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // The stream goes quiet once the link lands. Deriving the flag (rather than
  // clearing it in an effect) means no state is written just to follow status.
  const pairing = pairingRequested && !linked;

  const notice = status?.notice ?? 'WhatsApp does not offer an official API for personal accounts. XR links as a companion device using an unofficial open-source client.';

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (o || busy) return;
        if (pairing) void closeWhatsAppPairing().catch(() => undefined);
        close();
      }}
    >
      <DialogContent className="ix-dialog" aria-describedby={`${formId}-desc`}>
        <DialogHeader>
          <DialogTitle>Connect WhatsApp</DialogTitle>
          <DialogDescription id={`${formId}-desc`}>{LIVE_NOTE}</DialogDescription>
        </DialogHeader>

        <div className="ix-form">
          {/* The disclosure is mandatory and comes before anything else. */}
          <div className="ix-notice ix-notice--risk" role="note">
            <ShieldAlert size={16} aria-hidden="true" />
            <div>
              <strong>⚠️ Unofficial client</strong>
              <p>{notice}</p>
            </div>
          </div>

          <label className="ix-check">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              data-testid="whatsapp-risk-ack"
            />{' '}
            I understand: this uses an unofficial WhatsApp client, and my account could be banned.
          </label>

          {!linked && (
            <>
              <QrArea active={pairing} onRefresh={() => void startPairing()} refreshBusy={busy} />
              <p className="ix-form__hint">
                On your phone: <strong>Settings → Linked devices → Link a device</strong>, then scan this code. WhatsApp rotates it every
                twenty seconds — XR follows along.
              </p>
              <Button onClick={() => void startPairing()} disabled={!understood || busy || pairing} aria-disabled={!understood}>
                {pairing ? 'Waiting for the scan…' : busy ? 'Opening…' : 'Show QR code'}
              </Button>
              {!understood && <p className="ix-form__hint">Tick the box above to continue.</p>}
            </>
          )}

          {linked && (
            <>
              <p role="status">
                ✓ Linked{status?.linkedAs ? ` as ${status.linkedAs}` : ''}. XR is a companion device now.
              </p>
              <p className="ix-form__hint">
                <TriangleAlert size={12} aria-hidden="true" /> Linking authorizes nobody. Add the contacts you want below, or switch on
                “respond to contacts I message first” in settings. Everything else is ignored silently.
              </p>
              <form onSubmit={onAddContact} noValidate>
                <label htmlFor={`${formId}-contact`}>Allow a contact</label>
                <Input
                  id={`${formId}-contact`}
                  inputMode="tel"
                  autoComplete="off"
                  value={contactDraft}
                  onChange={(e) => setContactDraft(e.target.value)}
                  placeholder="923001234567 (country code, no +)"
                />
                <Button type="submit" variant="outline" size="sm" disabled={busy || !contactDraft.trim()}>Add contact</Button>
              </form>
            </>
          )}

          {error && <p role="alert" className="ix-form__error">{error}</p>}

          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={busy}>Close</Button>
            {linked && <Button variant="outline" onClick={() => void startWhatsApp().then(() => refresh()).catch(() => undefined)} disabled={busy}>Start now</Button>}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WhatsAppSettingsDialog() {
  const close = useIntegrationsStore((s) => s.closeDialog);
  const { status, error: loadError, refresh } = useWhatsAppStatus(4000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [draft, setDraft] = useState<{ rate?: string; attach?: string; contact?: string }>({});
  const [logs, setLogs] = useState<WhatsAppLogLine[] | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const formId = useId();

  const rate = draft.rate ?? (status ? String(status.settings.rateLimitPerMin) : '');
  const attach = draft.attach ?? (status ? String(Math.round(status.settings.maxAttachmentBytes / (1024 * 1024))) : '');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const saveLimits = () =>
    run(() =>
      updateWhatsAppSettings({
        rateLimitPerMin: Number(rate),
        maxAttachmentBytes: Math.round(Number(attach) * 1024 * 1024),
      }),
    ).then(() => setDraft((d) => ({ ...d, rate: undefined, attach: undefined })));

  const toggleLogs = async () => {
    const next = !showLogs;
    setShowLogs(next);
    if (next) {
      try {
        setLogs((await getWhatsAppLogs(80)).lines);
      } catch (err) {
        setError(errorText(err));
      }
    }
  };

  if (!status) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="ix-dialog">
          <DialogHeader>
            <DialogTitle>WhatsApp</DialogTitle>
            <DialogDescription>{loadError ? `Could not reach XR: ${loadError}` : 'Loading…'}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const live = status.connection.status === 'open';
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="ix-dialog" aria-describedby={`${formId}-desc`}>
        <DialogHeader>
          <DialogTitle>WhatsApp settings</DialogTitle>
          <DialogDescription id={`${formId}-desc`}>
            {status.linkedAs ? `${status.linkedAs} · ` : ''}{status.connection.status}. {LIVE_NOTE}
          </DialogDescription>
        </DialogHeader>

        <div className="ix-form">
          <p role="status" aria-live="polite">
            State: {status.connection.status}
            {status.connection.reason ? ` — ${status.connection.reason}` : ''}
          </p>
          <p className="ix-form__hint">
            Session: {status.creds.linked ? `sealed on disk (${status.creds.keyCount} key${status.creds.keyCount === 1 ? '' : 's'})` : 'no linked device'} ·
            history payloads declined: {status.historyDropped}
          </p>

          <section aria-labelledby={`${formId}-contacts`}>
            <h3 id={`${formId}-contacts`}>Allowed contacts</h3>
            {status.contacts.length === 0 && (
              <p className="ix-form__hint">Nobody yet. Every number that is not on this list is ignored in silence.</p>
            )}
            <ul className="ix-list">
              {status.contacts.map((c) => (
                <li key={c.phone}>
                  {c.label ? `${c.label} · ` : ''}{c.phone}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void run(() => removeWhatsAppContact(c.phone))}
                    disabled={busy}
                    aria-label={`Remove contact ${c.masked}`}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <form
              className="ix-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const phone = (draft.contact ?? '').trim();
                if (!phone) return;
                void run(() => addWhatsAppContact(phone)).then(() => setDraft((d) => ({ ...d, contact: '' })));
              }}
            >
              <Input
                aria-label="Add a contact number"
                inputMode="tel"
                value={draft.contact ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, contact: e.target.value }))}
                placeholder="923001234567"
              />
              <Button type="submit" variant="outline" size="sm" disabled={busy || !(draft.contact ?? '').trim()}>Add</Button>
            </form>

            <label className="ix-check">
              <input
                type="checkbox"
                checked={status.respondToOutbox}
                onChange={(e) => void run(() => updateWhatsAppSettings({ respondToOutbox: e.target.checked }))}
                disabled={busy}
              />{' '}
              Respond to contacts I message first
            </label>
            <p className="ix-form__hint">
              Learned from messages you send while XR is running (never from your chat history).
              {status.outbox.length > 0 ? ` ${status.outbox.length} number${status.outbox.length === 1 ? '' : 's'} learned so far.` : ''}
            </p>
          </section>

          <section aria-labelledby={`${formId}-limits`}>
            <h3 id={`${formId}-limits`}>Limits</h3>
            <label htmlFor={`${formId}-rate`}>Messages per minute, per chat (1–60)</label>
            <Input id={`${formId}-rate`} inputMode="numeric" value={rate} onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} />
            <label htmlFor={`${formId}-attach`}>Document limit (MB, photos stay capped at 2 MB)</label>
            <Input id={`${formId}-attach`} inputMode="numeric" value={attach} onChange={(e) => setDraft((d) => ({ ...d, attach: e.target.value }))} />
            <Button variant="outline" size="sm" onClick={() => void saveLimits()} disabled={busy}>Save limits</Button>
          </section>

          <section aria-labelledby={`${formId}-run`}>
            <h3 id={`${formId}-run`}>Running</h3>
            <label className="ix-check">
              <input
                type="checkbox"
                checked={status.autoStart}
                onChange={(e) => void run(() => updateWhatsAppSettings({ autoStart: e.target.checked }))}
                disabled={busy}
              />{' '}
              Reconnect automatically when XR starts
            </label>
            <div className="ix-pair-actions">
              {live ? (
                <Button variant="outline" size="sm" onClick={() => void run(() => stopWhatsApp())} disabled={busy}>Stop</Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void run(() => startWhatsApp())} disabled={busy || !status.linked}>Start</Button>
              )}
              {!status.linked && <span className="ix-form__hint">Pair from the Connect dialog first.</span>}
            </div>
          </section>

          <section aria-labelledby={`${formId}-logs`}>
            <h3 id={`${formId}-logs`}>Logs</h3>
            <Button variant="ghost" size="sm" onClick={() => void toggleLogs()} aria-expanded={showLogs}>{showLogs ? 'Hide logs' : 'Show logs'}</Button>
            <p className="ix-form__hint">Phone numbers appear as last four digits only, even here.</p>
            {showLogs && (
              <pre aria-label="WhatsApp logs" className="ix-logs">
                {(logs ?? []).map((l) => `${new Date(l.at).toLocaleTimeString()} ${l.level} ${l.line}`).join('\n') || 'No log lines yet.'}
              </pre>
            )}
          </section>

          {error && <p role="alert" className="ix-form__error">{error}</p>}

          <section aria-labelledby={`${formId}-danger`}>
            <h3 id={`${formId}-danger`}>Unpair</h3>
            {!confirmUnpair ? (
              <Button variant="destructive" size="sm" onClick={() => setConfirmUnpair(true)} disabled={busy}>Unpair this device</Button>
            ) : (
              <div role="alertdialog" aria-label="Confirm unpair">
                <p>
                  XR asks WhatsApp to unlink this device and deletes the sealed session from this computer. Your chat history on the
                  phone is untouched. Linking again needs a new QR scan.
                </p>
                <Button variant="destructive" size="sm" onClick={() => void run(() => unpairWhatsApp()).then(() => setConfirmUnpair(false))} disabled={busy}>
                  Confirm unpair
                </Button>{' '}
                <Button variant="ghost" size="sm" onClick={() => setConfirmUnpair(false)} disabled={busy}>Cancel</Button>
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
