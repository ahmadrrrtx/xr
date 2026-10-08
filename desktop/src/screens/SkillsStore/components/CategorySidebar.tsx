/*
 * Category sidebar (Phase 20) — 200px, collapsible to an 80px icon rail.
 * Counts come from the current listing. "Custom MCP" opens the add form.
 */
import {
  Bot,
  Brain,
  Cloud,
  Code2,
  Database,
  FlaskConical,
  FolderOpen,
  Globe,
  LayoutGrid,
  MessageSquare,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  RefreshCw,
  ShieldCheck,
  Star,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';

import { CATEGORY_DEFS, type CategoryId } from '@/skills/core';

const ICON: Record<CategoryId, LucideIcon> = {
  featured: Star,
  installed: CheckCircle2,
  updates: RefreshCw,
  developer: Code2,
  productivity: LayoutGrid,
  research: FlaskConical,
  creative: Palette,
  browser: Globe,
  files: FolderOpen,
  communication: MessageSquare,
  operations: Cloud,
  data: Database,
  memory: Brain,
  agents: Bot,
  security: ShieldCheck,
  'custom-mcp': Plug,
};

const TONE: Record<CategoryId, string> = {
  featured: 'var(--warning)',
  installed: 'var(--accent)',
  updates: 'var(--warning)',
  developer: '#60A5FA',
  productivity: '#2DD4BF',
  research: '#34D399',
  creative: '#F472B6',
  browser: '#38BDF8',
  files: '#FBBF24',
  communication: '#A78BFA',
  operations: '#93C5FD',
  data: '#67E8F9',
  memory: '#F0ABFC',
  agents: '#818CF8',
  security: 'var(--danger)',
  'custom-mcp': 'var(--text-secondary)',
};

export function CategorySidebar({
  active,
  counts,
  collapsed,
  onSelect,
  onToggleCollapsed,
}: {
  active: CategoryId;
  counts: Record<CategoryId, number>;
  collapsed: boolean;
  onSelect: (id: CategoryId) => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <nav className="sk-sidebar" aria-label="Skill categories" data-collapsed={collapsed ? 'true' : 'false'} data-testid="skills-sidebar">
      {CATEGORY_DEFS.map((def, i) => {
        const Icon = ICON[def.id];
        const isActive = active === def.id;
        return (
          <div key={def.id}>
            {def.id === 'custom-mcp' ? <div className="sk-sidebar-rule" aria-hidden="true" /> : null}
            {i === 3 ? <div className="sk-sidebar-rule" aria-hidden="true" /> : null}
            <button
              type="button"
              className="sk-cat"
              aria-current={isActive ? 'true' : undefined}
              aria-label={collapsed ? `${def.label}${counts[def.id] !== undefined ? `, ${counts[def.id]}` : ''}` : undefined}
              title={collapsed ? def.label : undefined}
              onClick={() => onSelect(def.id)}
              data-testid={`cat-${def.id}`}
            >
              <span className="sk-cat-icon" style={{ color: TONE[def.id] }} aria-hidden="true">
                <Icon size={16} strokeWidth={1.5} />
              </span>
              <span className="sk-cat-label">{def.label}</span>
              {def.action ? null : <span className="sk-cat-count" aria-hidden="true">{counts[def.id] ?? 0}</span>}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="sk-btn sk-btn--ghost sk-rail-toggle"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand category sidebar' : 'Collapse category sidebar'}
        style={{ marginTop: 'auto' }}
      >
        {collapsed ? <PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden="true" /> : <PanelLeftClose size={16} strokeWidth={1.5} aria-hidden="true" />}
        {collapsed ? null : <span>Collapse</span>}
      </button>
    </nav>
  );
}
