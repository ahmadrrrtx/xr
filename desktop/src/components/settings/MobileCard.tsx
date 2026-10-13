import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, RefreshCw, Copy, Check, ShieldCheck, Smartphone, WifiOff, Send, Trash2 } from 'lucide-react';

/**
 * Settings → Mobile card (Phase 28).
 *
 * Drop-in for `desktop/src/screens/Settings.tsx`:
 *
 *   import { MobileCard } from '../components/settings/MobileCard';
 *   <MobileCard lanEnabled={meta.lan} lanUrl={meta.lanUrl} fingerprint={meta.fingerprint} fetchJson={api.json} />
 *
 * `fetchJson` is injected so the card doesn't assume the desktop's API client —
 * it just needs to hit the daemon with the bearer token attached.
 *
 * Only visible/runnable when the daemon is in LAN mode. When it isn't, the card
 * explains exactly how to turn LAN access on (explicit opt-in, never silent).
 */

export interface MobileCardProps {
  lanEnabled: boolean;
  lanUrl?: string | undefined;
  fingerprintPretty?: string | undefined;
  fetchJson: <T>(path: string, init?: RequestInit) => Promise<T>;
  onDisableLan?: (() => Promise<boolean>) | undefined;
  onEnableLan?: (() => void) | undefined;
}

interface PairingPayload {
  code: string;
  url: string;
  fingerprint: string;
  fingerprintPretty: string;
  expiresAt: number;
  qr?: string | undefined;
}

interface DeviceSummary {
  id: string;
  name: string;
  kind: 'mobile' | 'desktop';
  pairedAt: number;
  lastSeenAt: number;
  push: boolean;
}

const CODE_TTL_SECONDS = 600;

