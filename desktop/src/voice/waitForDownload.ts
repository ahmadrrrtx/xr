import { withinDeadline, RequestDeadlineExpired } from '@/engine/deadline';
import { voiceApi, type VoiceDownloadProgress } from './voiceApi';

/** Polling disappearing is not success. Verify the requested voice AND the
 * runtime on disk; terminal failures and a single absolute budget are final. */
export async function waitForVoiceDownload(id: string, caller: AbortSignal, progress: (p: VoiceDownloadProgress) => void): Promise<void> {
  try {
    await withinDeadline(async (signal) => {
      for (;;) {
        await new Promise<void>((resolve, reject) => {
          const stop = () => { clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 1000);
          signal.addEventListener('abort', stop, { once: true });
          if (signal.aborted) stop();
        });
        const status = await voiceApi.status({ signal });
        signal.throwIfAborted();
        const p = status.download;
        if (p?.status === 'error' || p?.status === 'cancelled')
          throw new Error(p.status === 'error' ? 'Voice download failed. Retry in Settings → Voice.' : 'Voice download cancelled.');
        if (p) progress(p);
        if (p && (p.status !== 'done' || (p.bundleReceived ?? p.received) < (p.bundleTotal ?? p.total))) continue;
        const [voices, models] = await Promise.all([voiceApi.voices({ signal }), voiceApi.models({ signal })]);
        signal.throwIfAborted();
        if (!voices.voices.some(v => v.id === id && v.installed) || !models.runtime.installed)
          throw new Error('The requested voice or runtime is not installed. Retry in Settings → Voice.');
        return;
      }
    }, 600_000, caller);
  } catch (e) {
    if (e instanceof RequestDeadlineExpired) throw new Error('Voice download timed out. Check Settings → Voice before retrying.');
    throw e;
  }
}
