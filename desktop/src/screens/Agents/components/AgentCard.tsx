/*
 * Agent card (Phase 19) — one tile in the Prebuilt / My Agents grids.
 * 56 px role-coloured icon (custom agents show their emoji), favourite
 * star, name, two-line description, mono facts, hover "Start chat →" and a
 * ⋮ menu. Family colour and icon are deterministic from the engine role.
 */
import { MoreHorizontal, Star } from 'lucide-react';
import { createElement, type ReactNode } from 'react';

import { chipLine, familyLabel, familyOf, type AgentSummary } from '@/agents/core';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { roleIcon } from '../icons';

export interface AgentMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

export function AgentCard({
  agent,
  index,
  favorite,
  onToggleFavorite,
  onStartChat,
  menu,
  footer,
}: {
  agent: AgentSummary;
  index: number;
  favorite: boolean;
  onToggleFavorite: () => void;
  onStartChat: () => void;
  menu: AgentMenuItem[];
  footer?: ReactNode;
}) {
  const family = familyOf(agent.role);
  const chips = chipLine(agent);
  const disabled = agent.builtin && !agent.enabledByDefault;
  return (
    <article
      className={`xa-card${disabled ? ' xa-card--disabled' : ''}`}
      style={{ ['--i' as string]: index, ['--xa-color' as string]: `var(--xa-${family})` }}
      data-testid={`agent-card-${agent.id}`}
      data-family={family}
      aria-label={`${agent.label}, ${familyLabel(family)}`}
    >
      <div className="xa-card-top">
        <div className="xa-avatar" aria-hidden="true">
          {agent.custom?.emoji ? <span>{agent.custom.emoji}</span> : createElement(roleIcon(agent.role), { size: 26, strokeWidth: 1.5 })}
        </div>
        <button
          type="button"
          className="xa-star"
          aria-pressed={favorite}
          aria-label={favorite ? `Remove ${agent.label} from favourites` : `Add ${agent.label} to favourites`}
          onClick={onToggleFavorite}
          data-testid={`agent-star-${agent.id}`}
        >
          <Star size={15} strokeWidth={1.75} aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="min-w-0">
        <div className="xa-row" style={{ gap: 6 }}>
          <h3 className="xa-card-name" title={agent.label}>
            {agent.label}
          </h3>
          {!agent.builtin ? <span className="xa-pill xa-pill--custom">custom · v{agent.version}</span> : disabled ? <span className="xa-pill">off by default</span> : null}
        </div>
        <p className="xa-card-desc" title={agent.description}>
          {agent.description}
        </p>
      </div>
      <div className="xa-card-chips" aria-label="Facts">
        {chips.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="xa-card-foot">
        {footer ?? (
          <button type="button" className="xa-card-cta" onClick={onStartChat} data-testid={`agent-chat-${agent.id}`}>
            Start chat →
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="xa-more" aria-label={`More actions for ${agent.label}`} data-testid={`agent-more-${agent.id}`}>
              <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            {menu.map((m) => (
              <div key={m.id}>
                {m.separatorBefore ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onSelect={m.onSelect} className={m.danger ? 'text-danger focus:text-danger' : undefined} data-testid={`agent-menu-${m.id}`}>
                  {m.label}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
