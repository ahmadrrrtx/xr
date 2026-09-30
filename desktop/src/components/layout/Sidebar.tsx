import { NavLink, useNavigate } from 'react-router-dom';

import { NAV_ITEMS } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Placeholder icon-rail sidebar (72px) — Phase 1 ships the full version
 * (240px expand, tooltips, collapse toggle, user card).
 */
export function Sidebar() {
  const navigate = useNavigate();

  return (
    <aside
      aria-label="Primary navigation"
      className="border-border-subtle bg-bg-ink flex h-full w-[72px] shrink-0 flex-col items-center border-r py-4"
    >
      {/* Wordmark — "XR" in Orbitron, cyan (real logo SVG lands in Phase 2). */}
      <button
        type="button"
        onClick={() => navigate('/chat')}
        aria-label="XR — go to Chat"
        className="mb-6 flex h-11 w-11 items-center justify-center rounded-md"
      >
        <span className="font-display text-accent text-xl font-bold tracking-[0.04em]">
          XR
        </span>
      </button>

      <nav className="flex flex-col items-center gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.id}
            to={item.path}
            aria-label={item.label}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'flex h-11 w-11 items-center justify-center rounded-md',
                isActive
                  ? 'text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              )
            }
          >
            <item.icon size={20} strokeWidth={1.5} aria-hidden="true" />
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
