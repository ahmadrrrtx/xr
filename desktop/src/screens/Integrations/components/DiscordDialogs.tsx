/*
 * Discord (Phase 26) dialogs.
 *   DiscordConnectDialog   token → check → mint a pairing code → /xr pair <code> in Discord → ✓
 *   DiscordSettingsDialog  gateway state, paired users, allowed channels, limits, logs, disconnect
 *
 * Pairing runs the other way round from Telegram: the *desktop* mints the
 * 6-digit code (the bot cannot DM someone who has never spoken to it) and the
 * user types it into Discord with `/xr pair`. The code is displayed once, is
 * single-use, and expires with the 10-minute window.
 *
 * The token is typed once and sent to the engine. It is not kept in component
 * state after Connect succeeds, and it is never shown again.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Check, Copy, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { openInSystemBrowser } from '@/integrations/browser';
import {
  addDiscordChannel,
  connectDiscord,
  disconnectDiscord,
  getDiscordLogs,
  listDiscordChannels,
  listDiscordGuilds,
  openDiscordPairing,
  removeDiscordChannel,
  startDiscord,
  stopDiscord,
  unpairDiscordUser,
  updateDiscordSettings,
  useDiscordStatus,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordLogLine,
} from '@/integrations/discord';
import { useIntegrationsStore } from '@/stores/integrationsStore';

const LIVE_NOTE = 'XR must be running on your computer for the bot to respond.';
const PORTAL_URL = 'https://discord.com/developers/applications';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Try again.';
}

/** The 24px mono code the user reads out loud — the phase brief's pairing card. */
function PairingCode({ code, expiresAt, onCopy }: { code: string; expiresAt: number; onCopy: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, expiresAt - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, expiresAt - Date.now())), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return (
    <div className="ix-paircode" data-testid="discord-pairing-code">
      <code className="ix-paircode__digits" aria-label="Pairing code">{code}</code>
      <div className="ix-paircode__meta">
        <span role="timer" aria-live="off">
          Expires in {minutes}:{String(seconds).padStart(2, '0')}
        </span>
        <Button variant="ghost" size="sm" onClick={onCopy} aria-label="Copy pairing code">
          <Copy size={14} aria-hidden="true" /> Copy
        </Button>
      </div>
    </div>
  );
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

