import { useCallback, useEffect, useState } from 'react';
import { MobileCard } from '@/components/settings/MobileCard';
import { engineJson, enginePost } from '@/engine/transport';

interface MobileStatus { enabled: boolean; tlsDir: string; url?: string; fingerprint?: string }

export function MobileTab() {
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [host, setHost] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setStatus(await engineJson<MobileStatus>('/mobile/desktop/status')); setError(null); }
    catch (e) { setStatus(null); setError(e instanceof Error ? e.message : 'Engine unavailable'); }
  }, []);
  useEffect(() => {
    let active = true;
    void engineJson<MobileStatus>('/mobile/desktop/status').then((data) => { if (active) setStatus(data); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Engine unavailable'); });
    return () => { active = false; };
  }, []);
  const fetchJson = useCallback(<T,>(path: string, init?: RequestInit) => engineJson<T>(path.replace(/^\/api/, ''), init), []);
  const start = async () => {
    setBusy(true); setError(null);
    try { setStatus(await enginePost<MobileStatus>('/mobile/desktop/start', { host: host.trim() })); setShowSetup(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start mobile access'); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    try { setStatus(await enginePost<MobileStatus>('/mobile/desktop/stop', {})); setConfirmed(false); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not stop mobile access'); return false; }
  };
  return <div className="space-y-4">
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {!status ? <button type="button" onClick={() => void refresh()} className="text-sm text-accent">Retry mobile status</button> : <>
      <MobileCard lanEnabled={status.enabled} lanUrl={status.url} fingerprintPretty={status.fingerprint?.match(/../g)?.join(':')}
        fetchJson={fetchJson} onEnableLan={() => setShowSetup(true)} onDisableLan={disable} />
      {!status.enabled && showSetup ? <section className="space-y-3 rounded-xl border border-border-default p-4" aria-label="Set up mobile access">
        <h3 className="font-semibold">Trusted TLS required</h3>
        <p className="text-sm text-text-secondary">Place a CA-issued certificate chain in <code>{status.tlsDir}/cert.pem</code> and its private key in <code>{status.tlsDir}/key.pem</code>. The certificate must match the hostname you enter below and be trusted by your phone. Configure local DNS so that hostname resolves to this computer.</p>
        <p className="text-sm text-text-secondary">XR cannot verify whether your phone trusts the certificate. Never bypass a browser TLS warning; a displayed fingerprint is not certificate pinning. Only private, link-local and loopback IPv4 clients are allowed; other private networks or VPNs may also reach XR. Mobile access ends when XR exits.</p>
        <label className="block text-sm">Certificate hostname or IP
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="xr.example.com" className="mt-1 block w-full rounded-md border border-border-default bg-bg-ink p-2" />
        </label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I have configured a matching certificate that my phone trusts and will not bypass certificate warnings.</label>
        <div className="flex gap-3"><button type="button" disabled={!host.trim() || !confirmed || busy} onClick={() => void start()} className="rounded-md bg-accent px-3 py-2 text-sm text-bg-void disabled:opacity-50">{busy ? 'Starting…' : 'Enable mobile access'}</button>
          <button type="button" onClick={() => setShowSetup(false)} className="text-sm">Cancel</button></div>
      </section> : null}
    </>}
  </div>;
}
