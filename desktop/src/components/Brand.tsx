import logoUrl from "../assets/xr-logo.png";
import avatarUrl from "../assets/xr-avatar.png";
import avatarSideUrl from "../assets/xr-avatar-side.webp";
import avatarSide2Url from "../assets/xr-avatar-side-2.webp";
import heroUrl from "../assets/xr-hero.webp";
import terminalSplashUrl from "../assets/xr-terminal-splash.png";
import readmeHeroUrl from "../assets/xr-readme-hero.png";
import type { VoiceState } from "../voice/session";

/**
 * OFFICIAL XR BRAND ASSETS — used EXACTLY as provided (decision D-05, amended
 * 2026-09-17; asset registry in src/assets/README.md, enforced by
 * scripts/desktop-brand-check.ts).
 *
 * The official renders are the single source of truth. No derived or re-drawn
 * geometry anywhere in the product: these images are placed as-is, and the
 * only permitted derivations are format/size conversions of the same pixels.
 *
 *   logo    (dark ground)   titlebar, boot splash, onboarding, hero
 *   avatar  front           presence / identity: chips, message author, idle
 *           side            "XR is working" — listening, thinking, planning
 *           side-alt        "XR is acting" — tool use, approval pending
 *
 * The pose map is a PRODUCT rule (09-DESIGN-RETHINK-v3 §Avatar poses): front
 * for presence and decisions the user makes, side profiles for states where
 * XR is busy on the user's behalf. Callers pass the pose; they never import
 * the files directly, so the registry stays the one place that knows them.
 */
export type AvatarPose = "front" | "side" | "side-alt";

export const AVATAR_SRC: Record<AvatarPose, string> = {
  front: avatarUrl,
  side: avatarSideUrl,
  "side-alt": avatarSide2Url,
};

/** The "superiority" hero render — cinema-zone surfaces only (onboarding
 *  Ready step, update complete). NEVER the first screen: first impressions
 *  stay calm (Phase 2 · F-2). */
export const HERO_SRC = heroUrl;

/** Official terminal splash render (mark + boot lines). The Workspace
 *  terminal shows it as its MOTD before the first command — a splash,
 *  exactly as the asset was made for. */
export const TERMINAL_SPLASH_SRC = terminalSplashUrl;

/** Official readme hero (winged avatar + lockup). About / identity surfaces. */
export const README_HERO_SRC = readmeHeroUrl;

/**
 * The ONE mapping from what XR is doing to how it faces the user. Both the
 * full Voice surface and the docked orb read it, so they can never disagree.
 */
export function poseForVoiceState(state: VoiceState): AvatarPose {
  if (state === "thinking" || state === "planning" || state === "working") return "side";
  if (state === "tool" || state === "approval") return "side-alt";
  return "front";
}

/** Object position that keeps the face in frame for a circular crop, per pose. */
const AVATAR_FOCUS: Record<AvatarPose, string> = {
  front: "50% 32%",
  side: "50% 40%",
  "side-alt": "50% 40%",
};

export function XrLogo({ height = 26, radius = 6, dim = false }: { height?: number; radius?: number; dim?: boolean }) {
  return (
    <img
      src={logoUrl}
      alt="XR — The AI Agent You Can Actually Trust"
      style={{ height, width: "auto", display: "block", borderRadius: radius, opacity: dim ? 0.75 : 1, userSelect: "none" }}
      draggable={false}
    />
  );
}

export function XrAvatar({
  size = 28,
  ring = true,
  pose = "front",
}: {
  size?: number;
  ring?: boolean;
  pose?: AvatarPose;
}) {
  return (
    <img
      src={AVATAR_SRC[pose]}
      alt="XR"
      data-pose={pose}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        objectPosition: AVATAR_FOCUS[pose],
        border: ring ? "1px solid var(--xr-border-strong)" : "none",
        background: pose === "front" ? "#f7f9fa" : "var(--xr-surface-sunken)",
        display: "block",
        flex: "none",
        userSelect: "none",
      }}
      draggable={false}
    />
  );
}
