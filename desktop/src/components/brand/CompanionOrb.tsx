/**
 * CompanionOrb — the desktop-widget orb (Phase 31 · Bucket F v2).
 *
 * Now a thin wrapper over VoiceOrb: the delivered Orb v2 animation pack
 * (glass nebula sphere · dual electron rings · layered core) replaces the
 * old CSS/SVG-drawn sphere. Props are unchanged ({size, state, className})
 * so every existing caller — companion widget window, chat, palette —
 * gets the new orb without edits. Poster stills render at ≤64px and
 * under prefers-reduced-motion (see VoiceOrb).
 */
import { VoiceOrb, type OrbTheme } from '@/components/brand/VoiceOrb';
import type { AvatarState } from '@/components/brand/types';

export function CompanionOrb({
  size = 80,
  state = 'idle',
  theme = 'default',
  className,
}: {
  /** Orb diameter in px. */
  size?: number;
  state?: AvatarState;
  theme?: OrbTheme;
  className?: string;
}) {
  return <VoiceOrb size={size} state={state} theme={theme} className={className} decorative />;
}

CompanionOrb.displayName = 'CompanionOrb';
