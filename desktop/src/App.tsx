import { RouterProvider } from 'react-router-dom';

import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { router } from '@/router';

export default function App() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