export function DiscordConnectDialog() {
  const close = useIntegrationsStore((s) => s.closeDialog);
  const { status, refresh } = useDiscordStatus(2500);
  const [token, setToken] = useState('');
  const [step, setStep] = useState<'token' | 'invite' | 'pair' | 'done'>('token');
  const [code, setCode] = useState<{ value: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  // Re-entering setup when a user is already paired goes straight to the success state.
  const effectiveStep = step === 'token' && status && status.pairedUsers.length > 0 ? 'done' : step;

  const onConnect = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError('Paste the bot token from the Discord Developer Portal.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await connectDiscord(token.trim());
      setToken('');
      setStep('invite');
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const mint = async (kind: 'user' | 'channel' = 'user') => {
    setBusy(true);
    setError(null);
    try {
      const res = await openDiscordPairing(kind);
      if (res.code) setCode({ value: res.code, expiresAt: res.expiresAt });
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const inviteUrl = status?.inviteUrl ?? null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="ix-dialog" aria-describedby={`${formId}-desc`}>
        <DialogHeader>
          <DialogTitle>Connect Discord</DialogTitle>
          <DialogDescription id={`${formId}-desc`}>{LIVE_NOTE}</DialogDescription>
        </DialogHeader>

        {effectiveStep === 'token' && (
          <form onSubmit={onConnect} noValidate className="ix-form">
            <label htmlFor={`${formId}-token`}>Bot token</label>
            <Input
              id={`${formId}-token`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="MTIz…"
            />
            <p className="ix-form__hint">
              In the{' '}
              <button type="button" className="ix-link" onClick={() => void openInSystemBrowser(PORTAL_URL).catch(() => undefined)}>
                Discord Developer Portal <ExternalLink size={12} aria-hidden="true" />
              </button>{' '}
              create an application, add a bot, and paste its token. XR checks it with Discord and stores it in the OS keychain.
            </p>
            <p className="ix-form__hint ix-form__hint--warn">
              <TriangleAlert size={12} aria-hidden="true" /> Also switch on <strong>MESSAGE_CONTENT</strong> under Bot → Privileged
              Gateway Intents, or Discord delivers empty message text and XR cannot read what you send it.
            </p>
            {error && <p role="alert" className="ix-form__error">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Checking…' : 'Connect'}</Button>
            </DialogFooter>
          </form>
        )}

        {effectiveStep === 'invite' && (
          <div className="ix-form">
            <p role="status">✓ Token accepted{status?.bot ? ` — ${status.bot.name}` : ''}.</p>
            <p className="ix-form__hint">
              Add the bot to a server you own. XR asks for five permissions only: view channels, send messages, embed links,
              attach files and read history. No moderation, no administrator.
            </p>
            {inviteUrl ? (
              <div className="ix-invite">
                <code className="ix-invite__url">{inviteUrl}</code>
                <div className="ix-invite__actions">
                  <Button variant="outline" size="sm" onClick={() => void openInSystemBrowser(inviteUrl).catch(() => undefined)}>
                    <ExternalLink size={14} aria-hidden="true" /> Open invite
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => copyText(inviteUrl)}>
                    <Copy size={14} aria-hidden="true" /> Copy
                  </Button>
                </div>
              </div>
            ) : (
              <p className="ix-form__hint">Start the bot to get its invite link.</p>
            )}
            {error && <p role="alert" className="ix-form__error">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep('done')} disabled={busy}>Skip</Button>
              <Button onClick={() => setStep('pair')} disabled={busy}>Continue</Button>
            </DialogFooter>
          </div>
        )}

        {effectiveStep === 'pair' && (
          <div className="ix-form">
            {!code ? (
              <>
                <p className="ix-form__hint">
                  Pairing links your Discord account (a DM) or one server channel. XR mints a code and shows it here — you type
                  it into Discord, so the code proves the person on the other end saw this screen.
                </p>
                <div className="ix-pair-actions">
                  <Button onClick={() => void mint('user')} disabled={busy}>Pair my account</Button>
                  <Button variant="outline" onClick={() => void mint('channel')} disabled={busy}>Pair a channel</Button>
                </div>
              </>
            ) : (
              <>
                <PairingCode code={code.value} expiresAt={code.expiresAt} onCopy={() => copyText(code.value)} />
                <p className="ix-form__hint">
                  In Discord, send <code>/xr pair {code.value}</code> in a DM to the bot
                  {' '}(or <code>/xr pairchannel {code.value}</code> in a server channel). The code works once, for ten minutes.
                </p>
                <Button variant="ghost" size="sm" onClick={() => void mint('user')} disabled={busy}>
                  <RefreshCw size={14} aria-hidden="true" /> New code
                </Button>
              </>
            )}
            {(status?.pairedUsers.length ?? 0) > 0 && (
              <p role="status" className="ix-form__hint">
                <Check size={12} aria-hidden="true" /> {status!.pairedUsers.length} account
                {status!.pairedUsers.length === 1 ? '' : 's'} paired already.
              </p>
            )}
            {error && <p role="alert" className="ix-form__error">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep('done')} disabled={busy}>Done</Button>
            </DialogFooter>
          </div>
        )}

        {effectiveStep === 'done' && (
          <div className="ix-form">
            <p role="status">
              ✓ Connected. {LIVE_NOTE} Send <code>/xr help</code> in a DM to see the commands.
            </p>
            <DialogFooter>
              <Button onClick={close}>Close</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DiscordSettingsDialog() {
  const close = useIntegrationsStore((s) => s.closeDialog);
  const { status, error: loadError, refresh } = useDiscordStatus(4000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // Drafts. Empty means "show the live value", so nothing is copied in an effect.
  const [draft, setDraft] = useState<{ rate?: string; attach?: string; webhook?: string; devGuild?: string }>({});
  const [logs, setLogs] = useState<DiscordLogLine[] | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
  const [channels, setChannels] = useState<Record<string, DiscordChannel[]>>({});
  const [pickedGuild, setPickedGuild] = useState('');
  const [pickedChannel, setPickedChannel] = useState('');
  const [code, setCode] = useState<{ value: string; expiresAt: number } | null>(null);
  const formId = useId();

  const liveRate = status ? String(status.settings.rateLimitPerMin) : '';
  const liveAttach = status ? String(Math.round(status.settings.maxAttachmentBytes / (1024 * 1024))) : '';
  const rate = draft.rate ?? liveRate;
  const attach = draft.attach ?? liveAttach;
  const webhook = draft.webhook ?? status?.settings.webhookUrl ?? '';
  const devGuild = draft.devGuild ?? status?.settings.devGuildId ?? '';

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
      updateDiscordSettings({
        rateLimitPerMin: Number(rate),
        maxAttachmentBytes: Math.round(Number(attach) * 1024 * 1024),
        webhookUrl: webhook.trim() || null,
        devGuildId: devGuild.trim() || null,
      }),
    ).then(() => setDraft({}));

  const loadGuilds = async () => {
    setError(null);
    try {
      setGuilds((await listDiscordGuilds()).guilds);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const loadChannels = async (guildId: string) => {
    setPickedGuild(guildId);
    setPickedChannel('');
    if (channels[guildId]) return;
    try {
      const { channels: list } = await listDiscordChannels(guildId);
      setChannels((c) => ({ ...c, [guildId]: list }));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const toggleLogs = async () => {
    const next = !showLogs;
    setShowLogs(next);
    if (next) {
      try {
        setLogs((await getDiscordLogs(80)).lines);
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
            <DialogTitle>Discord</DialogTitle>
            <DialogDescription>{loadError ? `Could not reach XR: ${loadError}` : 'Loading…'}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const live = status.connection.status === 'connected';
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="ix-dialog" aria-describedby={`${formId}-desc`}>
        <DialogHeader>
          <DialogTitle>Discord settings</DialogTitle>
          <DialogDescription id={`${formId}-desc`}>
            {status.bot ? `${status.bot.name} · ` : ''}{status.label}. {LIVE_NOTE}
          </DialogDescription>
        </DialogHeader>

        <div className="ix-form">
          <p role="status" aria-live="polite">
            State: {status.label}
            {status.connection.detail ? ` — ${status.connection.detail}` : ''}
            {status.lastError ? ` — ${status.lastError}` : ''}
          </p>
          {status.tokenSource === 'environment' && <p className="ix-form__hint">Token: Configured via environment (XR_DISCORD_TOKEN).</p>}

          <section aria-labelledby={`${formId}-access`}>
            <h3 id={`${formId}-access`}>Who may talk to XR</h3>
            <h4>Paired accounts</h4>
            {status.pairedUsers.length === 0 && <p className="ix-form__hint">No one is paired yet. DMs from anyone else are ignored silently.</p>}
            <ul className="ix-list">
              {status.pairedUsers.map((u) => (
                <li key={u.userId}>
                  {u.label ?? `User ${u.userId}`}
                  {u.source === 'environment' ? ' (environment)' : ''}
                  {u.source === 'paired' && (
                    <Button variant="ghost" size="sm" onClick={() => void run(() => unpairDiscordUser(u.userId))} disabled={busy} aria-label={`Unpair ${u.label ?? u.userId}`}>
                      Unpair
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!code ? (
              <Button variant="outline" size="sm" onClick={() => void run(async () => { const r = await openDiscordPairing('user'); if (r.code) setCode({ value: r.code, expiresAt: r.expiresAt }); })} disabled={busy}>
                Pair an account
              </Button>
            ) : (
              <PairingCode code={code.value} expiresAt={code.expiresAt} onCopy={() => copyText(code.value)} />
            )}

            <h4>Allowed channels</h4>
            {status.allowedChannels.length === 0 && <p className="ix-form__hint">No channels. XR stays quiet in every server until you add one, and even then only answers slash commands and @mentions.</p>}
            <ul className="ix-list">
              {status.allowedChannels.map((c) => (
                <li key={`${c.guildId}:${c.channelId}`}>
                  {c.label ?? `${c.guildId} / ${c.channelId}`}
                  <Button variant="ghost" size="sm" onClick={() => void run(() => removeDiscordChannel(c.guildId, c.channelId))} disabled={busy} aria-label={`Remove channel ${c.label ?? c.channelId}`}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <div className="ix-pair-actions">
              <Button variant="outline" size="sm" onClick={() => void loadGuilds()} disabled={busy}>Load my servers</Button>
              {!code && (
                <Button variant="outline" size="sm" onClick={() => void run(async () => { const r = await openDiscordPairing('channel'); if (r.code) setCode({ value: r.code, expiresAt: r.expiresAt }); })} disabled={busy}>
                  Pair a channel by code
                </Button>
              )}
            </div>
            {guilds.length > 0 && (
              <div className="ix-picker">
                <label htmlFor={`${formId}-guild`}>Server</label>
                <select id={`${formId}-guild`} value={pickedGuild} onChange={(e) => void loadChannels(e.target.value)}>
                  <option value="">Choose a server…</option>
                  {guilds.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                {pickedGuild && (
                  <>
                    <label htmlFor={`${formId}-channel`}>Channel</label>
                    <select id={`${formId}-channel`} value={pickedChannel} onChange={(e) => setPickedChannel(e.target.value)}>
                      <option value="">Choose a channel…</option>
                      {(channels[pickedGuild] ?? []).map((c) => (
                        <option key={c.id} value={c.id}>#{c.name}</option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !pickedChannel}
                      onClick={() => void run(() => addDiscordChannel(pickedGuild, pickedChannel))}
                    >
                      Allow channel
                    </Button>
                  </>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby={`${formId}-limits`}>
            <h3 id={`${formId}-limits`}>Limits</h3>
            <label htmlFor={`${formId}-rate`}>Messages per minute, per chat</label>
            <Input id={`${formId}-rate`} inputMode="numeric" value={rate} onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} />
            <label htmlFor={`${formId}-attach`}>Attachment limit (MB)</label>
            <Input id={`${formId}-attach`} inputMode="numeric" value={attach} onChange={(e) => setDraft((d) => ({ ...d, attach: e.target.value }))} />
            <label htmlFor={`${formId}-webhook`}>Interactions webhook URL (optional, https only)</label>
            <Input id={`${formId}-webhook`} value={webhook} onChange={(e) => setDraft((d) => ({ ...d, webhook: e.target.value }))} placeholder="Leave empty to use the gateway" />
            <label htmlFor={`${formId}-devguild`}>Register slash commands in one server (instant, optional)</label>
            <Input id={`${formId}-devguild`} value={devGuild} onChange={(e) => setDraft((d) => ({ ...d, devGuild: e.target.value }))} placeholder="Server id — global commands can take an hour" />
            <Button variant="outline" size="sm" onClick={() => void saveLimits()} disabled={busy}>Save limits</Button>
          </section>

          <section aria-labelledby={`${formId}-run`}>
            <h3 id={`${formId}-run`}>Running</h3>
            <label>
              <input
                type="checkbox"
                checked={status.autoStart}
                onChange={(e) => void run(() => updateDiscordSettings({ autoStart: e.target.checked }))}
                disabled={busy}
              />{' '}
              Start automatically when XR starts
            </label>
            <div>
              {live ? (
                <Button variant="outline" size="sm" onClick={() => void run(() => stopDiscord())} disabled={busy}>Stop</Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void run(() => startDiscord())} disabled={busy || status.tokenSource === 'none'}>Start</Button>
              )}
            </div>
          </section>

          <section aria-labelledby={`${formId}-logs`}>
            <h3 id={`${formId}-logs`}>Logs</h3>
            <Button variant="ghost" size="sm" onClick={() => void toggleLogs()} aria-expanded={showLogs}>{showLogs ? 'Hide logs' : 'Show logs'}</Button>
            {showLogs && (
              <pre aria-label="Discord logs" className="ix-logs">
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
                <p>This removes the bot token, every paired account and the channel allow-list. You will need to connect again.</p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void run(() => disconnectDiscord()).then(() => setConfirmDisconnect(false))}
                  disabled={busy}
                >
                  Confirm disconnect
                </Button>{' '}
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
