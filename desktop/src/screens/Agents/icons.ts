/*
 * Icon maps for the Agents screen (Phase 19) — kept out of component files
 * so Fast Refresh keeps working. Deterministic per engine role / node kind.
 */
import {
  BadgeCheck,
  BarChart3,
  Bell,
  Bot,
  Briefcase,
  Clock,
  Container,
  Cpu,
  Database,
  Eye,
  FileOutput,
  GitFork,
  GitMerge,
  GraduationCap,
  Hammer,
  Headphones,
  Layers,
  ListTodo,
  LogIn,
  LogOut,
  Network,
  Palette,
  PenLine,
  Play,
  Radar,
  Route,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingUp,
  UserCheck,
  UserSearch,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { CanvasNodeKind } from '@/agents/api';
import type { AgentRole } from '@/agents/core';

const ROLE_ICON: Record<AgentRole, LucideIcon> = {
  supervisor: Network,
  planner: ListTodo,
  researcher: Search,
  builder: Hammer,
  reviewer: Eye,
  verifier: BadgeCheck,
  executor: Play,
  synthesizer: PenLine,
  memory_manager: Database,
  router: Route,
  model_selector: Cpu,
  security_checker: ShieldCheck,
  full_stack: Layers,
  frontend: Palette,
  backend: Server,
  devops: Container,
  mobile: Smartphone,
  data_ml: BarChart3,
  security_analyst: ShieldAlert,
  soc_threat_hunter: Radar,
  academic_research: GraduationCap,
  market_research: TrendingUp,
  business_sales: Briefcase,
  support_ops: Headphones,
};

export function roleIcon(role: string): LucideIcon {
  return (ROLE_ICON as Record<string, LucideIcon>)[role] ?? Bot;
}

export const KIND_ICON: Record<CanvasNodeKind, LucideIcon> = {
  input: LogIn,
  output: LogOut,
  branch: GitFork,
  join: GitMerge,
  wait: Clock,
  llm: Sparkles,
  subagent: Bot,
  tool: Wrench,
  notification: Bell,
  artifact: FileOutput,
  human_approval: UserCheck,
  human_review: UserSearch,
};

/** DataTransfer type used when dragging a palette stencil onto the canvas. */
export const DRAG_MIME = 'application/x-xr-node-kind';
