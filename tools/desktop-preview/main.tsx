import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileCard } from '../../desktop/src/components/settings/MobileCard';
import './styles.css';

/**
 * Minimal API shim — the desktop app passes its own client in production.
 * The daemon token comes from the URL in this harness only (?token=...).
 */
const token = new URLSearchParams(location.search).get('token') ?? '';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

function App() {
  const [meta, setMeta] = useState<{ lan: boolean; host: string } | null>(null);
  const [fingerprint, setFingerprint] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const version = await fetchJson<{ lan: boolean; host: string }>('/api/meta/version');
        setMeta(version);
        const cert = await fetchJson<{ fingerprint: string }>('/api/mobile/cert-fingerprint');
        setFingerprint(cert.fingerprint.replace(/(..)/g, '$1:').replace(/:$/, ''));
      } catch {
        setMeta({ lan: false, host: 'offline' });
      }
    })();
  }, []);

  return (
    <div className="min-h-screen p-8" style={{ background: 'var(--bg-void)' }}>
      <div className="mx-auto max-w-[560px]">
        <h1 className="mb-1 text-[22px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Settings
        </h1>
        <p className="mb-5 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          Desktop · XR {meta?.host ?? ''}
        </p>
        <MobileCard
          lanEnabled={meta?.lan ?? false}
          lanUrl={meta?.host ?? ''}
          fingerprintPretty={fingerprint}
          fetchJson={fetchJson}
          onEnableLan={() => window.alert('Restart XR with: xr serve --lan')}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
