/*
 * Programmatic scrolling for the Research screen (2026-11-01).
 *
 * Every in-app jump — citation → source card, stage-rail Evidence button →
 * evidence matrix, outline → report section — goes through one motion-safe
 * helper instead of ad-hoc `scrollIntoView` calls with inconsistent
 * behaviour. The contract mirrors the source-card focus the owner approved:
 *
 *   1. The target is scrolled into view, centred when it fits.
 *   2. `prefers-reduced-motion` collapses the animation to an instant jump.
 *   3. The target flashes once so the landing point is obvious (same visual
 *      language as `.xr-card-flash`; suppressed for reduced motion).
 *
 * DOM-only side effects; no store state is touched from here.
 */

export interface ScrollFocusOptions {
  /** `center` like the source card; `start` for tall report sections. */
  block?: ScrollLogicalPosition;
  /** Flash the landing point (default true). */
  flash?: boolean;
}

const FLASH_MS = 700;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Query the element inside a scope so the jump cannot escape the screen. */
export function findByTestId(scope: ParentNode, testId: string): HTMLElement | null {
  return scope.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

/**
 * Scroll `el` into view, motion-safe, and flash it once. Safe to call from
 * effects and event handlers; re-callable (the flash restarts only if the
 * previous one finished).
 */
export function scrollFocus(
  el: HTMLElement | null,
  { block = 'center', flash = true }: ScrollFocusOptions = {}
): void {
  if (!el) return;
  const reduced = prefersReducedMotion();
  el.scrollIntoView({ block, behavior: reduced ? 'auto' : 'smooth' });
  if (!flash || reduced) return;
  const prev = el.dataset.xrScrollFlash;
  if (prev) window.clearTimeout(Number(prev));
  el.classList.remove('xr-scroll-flash');
  // Force a style flush so the animation can restart on rapid re-clicks.
  void el.offsetWidth;
  el.classList.add('xr-scroll-flash');
  const t = window.setTimeout(() => {
    el.classList.remove('xr-scroll-flash');
    delete el.dataset.xrScrollFlash;
  }, FLASH_MS);
  el.dataset.xrScrollFlash = String(t);
}
