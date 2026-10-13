import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');

const root = createRoot(container);
let needRefresh = false;

function render(): void {
  root.render(
    <StrictMode>
      <App
        needRefresh={needRefresh}
        onRefresh={() => {
          void updateSW(true);
        }}
      />
    </StrictMode>,
  );
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    needRefresh = true;
    render();
  },
  onOfflineReady() {
    /* The shell is cached; nothing to announce. */
  },
});

render();

/**
 * Notification deep links: `?open=approvals&id=<approvalId>`.
 * The service worker launches us with this URL when a push is tapped.
 */
export function deepLink(): { tab?: string; approvalId?: string } {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get('open') ?? undefined,
    approvalId: params.get('id') ?? undefined,
  };
}
