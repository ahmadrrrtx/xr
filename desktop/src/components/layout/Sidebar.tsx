/*
 * Sidebar — the permanent left rail (docs/SCREEN-BRIEFS.md · GLOBAL
 * APPLICATION SHELL · Phase 1 brief §5.2).
 *
 * Widths 72px (collapsed, launch default) ↔ 240px (expanded), animated with
 * a Framer spring (380/28). Fourteen nav items in fixed order, a 4px accent
 * bar on the active item's left edge, collapsed-only tooltips (200ms),
 * budget health dot, user card (expanded), rotating collapse toggle.
 * The nav region scrolls only when the viewport is too short (<700px);
 * logo (top) and user/collapse (bottom) stay pinned.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { PanelLeft } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';

import { Logo } from '@/components/brand/Logo';
import { UserMenu } from '@/components/layout/UserMenu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { NAV_ITEMS, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import { selectShieldState, useShieldStore } from '@/stores/shieldStore';
import { useSidebarStore } from '@/stores/sidebar';

const COLLAPSED_WIDTH = 72;
const EXPANDED_WIDTH = 240;

/** Settings → Appearance icon size → Lucide pixels. */
const ICON_PX: Record<'s' | 'm' | 'l', number> = { s: 16, m: 20, l: 24 };

/** 4px accent bar on the active item's left edge (24–28px tall). */
function ActiveBar({ tall }: { tall: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-accent absolute top-1/2 left-0 w-[4px] translate-y-[-50%] rounded-r-[4px]',
        tall ? 'h-7' : 'h-6'
      )}
    />
  );
}

/** Budget health dot — static green until the Phase 13 spend governor. */
function BudgetDot() {
  return (
    <span
      aria-hidden="true"
      className="bg-success absolute top-[7px] right-[9px] h-1.5 w-1.5 rounded-full"
    />
  );
}

/** Shield status dot (Phase 12): green/yellow/red from the last health check. */
function ShieldDot() {
  const state = useShieldStore(selectShieldState);
  const paused = useShieldStore((s) => s.paused);
  const effective = paused && state !== 'compromised' ? 'attention' : state;
  const color =
    effective === 'compromised'
      ? 'var(--danger)'
      : effective === 'attention'
        ? 'var(--warning)'
        : effective === 'protected'
          ? 'var(--success)'
          : 'var(--text-tertiary)';
  return (
    <span
      aria-hidden="true"
      data-testid="sidebar-shield-dot"
      data-state={effective}
      className="absolute top-[7px] right-[9px] h-1.5 w-1.5 rounded-full"
      style={{ background: color }}
    />
  );
}

function SidebarNavItem({
  item,
  collapsed,
  iconSize,
}: {
  item: NavItem;
  collapsed: boolean;
  iconSize: number;
}) {
  const Icon = item.icon;
  const isBudget = item.id === 'budget';
  const isShield = item.id === 'shield';

  const link = (
    <NavLink
      to={item.path}
      aria-label={item.label}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center rounded-md no-underline transition-colors duration-150 ease-out',
          'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
          collapsed ? 'h-11 w-11 justify-center' : 'h-10 w-full gap-2.5 px-2',
          isActive
            ? 'bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]'
            : 'hover:bg-bg-raised'
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <ActiveBar tall={collapsed} />}
          <span className="relative flex shrink-0 items-center">
            <Icon
              size={iconSize}
              strokeWidth={isActive ? 2 : 1.5}
              aria-hidden="true"
              className={cn(
                'transition-colors duration-150 ease-out',
                isActive
                  ? 'text-text-primary'
                  : 'text-text-secondary group-hover:text-text-primary'
              )}
            />
            {isBudget && <BudgetDot />}
            {isShield && <ShieldDot />}
          </span>
          {!collapsed && (
            <span
              className={cn(
                'text-[14px] whitespace-nowrap transition-colors duration-150 ease-out',
                isActive
                  ? 'text-text-primary font-medium'
                  : 'text-text-secondary group-hover:text-text-primary'
              )}
            >
              {item.label}
            </span>
          )}
        </>
      )}
    </NavLink>
  );

  // Collapsed: tooltip to the right (200ms via the app-wide TooltipProvider).
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent
          side="right"
          className="border-none bg-[var(--tooltip-bg)] text-[var(--tooltip-fg)]"
        >
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }
  return link;
}

function CollapseButton({ collapsed }: { collapsed: boolean }) {
  const toggle = useSidebarStore((state) => state.toggle);
  return (
    <button
      type="button"
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-keyshortcuts="Meta+B Control+B"
      title="Toggle sidebar (⌘B)"
      onClick={toggle}
      className={cn(
        'text-text-secondary hover:bg-bg-raised hover:text-text-primary focus-visible:ring-accent flex items-center rounded-md transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none',
        collapsed ? 'h-11 w-11 justify-center' : 'h-10 w-full justify-end px-2'
      )}
    >
      <motion.span
        aria-hidden="true"
        animate={{ rotate: collapsed ? 0 : 180 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="flex items-center"
      >
        <PanelLeft size={18} strokeWidth={1.5} />
      </motion.span>
    </button>
  );
}

export function Sidebar() {
  const collapsed = useSidebarStore((state) => state.collapsed);
  const iconSize = useSettingsStore((state) => state.settings.appearance.iconSize);
  const navigate = useNavigate();

  return (
    <motion.aside
      aria-label="Primary navigation"
      initial={false}
      animate={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className="bg-bg-ink border-border-subtle text-text-primary relative z-30 flex h-full shrink-0 flex-col overflow-hidden border-r"
    >
      {/* Top — logo (clicking returns to Chat) */}
      <div className="flex h-[64px] shrink-0 items-center px-2 pt-4 pb-2">
        <button
          type="button"
          onClick={() => navigate('/chat')}
          aria-label="XR — go to Chat"
          title="XR"
          className={cn(
            'focus-visible:ring-accent flex h-10 w-full items-center rounded-md transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none',
            collapsed ? 'justify-center' : 'px-4'
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            {collapsed ? (
              <motion.span
                key="icon"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <Logo variant="icon" />
              </motion.span>
            ) : (
              <motion.span
                key="full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <Logo variant="full" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* Middle — the 14 fixed-order nav items (scrolls only when short) */}
      <nav
        aria-label="Screens"
        className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto px-2 pt-2"
      >
        {NAV_ITEMS.map((item) => (
          <SidebarNavItem
            key={item.id}
            item={item}
            collapsed={collapsed}
            iconSize={ICON_PX[iconSize] ?? 20}
          />
        ))}
      </nav>

      {/* Bottom — user card (expanded only) + collapse toggle */}
      <div className="flex shrink-0 flex-col items-center gap-1 p-2">
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="user-card"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <UserMenu variant="card" />
            </motion.div>
          )}
        </AnimatePresence>
        <CollapseButton collapsed={collapsed} />
      </div>
    </motion.aside>
  );
}
