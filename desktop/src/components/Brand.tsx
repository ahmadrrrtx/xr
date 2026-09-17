import logoUrl from "../assets/xr-logo.png";
import avatarUrl from "../assets/xr-avatar.png";

/**
 * OFFICIAL XR BRAND ASSETS — used EXACTLY as provided (decision D-05, amended 2026-09-17):
 * the official logo render and official avatar render are the single source of truth.
 * No derived/re-drawn geometry anywhere in the product; these images are placed as-is.
 *   · logo   (dark ground)  → titlebar, splash, hero, onboarding
 *   · avatar (light ground) → presence chips / message identity (circular portrait, like a profile photo)
 */
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

export function XrAvatar({ size = 28, ring = true }: { size?: number; ring?: boolean }) {
  return (
    <img
      src={avatarUrl}
      alt="XR"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        objectPosition: "50% 32%",
        border: ring ? "1px solid var(--xr-border-strong)" : "none",
        background: "#f7f9fa",
        display: "block",
        flex: "none",
        userSelect: "none",
      }}
      draggable={false}
    />
  );
}
