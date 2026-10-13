import { useEffect, useMemo, useState } from 'react';
import { QrCode, ShieldAlert, Wifi, ArrowRight } from 'lucide-react';
import { api, isOfflineError } from '../api/client';
import { checkPin, clearPin, fetchFingerprint, readPin, writePin } from '../lib/certpin';
import { ensurePushKey, currentWireSubscription, pushSupported, subscribePush } from '../lib/push';
import { useConnection } from '../stores/connection';
import { useSettings } from '../stores/settings';
import { useQueue } from '../stores/queue';
import { useNav } from '../stores/nav';
import { formatFingerprint } from '../lib/format';
import { haptic } from '../lib/haptics';
import { XRWordmark } from '../components/Wordmark';
import type { PairingParams } from '../types';

type Stage = 'scan' | 'confirm' | 'manual' | 'mismatch';

export function PairingScreen({ reason }: { reason?: string }) {
  const params = useMemo<PairingParams>(() => readParams(), []);
  const [stage, setStage] = useState<Stage>(params.code && params.fp ? 'confirm' : 'scan');
  const [manualHost, setManualHost] = useState(params.host ?? '');
  const [manualCode, setManualCode] = useState(params.code ?? '');
  const [manualFp, setManualFp] = useState(params.fp ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string>(params.fp ?? '');

  const status = useConnection((s) => s.status);
  const probe = useConnection((s) => s.probe);
  const markUnpaired = useConnection((s) => s.markUnpaired);
  const setCert = useConnection((s) => s.setCert);
  const deviceName = useSettings((s) => s.deviceName);
  const refreshQueue = useQueue((s) => s.refresh);
  const reset = useNav((s) => s.reset);

  /* Already paired? Walk straight into the app. */
  useEffect(() => {
    let cancelled = false;
    const boot = async (): Promise<void> => {
      const pin = await readPin();
      if (!pin) return;
      const offered = await fetchFingerprint();
      if (cancelled) return;
      if (offered) {
        const verdict = await checkPin(window.location.host, offered);
        if (verdict === 'mismatch') {
          setFingerprint(offered);
          setCert('mismatch');
          setStage('mismatch');
          return;
        }
        if (verdict === 'first-use') await writePin(window.location.host, offered);
      }
      const result = await probe();
      if (!cancelled && result === 'connected') {
        await refreshQueue();
        reset('chat');
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [probe, reset, refreshQueue, setCert]);

  const doPair = async (code: string, fp: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Best-effort push subscription so the very first approval can arrive.
      let subscription: unknown = undefined;
      if (pushSupported() && Notification.permission === 'granted') {
        try {
          const { publicKey } = await api.vapidKey();
          await subscribePush(publicKey);
          subscription = await currentWireSubscription();
        } catch {
          subscription = undefined;
        }
      }
      const pushKey = await ensurePushKey();

      await api.pair({
        code,
        deviceName,
        pushKey,
        ...(subscription ? { pushSubscription: subscription } : {}),
      });

      // Only after the user has compared and confirmed do we pin the cert.
      if (fp) await writePin(window.location.host, fp);
      else {
        const offered = await fetchFingerprint();
        if (offered) await writePin(window.location.host, offered);
      }

      haptic('success');
      const result = await probe();
      if (result === 'connected' || result === 'unpaired') {
        await refreshQueue();
        reset('chat');
      }
    } catch (cause) {
      setError(
        isOfflineError(cause)
          ? 'Can’t reach XR. Check that your desktop is running and you’re on the same WiFi.'
          : 'That code isn’t right, or it expired. Generate a new one on your desktop.',
      );
      haptic('error');
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------ mismatch --- */
  if (stage === 'mismatch') {
    return (
      <Centered>
        <ShieldAlert size={30} strokeWidth={1.4} style={{ color: 'var(--danger)' }} aria-hidden />
        <h1 className="mt-3 text-[20px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Unrecognised XR certificate
        </h1>
        <p className="mt-2 max-w-[310px] text-[14px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
          This computer is presenting a different certificate than the one you paired with. That can
          mean XR was reinstalled — or that someone is impersonating it on your network.
        </p>
        <Fingerprint value={fingerprint} />
        <div className="mt-5 flex w-full gap-2">
          <button
            type="button"
            onClick={async () => {
              await clearPin();
              markUnpaired('Certificate not recognised');
              setStage('scan');
            }}
            className="tap flex-1 rounded-[12px] text-[15px] font-medium"
            style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
          >
            Don’t connect
          </button>
          <button
            type="button"
            onClick={async () => {
              await writePin(window.location.host, fingerprint);
              const result = await probe();
              if (result === 'connected') reset('chat');
            }}
            className="tap flex-1 rounded-[12px] text-[15px] font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--bg-void)' }}
          >
            Trust anyway
          </button>
        </div>
      </Centered>
    );
  }

  /* -------------------------------------------------------------- confirm --- */
  if (stage === 'confirm') {
    return (
      <Centered>
        <XRWordmark size={54} />
        <h1 className="mt-4 text-[20px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Pair with your XR desktop
        </h1>
        <p className="mt-1.5 max-w-[320px] text-[14px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
          Compare this fingerprint with the one on your desktop. They must match.
        </p>
        <Fingerprint value={fingerprint} />
        {error ? (
          <p className="mt-3 max-w-[320px] text-center text-[13px]" style={{ color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-5 w-full">
          <button
            type="button"
            disabled={busy}
            onClick={() => void doPair(params.code ?? '', fingerprint)}
            className="tap w-full rounded-[12px] text-[16px] font-semibold disabled:opacity-60"
            style={{ background: 'var(--accent)', color: 'var(--bg-void)' }}
          >
            {busy ? 'Pairing…' : 'They match — Pair'}
          </button>
          <button
            type="button"
            onClick={() => setStage('scan')}
            className="tap mt-2 w-full rounded-[12px] text-[15px]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
        </div>
      </Centered>
    );
  }

  /* ---------------------------------------------------------------- manual --- */
  if (stage === 'manual') {
    const ready = manualHost.trim().length > 0 && /^\d{6}$/.test(manualCode.trim());
    return (
      <Centered>
        <h1 className="text-[20px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Enter details manually
        </h1>
        <p className="mt-1.5 max-w-[320px] text-[13.5px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
          Type the address and the 6-digit code shown on your desktop.
        </p>

        <div className="mt-4 w-full space-y-2">
          <Field
            label="Address"
            value={manualHost}
            onChange={setManualHost}
            placeholder="192.168.1.24:3141"
            inputMode="url"
          />
          <Field
            label="Pairing code"
            value={manualCode}
            onChange={(next) => setManualCode(next.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            mono
          />
          <Field
            label="Fingerprint (optional)"
            value={manualFp}
            onChange={setManualFp}
            placeholder="a1b2c3…"
            mono
          />
        </div>

        {error ? (
          <p className="mt-3 text-[13px]" style={{ color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex w-full gap-2">
          <button
            type="button"
            onClick={() => setStage('scan')}
            className="tap flex-1 rounded-[12px] text-[15px]"
            style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
          >
            Back
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => {
              const host = manualHost.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
              if (host && host !== window.location.host) {
                window.location.href = `https://${host}/mobile/pair?code=${encodeURIComponent(manualCode.trim())}&fp=${encodeURIComponent(manualFp.trim())}`;
                return;
              }
              setFingerprint(manualFp.trim());
              void doPair(manualCode.trim(), manualFp.trim());
            }}
            className="tap flex-1 rounded-[12px] text-[15px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--bg-void)' }}
          >
            Pair
          </button>
        </div>
      </Centered>
    );
  }

  /* ------------------------------------------------------------------ scan --- */
  return (
    <Centered>
      <XRWordmark size={64} />
      <h1 className="mt-4 text-[21px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        Pair with your desktop
      </h1>
      <p className="mt-2 max-w-[320px] text-[14px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
        {reason ??
          (status === 'offline'
            ? 'Connect to your home WiFi, then scan the QR code in XR → Settings → Mobile.'
            : 'In XR on your computer, open Settings → Mobile → Pair new device, then scan the QR code.')}
      </p>

      <div
        className="mt-5 flex w-full items-center gap-3 rounded-[14px] p-3.5"
        style={{
          border: '1px solid var(--border-subtle)',
          background: 'color-mix(in srgb, var(--bg-ink) 88%, transparent)',
        }}
      >
        <Wifi size={18} strokeWidth={1.5} style={{ color: 'var(--accent)', flexShrink: 0 }} aria-hidden />
        <p className="text-[13px] leading-[1.45]" style={{ color: 'var(--text-tertiary)' }}>
          Your phone and computer must be on the same WiFi. There’s no cloud relay — XR works on your
          network or not at all.
        </p>
      </div>

      <div className="mt-5 w-full">
        <button
          type="button"
          onClick={() => setStage('manual')}
          className="tap flex w-full items-center justify-center gap-2 rounded-[12px] text-[15px] font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--bg-void)' }}
        >
          <QrCode size={17} strokeWidth={1.8} aria-hidden />
          I already have a QR code
        </button>
        <button
          type="button"
          onClick={() => void probe()}
          className="tap mt-2 w-full rounded-[12px] text-[15px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            Retry connection
            <ArrowRight size={15} strokeWidth={1.7} aria-hidden />
          </span>
        </button>
      </div>

      <p className="mt-6 max-w-[320px] text-center text-[11.5px] leading-[1.5]" style={{ color: 'var(--text-tertiary)' }}>
        If Safari warns about the certificate, tap “Visit Website”. XR uses a self-signed certificate
        on your own network — you’ll verify its fingerprint before pairing.
      </p>
    </Centered>
  );
}

/* ------------------------------------------------------------------ pieces --- */

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center px-6 pb-safe pt-safe"
      style={{ background: 'var(--bg-void)' }}
    >
      <div className="flex w-full max-w-[360px] flex-col items-center text-center">{children}</div>
    </div>
  );
}

function Fingerprint({ value }: { value: string }) {
  if (!value) return null;
  return (
    <div
      className="mt-4 w-full rounded-[12px] px-3 py-2.5"
      style={{
        border: '1px solid var(--border-accent)',
        background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
      }}
    >
      <p
        className="text-[10.5px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Certificate fingerprint
      </p>
      <p
        className="mt-1 break-all font-mono text-[14px] leading-[1.4]"
        style={{ color: 'var(--accent)' }}
      >
        {formatFingerprint(value)}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  mono,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'url' | 'numeric';
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-label={label}
        className="w-full rounded-[11px] px-3 outline-none"
        style={{
          minHeight: 44,
          border: '1px solid var(--border-default)',
          background: 'color-mix(in srgb, var(--bg-ink) 88%, transparent)',
          color: 'var(--text-primary)',
          fontFamily: mono ? 'var(--font-mono)' : undefined,
        }}
      />
    </label>
  );
}

function readParams(): PairingParams {
  if (typeof window === 'undefined') return {};
  const search = new URLSearchParams(window.location.search);
  return {
    code: search.get('code') ?? undefined,
    fp: search.get('fp') ?? undefined,
    host: search.get('host') ?? undefined,
  };
}
