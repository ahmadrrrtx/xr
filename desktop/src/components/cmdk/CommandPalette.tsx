/*
 * Command palette (Phase 1 brief §5.5) — the in-app cmdk dialog.
 * Groups: Commands (with shortcut hints) · Go to screen (all 14) · Ask XR
 * (any typed query — real ask wiring lands with chat in Phase 4).
 * The global HUD palette is a separate Tauri window in Phase 5.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Logo } from '@/components/brand/Logo';
import { NAV_ITEMS } from '@/lib/nav';
import { useSidebarStore } from '@/stores/sidebar';
import { useThemeStore } from '@/stores/theme';
import { clearOnboardingFlag } from '@/stores/onboarding';
import { useUIStore } from '@/stores/ui';

/** Small right-aligned shortcut chip (mono, per the design system). */
function Shortcut({ children }: { children: string }) {
  return (
    <span
      aria-hidden="true"
      className="bg-bg-raised text-text-tertiary ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] leading-none"
    >
      {children}
    </span>
  );
}

interface CommandAction {
  id: string;
  label: string;
  shortcut: string;
  run: () => void;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUIStore((state) => state.paletteOpen);
  const setPaletteOpen = useUIStore((state) => state.setPaletteOpen);
  const [query, setQuery] = useState('');

  /** Close handler also resets the query (no effect needed). */
  const handleOpenChange = (next: boolean): void => {
    setPaletteOpen(next);
    if (!next) setQuery('');
  };

  const commands: CommandAction[] = [
    {
      id: 'new-chat',
      label: 'New chat',
      shortcut: '⌘N',
      run: () => {
        navigate('/chat');
        toast('New chat — chat logic coming in Phase 4', {
          description: 'The conversation UI ships with the Chat phase.',
        });
      },
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      shortcut: '⌘,',
      run: () => navigate('/settings'),
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle Sidebar',
      shortcut: '⌘B',
      run: () => useSidebarStore.getState().toggle(),
    },
    // Dev-only: replay the whole first-run flow (Phase 3 QA).
    ...(import.meta.env.DEV
      ? [
          {
            id: 'reset-onboarding',
            label: 'Reset onboarding (dev)',
            shortcut: '⇧⌘R',
            run: () => {
              void clearOnboardingFlag().then(() => window.location.reload());
            },
          },
        ]
      : []),
    {
      id: 'cycle-theme',
      label: 'Cycle Theme',
      shortcut: '⌘⇧T',
      run: () => {
        const next = useThemeStore.getState().cycleTheme();
        toast(`Theme — ${next.replace('-', ' ')}`, {
          description: 'Settings gets the full theme picker in Phase 8.',
        });
      },
    },
  ];

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <div className="border-border-subtle flex items-center gap-3 border-b px-4">
        <Logo variant="icon" size={20} />
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Ask XR anything, or type a command..."
          className="h-[52px] text-base"
        />
      </div>
      <CommandList>
        <CommandEmpty>No results — press Enter to ask XR</CommandEmpty>

        <CommandGroup heading="Commands">
          {commands.map((command) => (
            <CommandItem
              key={command.id}
              value={`${command.label} ${command.shortcut}`}
              onSelect={() => {
                setPaletteOpen(false);
                command.run();
              }}
            >
              {command.label}
              <Shortcut>{command.shortcut}</Shortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Go to screen">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.id}
              value={`${item.label} ${item.id} go to screen navigate`}
              onSelect={() => {
                setPaletteOpen(false);
                navigate(item.path);
              }}
            >
              <item.icon
                size={16}
                strokeWidth={1.5}
                aria-hidden="true"
                className="text-text-secondary"
              />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {query.trim().length > 0 && (
          <CommandGroup heading="Ask XR">
            <CommandItem
              value={`Ask: ${query}`}
              onSelect={() => {
                setPaletteOpen(false);
                toast('Chat command coming in Phase 4', {
                  description: `“${query.trim()}” will be answered by the chat engine.`,
                });
              }}
            >
              <span className="text-text-secondary">Ask:</span>
              <span className="text-text-primary truncate font-medium">
                {query.trim()}
              </span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
