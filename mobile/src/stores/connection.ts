import { create } from 'zustand';
import { api, isOfflineError, ApiError } from '../api/client';
import type { ConnectionStatus, DaemonMeta } from '../types';

export type CertState = 'unknown' | 'first-use' | 'ok' | 'mismatch';

interface ConnectionState {
  status: ConnectionStatus;
  /** Browser-level connectivity (navigator.onLine). */
  online: boolean;
  meta: DaemonMeta | null;
  fingerprint: string | null;
  cert: CertState;
  lastError: string | null;
  probing: boolean;

  setOnline: (online: boolean) => void;
  probe: () => Promise<ConnectionStatus>;
  markUnpaired: (reason?: string) => void;
  setFingerprint: (fp: string | null) => void;
  setCert: (cert: CertState) => void;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  status: 'connecting',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  meta: null,
  fingerprint: null,
  cert: 'unknown',
  lastError: null,
  probing: false,

  setOnline: (online) => {
    const changed = get().online !== online;
    set({ online });
    if (changed && !online) set({ status: 'offline' });
  },

  probe: async () => {
    if (get().probing) return get().status;
    set({ probing: true });

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      set({ status: 'offline', probing: false, online: false });
      return 'offline';
    }

    try {
      const meta = await api.meta();
      set({ status: 'connected', meta, lastError: null, online: true, probing: false });
      return 'connected';
    } catch (error) {
      if (error instanceof ApiError && error.unpaired) {
        set({ status: 'unpaired', lastError: null, probing: false });
        return 'unpaired';
      }
      if (isOfflineError(error)) {
        set({ status: 'offline', probing: false, online: false });
        return 'offline';
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      set({ status: 'offline', lastError: message, probing: false });
      return 'offline';
    }
  },

  markUnpaired: (reason) =>
    set({ status: 'unpaired', meta: null, lastError: reason ?? null, probing: false }),

  setFingerprint: (fingerprint) => set({ fingerprint }),
  setCert: (cert) => set({ cert }),
}));

/** Human copy for the connection card. Honest about the LAN-only v1 promise. */
export function connectionCopy(status: ConnectionStatus): { title: string; detail: string } {
  switch (status) {
    case 'connected':
      return { title: 'Connected to XR on your WiFi', detail: 'Live · same network' };
    case 'connecting':
      return { title: 'Connecting…', detail: 'Looking for XR on this network' };
    case 'unpaired':
      return {
        title: 'Pair with your desktop',
        detail: 'Open Settings → Mobile → Pair new device in XR',
      };
    case 'offline':
    default:
      return {
        title: 'Connect to your home WiFi to use XR',
        detail: 'XR must be running on your computer on the same WiFi.',
      };
  }
}
