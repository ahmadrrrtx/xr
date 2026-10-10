/*
 * Telegram (Phase 24) dialogs.
 *   TelegramSetupDialog    token → Start → waiting for /start → enter the code → ✓ Connected
 *   TelegramSettingsDialog status, paired users, limits, webhook, auto-start, logs, disconnect
 *
 * The token is typed once and sent to the engine. It is not kept in component
 * state after Start succeeds, and it is never shown again.
 */
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  confirmTelegramPairing,
  connectTelegram,
  disconnectTelegram,
  getTelegramLogs,
  openTelegramPairing,
  stopTelegram,
  startTelegram,
  unpairTelegramUser,
  updateTelegramSettings,
  useTelegramStatus,
  type TelegramLogLine,
} from '@/integrations/telegram';
import { useIntegrationsStore } from '@/stores/integrationsStore';

const LIVE_NOTE = 'XR must be running on your computer for the bot to respond.';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Try again.';
}

export function TelegramSetupDialog() {
  const close = useIntegrationsStore((s) => s.closeDialog);
  const { status, refresh } = useTelegramStatus(2500);
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [chosenStep, setStep] = useState<'token' | 'pairing' | 'done'>('token');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  // Re-entering setup when the bot is already paired goes straight to the success state.
  const step = chosenStep === 'token' && status && status.pairedUsers.length > 0 ? 'done' : chosenStep;

  const pending = status?.pairing.pending ?? [];
  const who = pending[0];

  const onStart = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError('Paste the bot token from BotFather.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await connectTelegram(token.trim());
      setToken('');
      setStep('pairing');
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from Telegram.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmTelegramPairing(code.trim());
      setCode('');
      setStep('done');
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onReopen = async () => {
    setBusy(true);
    setError(null);
    try {
      await openTelegramPairing();
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="ix-dialog" aria-describedby={`${formId}-desc`}>
        <DialogHeader>
          <DialogTitle>Connect Telegram</DialogTitle>
          <DialogDescription id={`${formId}-desc`}>{LIVE_NOTE}</DialogDescription>
        </DialogHeader>

        {step === 'token' && (
          <form onSubmit={onStart} noValidate className="ix-form">
            <label htmlFor={`${formId}-token`}>Bot token</label>
            <Input
              id={`${formId}-token`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:AA…"
            />
            <p className="ix-form__hint">Create a bot with @BotFather in Telegram and paste its token. XR checks it with Telegram and stores it in the OS keychain.</p>
            {error && <p role="alert" className="ix-form__error">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Checking…' : 'Start'}</Button>
            </DialogFooter>
          </form>
        )}

        {step === 'pairing' && (
          <div className="ix-form">
            {!who && (
              <p role="status" aria-live="polite">
                Open your bot in Telegram and send /start. Waiting for you…
              </p>
            )}
            {who && (
              <form onSubmit={onConfirm} noValidate>
                <p>
                  {who.name}{who.username ? ` (@${who.username})` : ''} asked to pair. Enter the 6-digit code shown in that Telegram chat.
                </p>
                <label htmlFor={`${formId}-code`}>Pairing code</label>
                <Input
                  id={`${formId}-code`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                {error && <p role="alert" className="ix-form__error">{error}</p>}
                <DialogFooter>
                  <Button type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Confirming…' : 'Confirm'}</Button>
                </DialogFooter>
              </form>
            )}
            {!who && (
              <DialogFooter>
                {status && !status.pairing.open && (
                  <Button variant="outline" onClick={() => void onReopen()} disabled={busy}>Open pairing again</Button>
                )}
                <Button variant="ghost" onClick={close}>Close</Button>
              </DialogFooter>
            )}
          </div>
        )}

        {step === 'done' && (
          <div className="ix-form">
            <p role="status">✓ Connected{status?.bot ? ` to @${status.bot.username}` : ''}. {LIVE_NOTE}</p>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TelegramSettingsDialog() {
  const close = useIntegrationsStore((s) => s.closeDialog);
  const { status, error: loadError, refresh } = useTelegramStatus(4000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // Drafts. Empty means "show the live value", so nothing is copied in an effect.
  const [draft, setDraft] = useState<{ rate?: string; attach?: string; webhook?: string }>({});
  const [logs, setLogs] = useState<TelegramLogLine[] | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const formId = useId();

  const liveRate = status ? String(status.settings.rateLimitPerMin) : '';
  const liveAttach = status ? String(Math.round(status.settings.maxAttachmentBytes / (1024 * 1024))) : '';
  const liveWebhook = status?.settings.webhookUrl ?? '';
  const rate = draft.rate ?? liveRate;
  const attach = draft.attach ?? liveAttach;
  const webhook = draft.webhook ?? liveWebhook;

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
      updateTelegramSettings({
        rateLimitPerMin: Number(rate),
        maxAttachmentBytes: Math.round(Number(attach) * 1024 * 1024),
        webhookUrl: webhook.trim() || null,
      }),
    ).then(() => setDraft({}));

  const toggleLogs = async () => {
    const next = !showLogs;
    setShowLogs(next);
    if (next) {
      try {
        setLogs((await getTelegramLogs(80)).lines);
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
            <DialogTitle>Telegram</DialogTitle>
            <DialogDescription>{loadError ? `Could not reach XR: ${loadError}` : 'Loading…'}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const running = status.polling;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="ix-dialog" aria-describedby={`${formId}-desc`}>
        <DialogHeader>
          <DialogTitle>Telegram settings</DialogTitle>
          <DialogDescription id={`${formId}-desc`}>
            {status.bot ? `@${status.bot.username} · ` : ''}{status.label}. {LIVE_NOTE}
          </DialogDescription>
        </DialogHeader>

        <div className="ix-form">
          <p role="status" aria-live="polite">State: {status.label}{status.lastError ? ` — ${status.lastError}` : ''}</p>
          {status.envOverrides.token && <p className="ix-form__hint">Token: Configured via environment (XR_TELEGRAM_TOKEN).</p>}
          {status.envOverrides.allowed && <p className="ix-form__hint">Extra paired users: Configured via environment (XR_TELEGRAM_ALLOWED).</p>}

          <section aria-labelledby={`${formId}-paired`}>
            <h3 id={`${formId}-paired`}>Paired users</h3>
            {status.pairedUsers.length === 0 && <p className="ix-form__hint">No one is paired yet.</p>}
            <ul>
              {status.pairedUsers.map((u) => (
                <li key={u.userId}>
                  Telegram user {u.userId}{u.source === 'environment' ? ' (environment)' : ''}
                  {u.source === 'paired' && (
                    <Button variant="ghost" size="sm" onClick={() => void run(() => unpairTelegramUser(u.userId))} disabled={busy} aria-label={`Unpair user ${u.userId}`}>Unpair</Button>
                  )}
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={() => void run(() => openTelegramPairing())} disabled={busy}>Add a device</Button>
          </section>

          <section aria-labelledby={`${formId}-limits`}>
            <h3 id={`${formId}-limits`}>Limits</h3>
            <label htmlFor={`${formId}-rate`}>Messages per minute, per chat</label>
            <Input id={`${formId}-rate`} inputMode="numeric" value={rate} onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} />
            <label htmlFor={`${formId}-attach`}>Attachment limit (MB)</label>
            <Input id={`${formId}-attach`} inputMode="numeric" value={attach} onChange={(e) => setDraft((d) => ({ ...d, attach: e.target.value }))} />
            <label htmlFor={`${formId}-webhook`}>Webhook URL (optional, https only)</label>
            <Input id={`${formId}-webhook`} value={webhook} onChange={(e) => setDraft((d) => ({ ...d, webhook: e.target.value }))} placeholder="https://" />
            <Button variant="outline" size="sm" onClick={() => void saveLimits()} disabled={busy}>Save limits</Button>
          </section>

          <section aria-labelledby={`${formId}-run`}>
            <h3 id={`${formId}-run`}>Running</h3>
            <label>
              <input
                type="checkbox"
                checked={status.autoStart}
                onChange={(e) => void run(() => updateTelegramSettings({ autoStart: e.target.checked }))}
                disabled={busy}
              />{' '}
              Start automatically when XR starts
            </label>
            <div>
              {running ? (
                <Button variant="outline" size="sm" onClick={() => void run(() => stopTelegram())} disabled={busy}>Stop</Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void run(() => startTelegram())} disabled={busy || status.label === 'Not set up'}>Start</Button>
              )}
            </div>
          </section>

          <section aria-labelledby={`${formId}-logs`}>
            <h3 id={`${formId}-logs`}>Logs</h3>
            <Button variant="ghost" size="sm" onClick={() => void toggleLogs()} aria-expanded={showLogs}>{showLogs ? 'Hide logs' : 'Show logs'}</Button>
            {showLogs && (
              <pre aria-label="Telegram logs" className="ix-logs">
                {(logs ?? []).map((l) => `${new Date(l.at).toLocaleTimeString()} ${l.level} ${l.line}`).join('\n') || 'No log lines yet.'}
              </pre>
            )}
          </section>

          {error && <p role="alert" className="ix-form__error">{error}</p>}

          <section aria-labelledby={`${formId}-danger`}>
            <h3 id={`${formId}-danger`}>Disconnect</h3>
            {!confirmDisconnect ? (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDisconnect(true)} disabled={busy}>Disconnect</Button>
            ) : (
              <div role="alertdialog" aria-label="Confirm disconnect">
                <p>This removes the bot token and every paired device. You will need to connect and pair again.</p>
                <Button variant="destructive" size="sm" onClick={() => void run(() => disconnectTelegram()).then(() => setConfirmDisconnect(false))} disabled={busy}>Confirm disconnect</Button>{' '}
                <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)} disabled={busy}>Cancel</Button>
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
