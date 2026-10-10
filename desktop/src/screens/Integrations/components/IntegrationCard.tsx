/*
 * One integration card. The footer shows what the engine reported (via core.ts).
 * Clicking the body opens the settings popover for a connected card. Connect
 * does nothing on a card that is not connected: the button is the action.
 */
import type { KeyboardEvent } from 'react';
import { Check, Loader2, Lock, Settings, TriangleAlert, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { IntegrationView } from '@/integrations/api';
import {
  AUTH_LABEL,
  brandFor,
  deriveCardState,
  type CardState,
} from '@/integrations/core';
import { useIntegrationsStore } from '@/stores/integrationsStore';
import { SettingsPanel } from './SettingsPanel';

interface Props {
  view: IntegrationView;
  index: number;
  error?: string;
  busy: boolean;
}

const MAX_CHIPS = 3;

export function IntegrationCard({ view, index, error, busy }: Props) {
  const connecting = useIntegrationsStore((s) => s.connectingId === view.id);
  const popoverId = useIntegrationsStore((s) => s.popoverId);
  const openPopover = useIntegrationsStore((s) => s.openPopover);
  const connect = useIntegrationsStore((s) => s.connect);
  const openDialog = useIntegrationsStore((s) => s.openDialog);
  const brand = brandFor(view.id, view.name);
  // Telegram has its own setup and settings (token → pairing). The generic
  // connect path is refused by the engine for this connector.
  const isTelegram = view.id === 'telegram';
  const startConnect = () => (isTelegram ? openDialog({ kind: 'telegram', id: view.id }) : void connect(view.id));
  const state: CardState = deriveCardState(view, connecting);
  const open = popoverId === view.id;
  const chips = view.capabilities.slice(0, MAX_CHIPS);
  const extra = view.capabilities.length - chips.length;
  const titleId = `integration-${view.id}-title`;
  const stagger = { animationDelay: `${Math.min(index, 30) * 40}ms` };

  const onCardKey = (e: KeyboardEvent<HTMLElement>) => {
    // C connects the focused card, as the screen brief asks. Only when the card itself is focused.
    if (e.target === e.currentTarget && (e.key === 'c' || e.key === 'C') && (state === 'connect' || state === 'setup_required')) {
      e.preventDefault();
      startConnect();
    }
  };

  return (
    <article
      aria-labelledby={titleId}
      aria-busy={busy || connecting || undefined}
      tabIndex={0}
      data-state={state}
      data-testid={`integration-card-${view.id}`}
      className={`ix-card ix-card--${state}`}
      style={stagger}
      onKeyDown={onCardKey}
      onClick={(e) => {
        // Body click opens settings for connected cards only. Footer buttons stop propagation.
        if (state === 'connected' && (e.target as HTMLElement).closest('[data-card-body]')) openPopover(view.id);
      }}
    >
      <Popover open={open && state === 'connected'} onOpenChange={(o) => openPopover(o ? view.id : null)}>
        <PopoverAnchor asChild>
          <div className="ix-card__body" data-card-body>
            <div className="ix-card__top">
              <div className="ix-tile" style={{ background: brand.color }} aria-hidden="true">
                {brand.monogram}
              </div>
              <span className="ix-auth-chip">{AUTH_LABEL[view.authType]}</span>
            </div>
            <h3 id={titleId} className="ix-card__name">{view.name}</h3>
            <p className="ix-card__desc">{view.description}</p>
            {chips.length > 0 && (
              <ul className="ix-chips" aria-label="Capabilities">
                {chips.map((c) => (
                  <li key={c} className="ix-chip">{c.replace(/_/g, ' ')}</li>
                ))}
                {extra > 0 && <li className="ix-chip ix-chip--muted">+{extra}</li>}
              </ul>
            )}
          </div>
        </PopoverAnchor>

        <div className="ix-card__footer">
          <CardFooter state={state} view={view} busy={busy} connecting={connecting} onConnect={startConnect} onReauth={startConnect} onSetup={() => openDialog({ kind: 'app_credentials', id: view.id })} onSettings={() => (isTelegram ? openDialog({ kind: 'telegram_settings', id: view.id }) : openPopover(view.id))} />
        </div>

        {error && (
          <p role="alert" className="ix-card__error">{error}</p>
        )}

        {state === 'connected' && (
          <PopoverContent align="start" side="bottom" className="ix-popover" sideOffset={8}>
            <SettingsPanel view={view} />
          </PopoverContent>
        )}
      </Popover>
    </article>
  );
}

function CardFooter(props: {
  state: CardState;
  view: IntegrationView;
  busy: boolean;
  connecting: boolean;
  onConnect(): void;
  onReauth(): void;
  onSetup(): void;
  onSettings(): void;
}) {
  const { state, view, busy, connecting } = props;

  if (state === 'coming_soon') {
    return (
      <div className="ix-footer-row">
        <span className="ix-chip ix-chip--lock" title="Not available in this build yet. Nothing is stored for this connector.">
          <Lock size={12} aria-hidden="true" /> Coming soon
        </span>
      </div>
    );
  }

  if (state === 'setup_required') {
    return (
      <div className="ix-footer-row">
        <Button variant="outline" size="sm" onClick={props.onSetup} aria-label={`Set up ${view.name}: add OAuth app credentials`}>
          Setup required
        </Button>
        <span className="ix-footer-hint">Add your own OAuth app first</span>
      </div>
    );
  }

  if (state === 'connecting') {
    return (
      <div className="ix-footer-row" role="status">
        <span className="ix-chip ix-chip--pending">
          <Loader2 size={12} className="ix-spin" aria-hidden="true" /> Waiting for browser…
        </span>
      </div>
    );
  }

  if (state === 'reauth') {
    return (
      <div className="ix-footer-row">
        <button type="button" className="ix-chip ix-chip--warn" onClick={props.onReauth} aria-label={`Re-auth ${view.name}`}>
          <span className="ix-dot ix-dot--pulse" aria-hidden="true" />
          <TriangleAlert size={12} aria-hidden="true" /> Re-auth needed
        </button>
        <Button variant="ghost" size="sm" onClick={props.onSettings} aria-label={`Settings for ${view.name}`}>
          <Settings size={14} aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (state === 'connected') {
    return (
      <div className="ix-footer-row">
        <span className="ix-chip ix-chip--connected">
          <Check size={12} aria-hidden="true" /> Connected
        </span>
        <Button variant="ghost" size="sm" onClick={props.onSettings} aria-label={`Settings for ${view.name}`}>
          <Settings size={14} aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="sm" className="ix-disconnect-hint" onClick={props.onSettings} aria-label={`Disconnect ${view.name} (opens settings)`}>
          <Unplug size={14} aria-hidden="true" /> Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="ix-footer-row">
      <Button variant="outline" size="sm" className="ix-connect" onClick={props.onConnect} disabled={busy || connecting} aria-label={`Connect ${view.name}`}>
        Connect
      </Button>
    </div>
  );
}