export function MobileCard({
  lanEnabled,
  lanUrl,
  fingerprintPretty,
  fetchJson,
  onDisableLan,
  onEnableLan,
}: MobileCardProps) {
  const [pairing, setPairing] = useState<PairingPayload | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const data = await fetchJson<{ devices: DeviceSummary[] }>('/api/mobile/devices');
      setDevices(data.devices ?? []);
    } catch {
      /* offline or not in LAN mode */
    }
  }, [fetchJson]);

  useEffect(() => {
    if (!lanEnabled) return;
    void refreshDevices();
  }, [lanEnabled, refreshDevices]);

  // Countdown so the user can see the code expire rather than guess.
  // The expiry clears the code from inside the tick — deriving it from the
  // `remaining` state would fire on the very first render, before the clock
  // has ever run, and throw the code away instantly.
  useEffect(() => {
    if (!pairing) return;
    const tick = (): void => {
      const left = Math.max(0, Math.round((pairing.expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setPairing(null);
    };
    tick();
    timer.current = window.setInterval(tick, 1000);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [pairing]);

  const startPairing = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const data = await fetchJson<PairingPayload>('/api/mobile/pair-qr', { method: 'POST' });
      setRemaining(CODE_TTL_SECONDS);
      setPairing(data);
      setDialogOpen(true);
    } catch {
      setError('Could not create a pairing code. Is XR running in LAN mode?');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, key: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setError('Copy failed — select the text manually.');
    }
  };

  const revoke = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await fetchJson(`/api/mobile/devices/${id}/revoke`, { method: 'POST' });
      await refreshDevices();
    } catch {
      setError('Could not revoke that device.');
    } finally {
      setBusy(false);
    }
  };

  const testPush = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/mobile/devices/${id}/push-test`, { method: 'POST' });
    } catch {
      setError('Test push failed — is XR reachable from the push service?');
    } finally {
      setBusy(false);
    }
  };

  const disableLan = async (): Promise<void> => {
    if (!onDisableLan) {
      setError('Restart XR with `xr serve` (no --lan) to turn LAN access off.');
      return;
    }
    setBusy(true);
    const ok = await onDisableLan();
    setBusy(false);
    if (!ok) setError('XR could not drop the LAN listener — restart without --lan.');
  };

  const mono = { fontFamily: 'var(--font-mono)' } as const;

  return (
    <section
      className="rounded-xl p-4"
      style={{ background: 'var(--bg-ink)', border: '1px solid var(--border-subtle)' }}
      aria-labelledby="mobile-card-title"
    >
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone size={15} strokeWidth={1.6} style={{ color: 'var(--accent)' }} aria-hidden />
          <h3 id="mobile-card-title" className="text-[13px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--text-secondary)' }}>
            Mobile
          </h3>
        </div>
        <span
          className="rounded-full px-2 py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.06em]"
          style={{
            background: lanEnabled ? 'color-mix(in srgb, var(--success) 16%, transparent)' : 'color-mix(in srgb, var(--metal) 14%, transparent)',
            color: lanEnabled ? 'var(--success)' : 'var(--text-tertiary)',
          }}
        >
          {lanEnabled ? 'LAN access on' : 'LAN access off'}
        </span>
      </header>

      {!lanEnabled ? (
        <div>
          <p className="text-[13px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
            XR is only reachable from this computer. To use your phone, restart XR with LAN access:
          </p>
          <pre
            className="mt-2 overflow-x-auto rounded-lg px-3 py-2 text-[12.5px]"
            style={{ ...mono, background: 'var(--bg-void)', border: '1px solid var(--border-default)', color: 'var(--accent)' }}
          >
            xr serve --lan
          </pre>
          <p className="mt-2 text-[12px] leading-[1.5]" style={{ color: 'var(--text-tertiary)' }}>
            XR never opens itself to your network on its own — this flag is the only way.
          </p>
          {onEnableLan ? (
            <button
              type="button"
              onClick={onEnableLan}
              className="mt-3 rounded-lg px-3 py-2 text-[13px] font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--bg-void)' }}
            >
              Allow mobile access on this network
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-[0.06em]" style={{ color: 'var(--text-tertiary)' }}>
              LAN address
            </p>
            <div className="flex items-center gap-2">
              <code
                className="min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-[12.5px]"
                style={{ ...mono, background: 'var(--bg-void)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
              >
                {lanUrl ?? '—'}
              </code>
              <IconButton onClick={() => void copy(lanUrl ?? '', 'url')} done={copied === 'url'} label="Copy LAN address" />
            </div>
          </div>

          <div>
            <p className="mb-1 text-[11px] uppercase tracking-[0.06em]" style={{ color: 'var(--text-tertiary)' }}>
              Certificate fingerprint
            </p>
            <div className="flex items-center gap-2">
              <code
                className="min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-[12px]"
                style={{ ...mono, background: 'var(--bg-void)', border: '1px solid var(--border-default)', color: 'var(--accent)' }}
                title={fingerprintPretty}
              >
                {fingerprintPretty ?? '—'}
              </code>
              <IconButton onClick={() => void copy(fingerprintPretty ?? '', 'fp')} done={copied === 'fp'} label="Copy fingerprint" />
            </div>
            <p className="mt-1 text-[11.5px] leading-[1.45]" style={{ color: 'var(--text-tertiary)' }}>
              Your phone shows this same fingerprint before you pair. If they differ, don’t connect.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void startPairing()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--bg-void)' }}
            >
              <QrCode size={14} strokeWidth={1.8} aria-hidden />
              Pair new device
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void disableLan()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px]"
              style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
            >
              <WifiOff size={14} strokeWidth={1.6} aria-hidden />
              Disable LAN access
            </button>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-[0.06em]" style={{ color: 'var(--text-tertiary)' }}>
              Paired devices ({devices.length})
            </p>
            {devices.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: 'var(--text-tertiary)' }}>
                None yet. Pair your phone to chat, approve and talk from anywhere on this WiFi.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {devices.map((device) => (
                  <li
                    key={device.id}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2"
                    style={{ background: 'var(--bg-void)', border: '1px solid var(--border-subtle)' }}
                  >
                    <Smartphone size={14} strokeWidth={1.6} style={{ color: 'var(--text-tertiary)' }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]" style={{ color: 'var(--text-primary)' }}>
                        {device.name}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        Paired {new Date(device.pairedAt).toLocaleDateString()}
                        {device.push ? ' · push on' : ''}
                      </p>
                    </div>
                    {device.push ? (
                      <IconButton onClick={() => void testPush(device.id)} label="Send test push" variant="send" />
                    ) : null}
                    <IconButton onClick={() => void revoke(device.id)} label={`Revoke ${device.name}`} variant="danger" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error ? (
            <p className="text-[12px]" style={{ color: 'var(--danger)' }} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}

      {/* Pairing dialog: 280px QR + code + fingerprint + manual fallback */}
      {dialogOpen && pairing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(3,7,13,0.72)', backdropFilter: 'blur(16px)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Pair a mobile device"
        >
          <div
            className="w-full max-w-[360px] rounded-2xl p-5"
            style={{ background: 'var(--bg-ink)', border: '1px solid var(--border-default)' }}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} strokeWidth={1.7} style={{ color: 'var(--accent)' }} aria-hidden />
              <h4 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Pair a mobile device
              </h4>
            </div>

            <div
              className="mx-auto mt-4 flex items-center justify-center rounded-xl p-3"
              style={{ width: 280, height: 280, background: '#fff' }}
            >
              {pairing.qr ? (
                <img src={pairing.qr} alt="Pairing QR code" width={256} height={256} />
              ) : (
                <span className="text-[12px] text-slate-500">QR unavailable — enter the code manually</span>
              )}
            </div>

            <div className="mt-4 text-center">
              <p className="text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--text-tertiary)' }}>
                Pairing code
              </p>
              <p className="mt-1 text-[24px] font-semibold tracking-[0.22em]" style={{ ...mono, color: 'var(--text-primary)' }}>
                {pairing.code}
              </p>
              <p className="mt-1 text-[11.5px]" style={{ color: remaining < 120 ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
              </p>
            </div>

            <div
              className="mt-3 rounded-lg px-3 py-2"
              style={{ background: 'var(--bg-void)', border: '1px solid var(--border-default)' }}
            >
              <p className="text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--text-tertiary)' }}>
                Fingerprint — must match your phone
              </p>
              <p className="mt-1 break-all text-[11.5px] leading-[1.45]" style={{ ...mono, color: 'var(--accent)' }}>
                {pairing.fingerprintPretty}
              </p>
            </div>

            <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
              <li>On your phone, open Safari or Chrome and go to the LAN address above.</li>
              <li>Tap “Visit Website” to accept XR’s self-signed certificate.</li>
              <li>Scan this QR code (or type the code) and compare the fingerprint.</li>
            </ol>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="flex-1 rounded-lg px-3 py-2 text-[13px]"
                style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
              >
                Done
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void startPairing()}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold"
                style={{ background: 'var(--accent)', color: 'var(--bg-void)' }}
              >
                <RefreshCw size={13} strokeWidth={1.8} aria-hidden />
                New code
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function IconButton({
  onClick,
  label,
  done,
  variant = 'copy',
}: {
  onClick: () => void;
  label: string;
  done?: boolean | undefined;
  variant?: 'copy' | 'danger' | 'send' | undefined;
}) {
  const color = variant === 'danger' ? 'var(--danger)' : variant === 'send' ? 'var(--accent)' : 'var(--text-tertiary)';
  const Icon = variant === 'danger' ? Trash2 : variant === 'send' ? Send : done ? Check : Copy;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-lg p-1.5"
      style={{ border: '1px solid var(--border-default)', color: done ? 'var(--success)' : color }}
    >
      <Icon size={13} strokeWidth={1.7} aria-hidden />
    </button>
  );
}
