import { useState } from 'react';
import { useVoiceStore } from './voiceStore';

/** A conflict is visible user intent, not an automatic last-writer-wins retry. */
export function PreferenceNotice() {
  const message = useVoiceStore(s => s.preferenceError);
  const resolve = useVoiceStore(s => s.resolvePendingPreferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!message) return null;
  const choose = async (apply: boolean) => {
    setBusy(true); setError(null);
    try { await resolve(apply); }
    catch { setError('Could not resolve pending choices. Nothing was silently replaced. Retry when the engine is ready.'); }
    finally { setBusy(false); }
  };
  return <div role="alert" className="border-warning/40 bg-warning/5 mb-4 rounded-xl border p-4 text-sm">
    <p>{message}</p><p className="text-text-secondary mt-1">The controls below show the engine settings. Applying the saved onboarding choices replaces their voice, speed, microphone and activation preferences.</p>
    <div className="mt-3 flex gap-3">
      <button type="button" disabled={busy} onClick={() => void choose(false)}>Keep engine settings</button>
      <button type="button" disabled={busy} onClick={() => void choose(true)}>Apply saved onboarding choices</button>
    </div>{error ? <p className="mt-2">{error}</p> : null}
  </div>;
}
