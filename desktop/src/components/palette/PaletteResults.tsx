/*
 * Palette results area (Phase 5) — grouped, prefix-filtered cmdk list.
 *
 * Groups (in order): Ask XR (when the query is askable) · Recent (history,
 * empty query only) · Commands · Chats · Agents · Workspaces · Settings ·
 * Web search (the "?" prefix stub). cmdk hides a group whose items were all
 * filtered out via the `hidden` attribute — globals.css enforces display:none
 * for that case (Tailwind classes would otherwise win over the UA stylesheet).
 */
import { Command } from 'cmdk';
import { Globe, Sparkles } from 'lucide-react';

import {
  groupAllowed,
  paletteFilter,
  parsePaletteQuery,
  recentCommands,
  type PaletteCommand,
  type PaletteGroup,
} from '@/lib/paletteCommands';
import { PaletteItem } from '@/components/palette/PaletteItem';
import { usePaletteStore } from '@/stores/paletteStore';
import { cn } from '@/lib/utils';

const GROUP_ORDER: readonly PaletteGroup[] = [
  'commands',
  'chats',
  'agents',
  'workspaces',
  'settings',
];

const GROUP_HEADINGS: Record<PaletteGroup, string> = {
  commands: 'Commands',
  chats: 'Chats',
  agents: 'Agents',
  workspaces: 'Workspaces',
  settings: 'Settings',
};

export const QUICK_ASK_MIN_CHARS = 3;

interface PaletteResultsProps {
  commands: readonly PaletteCommand[];
  isHud: boolean;
  /** Selection bookkeeping (history + close semantics) lives in the shell. */
  onSelectCommand: (command: PaletteCommand) => void;
  /** Fired when the user picks the synthesized "Ask XR" row. */
  onAsk: (question: string) => void;
  /** Fired for the "?" prefix — opens Research with the question. */
  onResearch: (question: string) => void;
}

export function PaletteResults({
  commands,
  isHud,
  onSelectCommand,
  onAsk,
  onResearch,
}: PaletteResultsProps) {
  const query = usePaletteStore((s) => s.query);
  const history = usePaletteStore((s) => s.history);
  const { mode, rest } = parsePaletteQuery(query);
  const trimmed = rest.trim();

  // Prefix mode decides which registry groups survive.
  const filtered = commands.filter(
    (c) =>
      groupAllowed(mode, c.group, import.meta.env.DEV) &&
      (!c.devOnly || import.meta.env.DEV)
  );

  // The askable row appears when the query is long enough to be a question
  // AND nothing in the registry matches it — commands always outrank asking,
  // so ⌘1 means the first real command (prompt §5.5/§7: quick-ask is the
  // fallback for non-matching input). The match count uses the SAME filter
  // cmdk scores with, so what this computes is what the user sees.
  const recent = trimmed.length === 0 && mode === 'all' ? recentCommands(filtered, history) : [];
  const matchCount =
    trimmed.length === 0
      ? 1 // nothing typed — the list is showing; asking is not the fallback
      : [...recent, ...filtered].filter((c) =>
          paletteFilter(
            `${c.title} ${c.keywords?.join(' ') ?? ''}`,
            query
          ) > 0
        ).length;
  const askable =
    mode === 'all' && trimmed.length >= QUICK_ASK_MIN_CHARS && matchCount === 0;
  const askValue = `Ask XR ${trimmed}`;

  return (
    <Command.List
      className={cn(
        'min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-2',
        // In-app the palette floats over content — cap the list; in the HUD
        // the fixed window IS the cap, so the list fills it.
        isHud ? '' : 'max-h-[380px]'
      )}
    >
      {mode === 'search' ? (
        <Command.Group heading="Research">
          <Command.Item
            value={`Research ${rest}`}
            onSelect={() => onResearch(rest.trim())}
            className="xr-palette-item"
            disabled={!rest.trim()}
          >
            <PaletteItem
              icon={Globe}
              title={rest.trim() ? `Research “${rest.trim()}”` : 'Type a question to research'}
              subtitle="Opens Research · searches, reads and cites"
            />
          </Command.Item>
        </Command.Group>
      ) : (
        <>
          {askable && (
            <Command.Group heading="Ask XR">
              <Command.Item
                value={askValue}
                onSelect={() => onAsk(trimmed)}
                className="xr-palette-item"
              >
                <PaletteItem
                  icon={Sparkles}
                  title={`Ask XR: “${trimmed}”`}
                  subtitle="Streams the answer right here"
                />
              </Command.Item>
            </Command.Group>
          )}

          {recent.length > 0 && (
            <Command.Group heading="Recent">
              {recent.map((command) => (
                <Command.Item
                  key={`recent-${command.id}`}
                  value={`${command.title} recent ${command.keywords?.join(' ') ?? ''}`}
                  onSelect={() => onSelectCommand(command)}
                  className="xr-palette-item"
                >
                  <PaletteItem
                    icon={command.icon}
                    title={command.title}
                    subtitle={command.subtitle}
                    shortcut={command.shortcut}
                  />
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {GROUP_ORDER.map((group) => {
            const items = filtered.filter((c) => c.group === group);
            if (items.length === 0) return null;
            return (
              <Command.Group key={group} heading={GROUP_HEADINGS[group]}>
                {items.map((command) => (
                  <Command.Item
                    key={command.id}
                    value={`${command.title} ${command.keywords?.join(' ') ?? ''}`}
                    onSelect={() => onSelectCommand(command)}
                    className="xr-palette-item"
                  >
                    <PaletteItem
                      icon={command.icon}
                      title={command.title}
                      subtitle={command.subtitle}
                      shortcut={command.shortcut}
                    />
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}

          <Command.Empty className="text-text-tertiary py-6 text-center text-sm">
            {trimmed.length > 0 && trimmed.length < QUICK_ASK_MIN_CHARS
              ? 'Keep typing to ask XR a question…'
              : 'Type a command or ask XR a question…'}
          </Command.Empty>
        </>
      )}
    </Command.List>
  );
}
