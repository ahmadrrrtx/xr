/*
 * Integrations (Phase 22) — Zustand.
 *
 *   connectors   the engine's list (registry definitions + connection state)
 *   connectingId the one card waiting for the system browser to come back
 *   cardError    inline error per connector (denied, network, exchange, probe)
 *   dialog       at most one of: api key, BYOK app credentials, custom MCP
 *
 * The store never stores a token, key or client secret. Writes call the engine and
 * then re-read the list, so the card always shows what the engine decided.
 */
import { toast } from 'sonner';
import { create } from 'zustand';
import { openInSystemBrowser } from '@/integrations/browser';
import {
  IntegrationApiError,
  completeOAuth,
  connectApiKey,
  disconnectIntegration,
  listIntegrations,
  saveAppCredentials,
  startOAuth,
  syncIntegration,
  type IntegrationView,
} from '@/integrations/api';
import type { OAuthCallback } from '@/integrations/oauthCallback';

export type IntegrationDialog =
  | { kind: 'api_key'; id: string }
  | { kind: 'app_credentials'; id: string }
  | { kind: 'telegram'; id: string }
  | { kind: 'telegram_settings'; id: string }
  | null;

interface IntegrationsState {
  connectors: IntegrationView[];
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  category: string;
  query: string;
  connectingId: string | null;
  popoverId: string | null;
  busyId: string | null;
  cardError: Record<string, string>;
  dialog: IntegrationDialog;

  load(): Promise<void>;
  setCategory(category: string): void;
  setQuery(query: string): void;
  openDialog(dialog: IntegrationDialog): void;
  closeDialog(): void;
  openPopover(id: string | null): void;

  /** Connect button. OAuth opens the browser; API-key connectors open the form; missing app credentials open BYOK. */
  connect(id: string): Promise<void>;
  /** Called by the deep-link listener. */
  handleCallback(cb: OAuthCallback): Promise<void>;
  saveAppCredentialsAndConnect(id: string, clientId: string, clientSecret: string): Promise<boolean>;
  submitApiKey(id: string, config: Record<string, string>): Promise<boolean>;
  sync(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  clearError(id: string): void;
}

function messageOf(err: unknown): string {
  if (err instanceof IntegrationApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Try again.';
}

function setCardError(set: (p: Partial<IntegrationsState>) => void, get: () => IntegrationsState, id: string, message: string | null): void {
  const next = { ...get().cardError };
  if (message) next[id] = message;
  else delete next[id];
  set({ cardError: next });
}

export const useIntegrationsStore = create<IntegrationsState>((set, get) => {
  const refresh = async (): Promise<void> => {
    const { connectors } = await listIntegrations();
    set({ connectors, loaded: true, loadError: null });
  };

  return {
    connectors: [],
    loaded: false,
    loading: false,
    loadError: null,
    category: 'all',
    query: '',
    connectingId: null,
    popoverId: null,
    busyId: null,
    cardError: {},
    dialog: null,

    async load() {
      set({ loading: true });
      try {
        await refresh();
      } catch (err) {
        set({ loadError: messageOf(err), loaded: true });
      } finally {
        set({ loading: false });
      }
    },

    setCategory: (category) => set({ category }),
    setQuery: (query) => set({ query }),
    openDialog: (dialog) => set({ dialog }),
    closeDialog: () => set({ dialog: null }),
    openPopover: (popoverId) => set({ popoverId }),

    async connect(id) {
      const view = get().connectors.find((c) => c.id === id);
      if (!view) return;
      setCardError(set, get, id, null);

      if (view.authType === 'oauth2') {
        if (!view.hasAppCredentials) {
          set({ dialog: { kind: 'app_credentials', id } });
          return;
        }
        try {
          const { authorizeUrl, expiresInSeconds } = await startOAuth(id);
          set({ connectingId: id });
          // The engine's pending state expires on the same clock; clear the spinner with it.
          window.setTimeout(() => {
            if (get().connectingId === id) set({ connectingId: null });
          }, expiresInSeconds * 1000);
          await openInSystemBrowser(authorizeUrl);
          toast.message('Complete the sign-in in your browser.', { description: 'XR will continue when the browser returns.' });
        } catch (err) {
          set({ connectingId: null });
          setCardError(set, get, id, messageOf(err));
        }
        return;
      }

      if (view.authType === 'api_key') {
        set({ dialog: { kind: 'api_key', id } });
        return;
      }
      setCardError(set, get, id, 'This sign-in type is not available in this build yet.');
    },

    async handleCallback(cb) {
      const id = get().connectingId;
      set({ connectingId: null });
      try {
        if (cb.kind === 'denied') {
          await completeOAuth({ state: cb.state, error: 'access_denied' });
          return;
        }
        const { connector } = await completeOAuth({ code: cb.code, state: cb.state });
        await refresh();
        toast.success(`Connected to ${connector.name}${connector.account?.login ? ` as ${connector.account.login}` : ''}`);
        if (id) setCardError(set, get, id, null);
      } catch (err) {
        if (id) {
          const code = err instanceof IntegrationApiError ? err.code : '';
          // The engine's sentence already says what happened; show it as-is.
          setCardError(set, get, id, code === 'access_denied' ? 'You denied access. Retry when ready.' : messageOf(err));
        }
        await refresh().catch(() => undefined);
      }
    },

    async saveAppCredentialsAndConnect(id, clientId, clientSecret) {
      try {
        await saveAppCredentials(id, clientId, clientSecret);
        await refresh();
        set({ dialog: null });
        // The engine has the credentials now; start the normal Connect path.
        await get().connect(id);
        return true;
      } catch (err) {
        setCardError(set, get, id, messageOf(err));
        return false;
      }
    },

    async submitApiKey(id, config) {
      set({ busyId: id });
      try {
        const { connector } = await connectApiKey(id, config);
        await refresh();
        set({ dialog: null });
        toast.success(`Connected to ${connector.name}`);
        setCardError(set, get, id, null);
        return true;
      } catch (err) {
        // Inline in the dialog. Nothing is stored on a failed probe, so the card stays as it was.
        setCardError(set, get, id, messageOf(err));
        return false;
      } finally {
        set({ busyId: null });
      }
    },

    async sync(id) {
      set({ busyId: id });
      try {
        await syncIntegration(id);
        await refresh();
        setCardError(set, get, id, null);
        toast.success('Sync complete');
      } catch (err) {
        await refresh().catch(() => undefined);
        setCardError(set, get, id, messageOf(err));
      } finally {
        set({ busyId: null });
      }
    },

    async disconnect(id) {
      set({ busyId: id });
      try {
        const { revoked } = await disconnectIntegration(id);
        await refresh();
        setCardError(set, get, id, null);
        set({ popoverId: null });
        toast.success(revoked ? 'Disconnected and access revoked' : 'Disconnected. The provider could not confirm revocation; remove XR from the provider settings if needed.');
      } catch (err) {
        setCardError(set, get, id, messageOf(err));
      } finally {
        set({ busyId: null });
      }
    },

    clearError: (id) => setCardError(set, get, id, null),
  };
});
