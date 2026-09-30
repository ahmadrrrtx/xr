import { RouterProvider } from 'react-router-dom';

import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { useThemeShortcut } from '@/hooks/useThemeShortcut';
import { router } from '@/router';

export default function App() {
  useThemeShortcut();

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
