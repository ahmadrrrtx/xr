/**
 * Shared brand-component types (docs/phases/02-brand-components.plan.md).
 */

/** The 7 canonical avatar states (docs/DESIGN-SYSTEM.md §6.2). */
export const AVATAR_STATES = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'waiting-approval',
  'error',
  'sleeping',
] as const;

export type AvatarState = (typeof AVATAR_STATES)[number];

/** Avatar pixel sizes (docs/DESIGN-SYSTEM.md §6.3). */
export const AVATAR_SIZES = {
  xs: 16,
  sm: 24,
  md: 40,
  lg: 80,
  xl: 200,
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

/**
 * head = square helmet crop · bust = full front figure · side/side2 = the
 * two traced profile references · orb = companion sphere widget.
 * (All figure variants are auto-vectorized from Ahmad's uploads — art.ts.)
 */
export type AvatarVariant = 'head' | 'bust' | 'orb' | 'side' | 'side2';

export type LogoVariant = 'icon' | 'full' | 'large';
