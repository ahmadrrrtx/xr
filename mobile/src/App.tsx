import { useEffect } from 'react';
import { Stack } from './components/Stack';
import { TabBar } from './components/TabBar';
import { NetworkBar, Toasts, UpdateBanner, InstallPrompt } from './components/Overlays';
import { ChatListScreen } from './screens/ChatListScreen';
import { ConversationScreen } from './screens/ConversationScreen';
import { VoiceScreen } from './screens/VoiceScreen';
import { ApprovalsScreen } from './screens/ApprovalsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { PairingScreen } from './screens/PairingScreen';
import { useNav, type Route } from './stores/nav';
import { useConnection } from './stores/connection';
import { useSettings } from './stores/settings';
import { useChats } from './stores/chats';
import { useApprovals } from './stores/approvals';
import { drain } from './lib/sync';
import { api } from './api/client';
import { isDarkTheme } from './lib/theme';
import { deepLink } from './main';
import type { ModelInfo } from './types';

export default function App({
  needRefresh,
  onRefresh,
}: {
  needRefresh: boolean;
  onRefresh: () => void;
}) {
  const status = useConnection((s) => s.status);
  const probe = useConnection((s) => s.probe);
  const setOnline = useConnection((s) => s.setOnline);
  const hydrate = useSettings((s) => s.hydrate);
  const setModels = useSettings((s) => s.setModels);
  const countOpen = useSettings((s) => s.countOpen);
  const theme = useSettings((s) => s.theme);

  /* ------------------------------------------------------------------ boot --- */
  useEffect(() => {
    // Deep link from a tapped notification: land straight on Approvals.
    const link = deepLink();
    if (link.tab === 'approvals') useNav.getState().setTab('approvals');

    void hydrate().then(async () => {
      void countOpen();
      const result = await probe();
      if (result === 'connected') {
        void useChats.getState().load();
        void useApprovals.getState().load();
        try {
          const { models } = await api.models();
          setModels(models as ModelInfo[]);
        } catch {
          /* offline — keep whatever we cached */
        }
        void drain();
      }
    });
  }, [hydrate, probe, setModels, countOpen]);

  /* ------------------------------------------------- reachability + draining --- */
  useEffect(() => {
    const onOnline = (): void => {
      setOnline(true);
      void probe().then((result) => {
        if (result === 'connected') void drain();
      });
    };
    const onOffline = (): void => setOnline(false);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void probe().then((result) => {
          if (result === 'connected') void drain();
        });
      }
    };
    // The service worker tells us Background Sync ran while we were closed.
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string } | null;
      if (data?.type === 'xr-drain') void drain();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [probe, setOnline]);

  // Keep the OS status bar / theme-color in sync with the active theme.
  useEffect(() => {
    document.documentElement.style.colorScheme = isDarkTheme(theme) ? 'dark' : 'light';
  }, [theme]);

  if (status === 'unpaired') {
    return (
      <Shell>
        <PairingScreen reason={useConnection.getState().lastError ?? undefined} />
      </Shell>
    );
  }

  return (
    <Shell>
      <UpdateBanner needRefresh={needRefresh} onRefresh={onRefresh} />
      <div className="min-h-0 flex-1">
        <Stack render={(route) => <RouteView route={route} />} />
      </div>
      <TabBar />
      <Toasts />
      <InstallPrompt />
    </Shell>
  );
}

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'conversation':
      return <ConversationScreen chatId={route.chatId} title={route.title} />;
    case 'voice':
      return <VoiceScreen />;
    case 'approvals':
      return <ApprovalsScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'pairing':
      return <PairingScreen />;
    case 'chat-list':
    default:
      return <ChatListScreen />;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col"
      style={{ height: '100dvh', background: 'var(--bg-void)', overflow: 'hidden' }}
    >
      <NetworkBar />
      {children}
    </div>
  );
}
