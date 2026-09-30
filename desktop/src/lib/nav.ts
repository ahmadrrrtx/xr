/*
 * Canonical navigation map — the 14 primary screens in fixed order
 * (docs/SCREEN-BRIEFS.md · GLOBAL APPLICATION SHELL).
 * Icons: Lucide @ 1.5px stroke. Order is part of the product spec.
 */
import {
  Brain,
  Clock,
  Database,
  Folder,
  Hammer,
  MessageCircle,
  Mic,
  Plug,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Phase (docs/IMPLEMENTATION-PLAN.md) in which this screen ships. */
  phase: number;
  description: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'chat',
    label: 'Chat',
    path: '/chat',
    icon: MessageCircle,
    phase: 4,
    description: 'Conversations with XR — the core experience.',
  },
  {
    id: 'brain',
    label: 'Brain',
    path: '/brain',
    icon: Brain,
    phase: 9,
    description: 'Live agent run trace — the proof-of-trust view.',
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    path: '/workspaces',
    icon: Folder,
    phase: 10,
    description: 'Projects, files and workspace switching.',
  },
  {
    id: 'builder',
    label: 'Builder',
    path: '/builder',
    icon: Hammer,
    phase: 17,
    description: 'Three-pane build environment for code work.',
  },
  {
    id: 'research',
    label: 'Research',
    path: '/research',
    icon: Search,
    phase: 18,
    description: 'Deep research reports with citations.',
  },
  {
    id: 'agents',
    label: 'Agents',
    path: '/agents',
    icon: Rocket,
    phase: 19,
    description: 'Prebuilt, custom agents and workflows.',
  },
  {
    id: 'skills',
    label: 'Skills Store',
    path: '/skills',
    icon: ShoppingBag,
    phase: 20,
    description: 'Installable skills with quarantine review.',
  },
  {
    id: 'shield',
    label: 'Shield',
    path: '/shield',
    icon: ShieldCheck,
    phase: 12,
    description: 'Trust center — approvals, audit chain, permissions.',
  },
  {
    id: 'runs',
    label: 'Runs',
    path: '/runs',
    icon: Clock,
    phase: 11,
    description: 'Control room for every agent run.',
  },
  {
    id: 'memory',
    label: 'Memory',
    path: '/memory',
    icon: Database,
    phase: 21,
    description: 'Explore what XR remembers and forgets.',
  },
  {
    id: 'budget',
    label: 'Budget',
    path: '/budget',
    icon: Wallet,
    phase: 13,
    description: 'Spend governor, limits and cost breakdowns.',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    path: '/integrations',
    icon: Plug,
    phase: 22,
    description: 'OAuth-connected apps and services.',
  },
  {
    id: 'voice',
    label: 'Voice',
    path: '/voice',
    icon: Mic,
    phase: 15,
    description: 'Voice setup, STT/TTS and the Theater.',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: Settings,
    phase: 8,
    description: 'Appearance, models, security and preferences.',
  },
] as const;
