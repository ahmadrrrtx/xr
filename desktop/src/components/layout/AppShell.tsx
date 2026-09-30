import { Outlet } from 'react-router-dom';

import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';

/**
 * Global application shell: fixed 52px topbar (also the drag region), fixed
 * 72px icon-rail sidebar, and a single scrollable content region below.
 * Every one of the 14 screens renders inside this layout (docs/SCREEN-BRIEFS.md).
 */
export function AppShell() {
  return (
    <div className="bg-bg-void text-text-primary flex h-screen flex-col">
      <Topbar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="bg-bg-void min-w-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
