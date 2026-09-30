import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { initTheme } from '@/stores/theme';
import './styles/globals.css';

// Sync the DOM with the persisted theme before the first render.
initTheme();

const queryClient = new QueryClient();

if (import.meta.env.DEV) {
  console.info('[XR] Phase 0 scaffold — dev build');
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
