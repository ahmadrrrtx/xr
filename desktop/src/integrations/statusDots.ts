/*
 * Status dots (Phase 26).
 *
 * One vocabulary for every chat surface card, so the same three colors mean the
 * same three things wherever they appear:
 *
 *   green   answering — the surface is connected and will reply
 *   yellow  configured but not answering — stopped, reconnecting, or waiting
 *   red     needs attention — no credentials, an error, or a dead link
 *
 * The dot never encodes anything the title does not also say in words: the
 * label is part of the component, because a color alone is not an explanation.
 */
export type DotState = 'green' | 'yellow' | 'red';

export const DOT_LABEL: Record<DotState, string> = {
  green: 'Answering',
  yellow: 'Configured, not answering',
  red: 'Needs attention',
};

/**
 * Telegram label → dot. Telegram reports a human label rather than a status
 * enum, so the mapping lives here beside the others instead of in the card.
 */
export function telegramDot(label: string | null | undefined): DotState {
  if (!label) return 'red';
  if (label === 'Running' || label === 'Connected') return 'green';
  if (label === 'Error') return 'red';
  return 'yellow';
}
