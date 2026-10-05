/*
 * Command registry (Phase 5) — every searchable palette item.
 *
 * `buildPaletteCommands` is pure: it takes the render context (in-app vs HUD)
 * and the current session list, and returns the full registry. The shared
 * <CommandPalette> rebuilds it on open / store change (well under 100 items —
 * no virtualization, no async work on open).
 *
 * Actions branch on `ctx.isHud`:
 *   - in-app: run against THIS window (react-router, local stores)
 *   - in HUD: run locally when the effect is local (theme), otherwise ride
 *     the Rust IPC bridge (hudNavigate / hudRunMainCommand) so the MAIN
 *     window surfaces, focuses and does the work.
 */
import {
  Activity,
  Braces,
  CircleDot,
  Clock,
  FileText,
  LayoutGrid,
  MessageCircle,
  MessageSquare,
  Mic,
  OctagonX,
  Orbit,
  Palette,
  PanelLeft,
  PenLine,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { AVATAR_STATES } from '@/components/brand/types';
import { newApprovalId, type PendingDecision } from '@/lib/approvalCore';
import { requestApproval } from '@/lib/approvalEvents';
import {
  hudNavigate,
  hudNotifySessionsChanged,
  hudRunMainCommand,
} from '@/lib/hud';
import { orbSetState } from '@/lib/orb';
import { relativeTime, type PaletteGroup } from '@/lib/paletteQuery';
import type { Session } from '@/lib/chat-db';
import { clearOnboardingFlag } from '@/stores/onboarding';
import { useApprovalStore } from '@/stores/approvalStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useSessionsStore } from '@/stores/sessionsStore';
import { useSidebarStore } from '@/stores/sidebar';
import { useThemeStore } from '@/stores/theme';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WORKSPACE_KIND_META, type Workspace } from '@/workspaces/types';

// Pure query primitives live in paletteQuery.ts (importable by the root test
// tier) — re-exported here so palette components have one import site.
export {
  QUICK_ASK_MIN_CHARS,
  groupAllowed,
  modLabel,
  paletteFilter,
  parsePaletteQuery,
  relativeTime,
} from '@/lib/paletteQuery';
export type { PaletteGroup, PrefixMode } from '@/lib/paletteQuery';

export interface PaletteCommand {
  id: string;
  group: PaletteGroup;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  /** Platform-rendered hint ("⌘N" on macOS, "Ctrl+N" elsewhere). */
  shortcut?: string;
  keywords?: string[];
  action: () => void | Promise<void>;
  devOnly?: boolean;
  /** Keep the palette open after running (default: close). */
  keepOpen?: boolean;
}

