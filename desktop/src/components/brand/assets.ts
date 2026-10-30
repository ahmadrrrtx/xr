/**
 * Brand asset URLs (Phase 31 · Bucket F v2).
 *
 * Every file here is a size-converted derivative of Ahmad's delivered
 * masters (assets/v2/ staging; scripts/fetch-v2-assets.sh) — curved silver
 * blades + tilted orbital ring + cyan core, front/side sentinel renders,
 * Orb v2 animation pack, and the 9 avatar state GIFs. No hand-drawn
 * geometry remains in the brand family (the old traced art.ts is retired).
 */
import type { AvatarState } from '@/components/brand/types';

/* Logo lockup (emblem + XR wordmark + tagline, transparent) */
export const XR_LOGO = new URL('../../assets/xr-logo.png', import.meta.url).href;
export const XR_LOGO_320 = new URL('../../assets/xr-logo-320.png', import.meta.url).href;
/* Emblem only (favicon-sized marks) */
export const XR_EMBLEM_512 = new URL('../../assets/xr-emblem-512.png', import.meta.url).href;
export const XR_EMBLEM_256 = new URL('../../assets/xr-emblem-256.png', import.meta.url).href;
/* Front sentinel bust — 2026-10-30: master swapped to the owner's newly
 * delivered avatar (1772380044.png, front-facing); derivatives reconverted
 * in-place so every surface that imports XR_AVATAR_* picked it up. */
export const XR_AVATAR_512 = new URL('../../assets/xr-avatar-512.webp', import.meta.url).href;
export const XR_AVATAR_256 = new URL('../../assets/xr-avatar-256.webp', import.meta.url).href;
export const XR_AVATAR_128 = new URL('../../assets/xr-avatar-128.webp', import.meta.url).href;
export const XR_AVATAR_PNG = new URL('../../assets/xr-avatar.png', import.meta.url).href;
/* Profile renders: side = working, side-2 = acting/tool/approval */
export const XR_AVATAR_SIDE = new URL('../../assets/xr-avatar-side.webp', import.meta.url).href;
export const XR_AVATAR_SIDE_2 = new URL('../../assets/xr-avatar-side-2.webp', import.meta.url).href;
/* Composed surfaces */
export const XR_HERO = new URL('../../assets/xr-hero.webp', import.meta.url).href;
export const XR_TERMINAL_SPLASH = new URL('../../assets/xr-terminal-splash.png', import.meta.url).href;
export const XR_README_HERO = new URL('../../assets/xr-readme-hero.png', import.meta.url).href;

export type OrbTheme = 'default' | 'nebula' | 'solar' | 'emerald' | 'crimson';

const ORB_WEBP: Record<AvatarState, string> = {
  idle: new URL('../../assets/orb/orb-idle.webp', import.meta.url).href,
  listening: new URL('../../assets/orb/orb-listening.webp', import.meta.url).href,
  thinking: new URL('../../assets/orb/orb-thinking.webp', import.meta.url).href,
  speaking: new URL('../../assets/orb/orb-speaking.webp', import.meta.url).href,
  'waiting-approval': new URL('../../assets/orb/orb-waiting-approval.webp', import.meta.url).href,
  approved: new URL('../../assets/orb/orb-approved.webp', import.meta.url).href,
  denied: new URL('../../assets/orb/orb-denied.webp', import.meta.url).href,
  error: new URL('../../assets/orb/orb-error.webp', import.meta.url).href,
  sleeping: new URL('../../assets/orb/orb-sleeping.webp', import.meta.url).href,
};

const ORB_POSTER: Record<AvatarState, string> = {
  idle: new URL('../../assets/orb/poster/orb-idle.png', import.meta.url).href,
  listening: new URL('../../assets/orb/poster/orb-listening.png', import.meta.url).href,
  thinking: new URL('../../assets/orb/poster/orb-thinking.png', import.meta.url).href,
  speaking: new URL('../../assets/orb/poster/orb-speaking.png', import.meta.url).href,
  'waiting-approval': new URL('../../assets/orb/poster/orb-waiting-approval.png', import.meta.url).href,
  approved: new URL('../../assets/orb/poster/orb-approved.png', import.meta.url).href,
  denied: new URL('../../assets/orb/poster/orb-denied.png', import.meta.url).href,
  error: new URL('../../assets/orb/poster/orb-error.png', import.meta.url).href,
  sleeping: new URL('../../assets/orb/poster/orb-sleeping.png', import.meta.url).href,
};

const ORB_THEME_WEBP: Record<Exclude<OrbTheme, 'default'>, string> = {
  nebula: new URL('../../assets/orb/themes/orb-idle-nebula.webp', import.meta.url).href,
  solar: new URL('../../assets/orb/themes/orb-idle-solar.webp', import.meta.url).href,
  emerald: new URL('../../assets/orb/themes/orb-idle-emerald.webp', import.meta.url).href,
  crimson: new URL('../../assets/orb/themes/orb-idle-crimson.webp', import.meta.url).href,
};

const ORB_THEME_POSTER: Record<Exclude<OrbTheme, 'default'>, string> = {
  nebula: new URL('../../assets/orb/themes/orb-idle-nebula.png', import.meta.url).href,
  solar: new URL('../../assets/orb/themes/orb-idle-solar.png', import.meta.url).href,
  emerald: new URL('../../assets/orb/themes/orb-idle-emerald.png', import.meta.url).href,
  crimson: new URL('../../assets/orb/themes/orb-idle-crimson.png', import.meta.url).href,
};

const AVATAR_GIF: Record<AvatarState, string> = {
  idle: new URL('../../assets/avatar-states/xr-avatar-idle.gif', import.meta.url).href,
  listening: new URL('../../assets/avatar-states/xr-avatar-listening.gif', import.meta.url).href,
  thinking: new URL('../../assets/avatar-states/xr-avatar-thinking.gif', import.meta.url).href,
  speaking: new URL('../../assets/avatar-states/xr-avatar-speaking.gif', import.meta.url).href,
  'waiting-approval': new URL('../../assets/avatar-states/xr-avatar-waiting-approval.gif', import.meta.url).href,
  approved: new URL('../../assets/avatar-states/xr-avatar-approved.gif', import.meta.url).href,
  denied: new URL('../../assets/avatar-states/xr-avatar-denied.gif', import.meta.url).href,
  error: new URL('../../assets/avatar-states/xr-avatar-error.gif', import.meta.url).href,
  sleeping: new URL('../../assets/avatar-states/xr-avatar-sleeping.gif', import.meta.url).href,
};

export function orbSrc(state: AvatarState, theme: OrbTheme = 'default'): string {
  if (state === 'idle' && theme !== 'default') return ORB_THEME_WEBP[theme];
  return ORB_WEBP[state];
}

export function orbPoster(state: AvatarState, theme: OrbTheme = 'default'): string {
  if (state === 'idle' && theme !== 'default') return ORB_THEME_POSTER[theme];
  return ORB_POSTER[state];
}

export function avatarGif(state: AvatarState): string {
  return AVATAR_GIF[state];
}
