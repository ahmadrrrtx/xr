/*
 * User menu (Phase 1 brief §5.9) — avatar dropdown in the topbar, also used
 * as the expanded-sidebar user card. Placeholder actions are honest toasts;
 * Settings navigates; Quit closes the window inside the Tauri shell.
 *
 * The trigger button is rendered here directly (not passed as a child
 * component) so Radix's asChild pattern can attach its ref to a plain DOM
 * element.
 */
import {
  ChevronsUpDown,
  LogOut,
  RefreshCw,
  Settings,
  User,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { MiniAvatar } from '@/components/brand/MiniAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { closeWindow, isTauri } from '@/lib/tauri';
import { useUIStore } from '@/stores/ui';

export function UserMenu({
  variant = 'avatar',
}: {
  variant?: 'avatar' | 'card';
}) {
  const navigate = useNavigate();
  const userName = useUIStore((state) => state.userName);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        className={cn(
          'focus-visible:ring-accent rounded-md transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none',
          variant === 'avatar'
            ? 'ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full'
            : 'hover:bg-bg-raised flex h-10 w-full cursor-pointer items-center gap-2.5 px-2 text-left'
        )}
      >
        {variant === 'avatar' ? (
          <button
            type="button"
            aria-label={`Open user menu for ${userName}`}
            title="Account"
            className="flex h-7 w-7 items-center justify-center rounded-full"
          >
            <MiniAvatar size={28} />
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Account — ${userName}`}
            title="Account"
            className="flex h-10 w-full items-center gap-2.5 text-left"
          >
            <MiniAvatar size={24} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-text-primary truncate text-sm leading-tight font-medium">
                {userName}
              </span>
              <span className="text-text-tertiary font-mono text-[10px] leading-tight">
                Personal
              </span>
            </span>
          </button>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[220px]">
        <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2">
          <MiniAvatar size={28} />
          <span className="flex min-w-0 flex-col">
            <span className="text-text-primary truncate text-sm font-medium">
              {userName}
            </span>
            <span className="text-text-tertiary text-xs">
              Local profile — no account
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            toast('Profile coming in Phase 8', {
              description: 'Settings owns the real profile in Phase 8.',
            })
          }
        >
          <User size={16} strokeWidth={1.5} aria-hidden="true" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            toast('Workspaces coming in Phase 10', {
              description:
                'Workspace switching lands with the Workspaces screen.',
            })
          }
        >
          <ChevronsUpDown size={16} strokeWidth={1.5} aria-hidden="true" />
          Switch workspace
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings size={16} strokeWidth={1.5} aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            toast.success("You're on the latest version", {
              description: 'XR 0.2.0 — updater checks arrive with Phase 23.',
            })
          }
        >
          <RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />
          Check for updates
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            if (isTauri()) {
              void closeWindow();
            } else {
              toast('Quit works inside the XR app', {
                description:
                  'Running in browser preview — window controls are inert.',
              });
            }
          }}
        >
          <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
          Quit XR
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