export interface PaletteContext {
  isHud: boolean;
  /** In-app: react-router navigate. HUD: Rust shows main + navigates. */
  navigate: (route: string) => void;
  platform: 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'web';
  /** Toast helper (sonner) — provided by the palette shell. */
  toast: (message: string, description?: string) => void;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const AGENTS = [
  { name: 'Coder', icon: Braces, blurb: 'Code, refactor, review' },
  { name: 'Researcher', icon: Search, blurb: 'Deep research with citations' },
  { name: 'Writer', icon: PenLine, blurb: 'Drafts, edits, tone' },
  { name: 'Analyst', icon: CircleDot, blurb: 'Data questions and summaries' },
] as const;

export function buildPaletteCommands(
  ctx: PaletteContext,
  sessions: readonly Session[],
  workspaces: readonly Workspace[] = []
): PaletteCommand[] {
  const isMac = ctx.platform === 'macos';
  const sc = (mac: string, other: string) => (isMac ? mac : other);

  /** Create a fresh chat session and open it (both window contexts). */
  const newChat = async (): Promise<void> => {
    const store = useSessionsStore.getState();
    const session = await store.createNewSession();
    store.selectSession(session.id);
    if (ctx.isHud) {
      await hudNotifySessionsChanged();
      await hudNavigate(`/chat/${session.id}`);
    } else {
      ctx.navigate(`/chat/${session.id}`);
    }
  };

  const openRoute = (route: string): void => {
    if (ctx.isHud) {
      void hudNavigate(route);
    } else {
      ctx.navigate(route);
    }
  };

  const commands: PaletteCommand[] = [
    {
      id: 'new-chat',
      group: 'commands',
      title: 'New chat',
      icon: MessageSquare,
      shortcut: sc('⌘N', 'Ctrl+N'),
      keywords: ['start', 'conversation', 'compose'],
      action: newChat,
    },
    {
      id: 'toggle-sidebar',
      group: 'commands',
      title: 'Toggle Sidebar',
      icon: PanelLeft,
      shortcut: sc('⌘B', 'Ctrl+B'),
      keywords: ['panel', 'hide', 'show'],
      action: () => {
        if (ctx.isHud) {
          void hudRunMainCommand('toggle-sidebar');
        } else {
          useSidebarStore.getState().toggle();
        }
      },
    },
    {
      id: 'cycle-theme',
      group: 'commands',
      title: 'Cycle Theme',
      icon: Palette,
      shortcut: sc('⌘⇧T', 'Ctrl+Shift+T'),
      keywords: ['appearance', 'light', 'dark', 'color'],
      // keepOpen: the glass re-themes live — let the user see it land.
      keepOpen: true,
      action: () => {
        const next = useThemeStore.getState().cycleTheme();
        ctx.toast(`Theme — ${next.replace('-', ' ')}`);
      },
    },
    {
      id: 'open-settings',
      group: 'commands',
      title: 'Open Settings',
      icon: Settings,
      shortcut: sc('⌘,', 'Ctrl+,'),
      keywords: ['preferences', 'config'],
      action: () => openRoute('/settings'),
    },
    {
      id: 'go-workspaces',
      group: 'commands',
      title: 'Go to Workspaces',
      icon: LayoutGrid,
      keywords: ['projects', 'folders', 'launch', 'pad'],
      action: () => openRoute('/workspaces'),
    },
    {
      id: 'new-workspace',
      group: 'commands',
      title: 'New Workspace',
      icon: Plus,
      shortcut: sc('⌘N', 'Ctrl+N'),
      keywords: ['project', 'folder', 'template', 'scaffold', 'clone'],
      action: () => {
        openRoute('/workspaces');
        if (!ctx.isHud) {
          // give the router a beat, then open the create modal
          setTimeout(() => useWorkspaceStore.getState().openModal(), 60);
        }
      },
    },
    {
      id: 'start-voice',
      group: 'commands',
      title: 'Start Voice Session',
      icon: Mic,
      shortcut: sc('⌘.', 'Ctrl+.'),
      keywords: ['talk', 'speak', 'listen'],
      action: () =>
        ctx.toast(
          'Voice ships in Phase 15',
          'The Voice Theater opens from this command.'
        ),
    },
    {
      id: 'show-budget',
      group: 'commands',
      title: 'Show Budget',
      icon: Wallet,
      keywords: ['spend', 'cost', 'limits'],
      action: () => openRoute('/budget'),
    },
    {
      id: 'pause-all-agents',
      group: 'commands',
      title: 'Pause All Agents',
      icon: OctagonX,
      keywords: ['stop', 'halt', 'freeze'],
      action: () =>
        ctx.toast(
          'Pause ships in Phase 13',
          'The spend governor will pause every agent run.'
        ),
    },
    // Control Room (Phase 11). URL intents are consumed by the screen, so
    // these work identically from the HUD and from inside the app.
    {
      id: 'runs-stop-all',
      group: 'commands',
      title: 'Control Room: Stop all runs',
      icon: OctagonX,
      shortcut: sc('⌘⇧.', 'Ctrl+Shift+.'),
      keywords: ['emergency', 'kill', 'halt', 'agents', 'runs', 'control room'],
      action: () => openRoute('/runs?action=stop-all'),
    },
    {
      id: 'runs-view-running',
      group: 'commands',
      title: 'Control Room: View running',
      icon: Activity,
      keywords: ['runs', 'live', 'in progress', 'agents', 'control room'],
      action: () => openRoute('/runs?status=running'),
    },
    {
      id: 'runs-view-failed',
      group: 'commands',
      title: 'Control Room: View failed runs',
      icon: XCircle,
      keywords: ['runs', 'errors', 'failures', 'control room'],
      action: () => openRoute('/runs?status=failed'),
    },
    // Shield (Phase 12). Same URL-intent pattern as the Control Room.
    {
      id: 'shield-open',
      group: 'commands',
      title: 'Shield: Open trust center',
      icon: ShieldCheck,
      keywords: ['shield', 'trust', 'security', 'audit', 'approvals', 'policy'],
      action: () => openRoute('/shield'),
    },
    {
      id: 'shield-health-check',
      group: 'commands',
      title: 'Shield: Run health check',
      icon: ShieldCheck,
      keywords: ['shield', 'health', 'check', 'integrity', 'verify'],
      action: () => openRoute('/shield?action=health-check'),
    },
    {
      id: 'shield-revoke-all',
      group: 'commands',
      title: 'Shield: Revoke all approvals and pause agents',
      icon: OctagonX,
      keywords: ['shield', 'emergency', 'revoke', 'pause', 'panic', 'stop'],
      action: () => openRoute('/shield?action=revoke'),
    },
    {
      id: 'clear-chat-history',
      group: 'commands',
      title: 'Clear Chat History',
      icon: Trash2,
      keywords: ['delete', 'wipe', 'remove', 'conversations'],
      action: () =>
        ctx.toast(
          'Clear history ships with Shield (Phase 12)',
          'Nothing is deleted behind your back.'
        ),
    },
  ];

  // Chats — the 6 most recent sessions (the store list is newest-first).
  const chatCommands: PaletteCommand[] = sessions
    .slice(0, 6)
    .map((session) => ({
      id: `chat:${session.id}`,
      group: 'chats' as const,
      title: session.title,
      subtitle: relativeTime(session.updatedAt),
      icon: MessageCircle,
      keywords: ['open', 'conversation', 'session'],
      action: () => openRoute(`/chat/${session.id}`),
    }));

  const agentCommands: PaletteCommand[] = AGENTS.map((agent) => ({
    id: `agent:${agent.name.toLowerCase()}`,
    group: 'agents' as const,
    title: agent.name,
    subtitle: agent.blurb,
    icon: agent.icon,
    keywords: ['chat', 'assistant', 'persona'],
    action: async () => {
      ctx.toast(
        `Agents ship in Phase 19`,
        `Opening a chat with ${agent.name} for now — its system prompt arrives with the real roster.`
      );
      await newChat();
    },
  }));

  const workspaceCommands: PaletteCommand[] = workspaces.map((ws) => ({
    id: `workspace:${ws.id}`,
    group: 'workspaces' as const,
    title: `Open ${ws.name}`,
    subtitle: ws.lastOpenedAt
      ? relativeTime(ws.lastOpenedAt)
      : WORKSPACE_KIND_META[ws.kind].label,
    icon: WORKSPACE_KIND_META[ws.kind].icon,
    keywords: ['workspace', 'project', ws.kind, ...ws.stack],
    action: () => openRoute(`/workspaces/${ws.id}`),
  }));

  const settingsCommands: PaletteCommand[] = [
    {
      id: 'settings-open',
      group: 'settings',
      title: 'Open Settings',
      icon: Settings,
      shortcut: sc('⌘,', 'Ctrl+,'),
      action: () => openRoute('/settings'),
    },
    {
      id: 'settings-profile',
      group: 'settings',
      title: 'Edit profile',
      subtitle: 'Name, avatar, launch behavior',
      icon: Settings,
      keywords: ['name', 'avatar', 'profile', 'account'],
      action: () => openRoute('/settings#general'),
    },
    {
      id: 'settings-appearance',
      group: 'settings',
      title: 'Appearance settings',
      subtitle: 'Theme, density, motion',
      icon: Palette,
      keywords: ['theme', 'dark', 'light', 'density', 'font'],
      action: () => openRoute('/settings#appearance'),
    },
    {
      id: 'settings-models',
      group: 'settings',
      title: 'Models & providers',
      subtitle: 'API keys, defaults, Ollama',
      icon: Settings,
      keywords: [
        'api',
        'key',
        'provider',
        'openai',
        'anthropic',
        'ollama',
        'model',
      ],
      action: () => openRoute('/settings#models'),
    },
    {
      id: 'settings-shortcuts',
      group: 'settings',
      title: 'Keyboard shortcuts',
      subtitle: 'Rebind every chord',
      icon: FileText,
      keywords: ['hotkey', 'bindings', 'keys', 'shortcut'],
      action: () => openRoute('/settings#shortcuts'),
    },
    {
      id: 'settings-notifications',
      group: 'settings',
      title: 'Notification settings',
      subtitle: 'Events, quiet hours',
      icon: Settings,
      keywords: ['notify', 'quiet hours', 'alerts'],
      action: () => openRoute('/settings#notifications'),
    },
    {
      id: 'settings-privacy',
      group: 'settings',
      title: 'Privacy & data settings',
      subtitle: 'Telemetry, PII, storage',
      icon: Settings,
      keywords: ['privacy', 'telemetry', 'delete', 'export', 'data'],
      action: () => openRoute('/settings#privacy'),
    },
    {
      id: 'settings-about',
      group: 'settings',
      title: 'About XR',
      icon: CircleDot,
      keywords: ['version', 'credits', 'licenses'],
      action: () => openRoute('/settings#about'),
    },
    {
      id: 'settings-updates',
      group: 'settings',
      title: 'Check for updates',
      icon: Clock,
      keywords: ['upgrade', 'release', 'update'],
      action: () => openRoute('/settings#updates'),
    },
  ];

  // Canned medium-risk request (dev only) — trigger twice to demo the queue.
  const triggerTestApproval = (): Promise<PendingDecision> =>
    requestApproval({
      id: newApprovalId(),
      createdAt: Date.now(),
      skillId: 'gmail-skill',
      skillName: 'gmail-skill',
      skillVersion: 'v1.2',
      skillIcon: 'mail',
      action: 'Send email',
      resource: 'sarah@company.com',
      subject: 'Portfolio update',
      bodyPreview:
        'Hi Sarah,' +
        '\n\n' +
        "Here's the portfolio update we discussed — the Q3 numbers are in, and the new deck is attached." +
        '\n\n' +
        'Best,' +
        '\n' +
        'XR (on behalf of Ahmad)',
      risk: 'medium',
      justification:
        'Triggered from the dev palette command to demo approvals.',
    });

  const devCommands: PaletteCommand[] = [
    {
      id: 'dev-reset-onboarding',
      group: 'settings',
      title: 'Reset onboarding (dev)',
      icon: Clock,
      shortcut: sc('⇧⌘R', 'Shift+Ctrl+R'),
      devOnly: true,
      action: () => {
        void clearOnboardingFlag().then(() => window.location.reload());
      },
    },
    {
      id: 'dev-brand-book',
      group: 'settings',
      title: 'Open Brand Book (dev)',
      subtitle: '/__brand',
      icon: Palette,
      devOnly: true,
      action: () => openRoute('/__brand'),
    },
    {
      id: 'dev-test-notification',
      group: 'settings',
      title: 'Test Notification (dev)',
      icon: MessageSquare,
      devOnly: true,
      action: () =>
        ctx.toast(
          'XR toast — this is a test',
          'Fired from the command palette (dev command).'
        ),
    },
    {
      id: 'dev-cycle-orb-states',
      group: 'settings',
      title: 'Cycle Orb States (dev)',
      subtitle: 'All 7 Companion Orb states, live',
      icon: Orbit,
      devOnly: true,
      keepOpen: true,
      action: () => {
        const raw = Number.parseInt(
          window.localStorage.getItem('xr.orb.devStateIndex') ?? '0',
          10
        );
        const index =
          ((Number.isFinite(raw) ? raw : 0) + 1) % AVATAR_STATES.length;
        const next = AVATAR_STATES[index] ?? 'idle';
        window.localStorage.setItem('xr.orb.devStateIndex', String(index));
        void orbSetState(next);
        ctx.toast(`Orb state — ${next}`);
      },
    },
    {
      id: 'dev-reset-approval-rules',
      title: 'Reset Approval Rules (dev)',
      subtitle: 'Clear remember rules + the notification feed',
      icon: OctagonX,
      group: 'settings',
      devOnly: true,
      action: () => {
        useApprovalStore.getState().setRules([]);
        useNotificationStore.getState().clear();
        try {
          window.localStorage.removeItem('xr.approval.rules');
        } catch {
          /* storage unavailable */
        }
        ctx.toast('Approval rules + notifications reset');
      },
    },
    {
      id: 'dev-trigger-approval',
      title: 'Trigger Test Approval (dev)',
      subtitle: 'Fire a canned permission request — no chat needed',
      icon: ShieldQuestion,
      group: 'settings',
      devOnly: true,
      action: () => {
        void triggerTestApproval().then((decision) => {
          ctx.toast(
            decision.status === 'approved'
              ? 'Test approval — approved'
              : 'Test approval — denied'
          );
        });
      },
    },
  ];

  // Dev commands are compiled into the registry only in dev builds, so the
  // '>' prefix is naturally empty in production.
  return [
    ...commands,
    ...chatCommands,
    ...agentCommands,
    ...workspaceCommands,
    ...settingsCommands,
    ...(import.meta.env.DEV ? devCommands : []),
  ];
}

/** Session ids for the "Recent" group — see paletteStore.history. */
export function recentCommands(
  commands: readonly PaletteCommand[],
  history: readonly string[]
): PaletteCommand[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  return history
    .map((id) => byId.get(id))
    .filter((c): c is PaletteCommand => !!c)
    .slice(0, 5);
}

// Dev-only window hook (never shipped in prod): fire the canned approval.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (
    window as unknown as {
      __xrTriggerTestApproval?: () => void;
    }
  ).__xrTriggerTestApproval = () => {
    // Re-created lazily: the canned request needs the live stores.
    void import('@/lib/approvalEvents').then(({ requestApproval }) => {
      void requestApproval({
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        skillId: 'gmail-skill',
        skillName: 'gmail-skill',
        skillVersion: 'v1.2',
        skillIcon: 'mail',
        action: 'Send email',
        resource: 'sarah@company.com',
        subject: 'Portfolio update',
        bodyPreview:
          'Hi Sarah,' +
          '\n\n' +
          "Here's the portfolio update we discussed — the Q3 numbers are in, and the new deck is attached." +
          '\n\n' +
          'Best,' +
          '\n' +
          'XR (on behalf of Ahmad)',
        risk: 'medium',
        justification: 'Triggered from the dev window hook to demo approvals.',
      });
    });
  };
}
