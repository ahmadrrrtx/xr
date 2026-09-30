/*
 * Stick-to-bottom scroll logic (Phase 4) — the chat auto-scroll pattern:
 *
 * - "near bottom" = scrollHeight − scrollTop − clientHeight < THRESHOLD (120px)
 * - while near-bottom, every content change pins to bottom INSTANTLY
 *   (smooth per-token scrolling janks; research §5)
 * - when the user scrolls away, auto-scroll stops and new-message arrivals
 *   increment a counter for the "N new" badge
 * - returning to the bottom re-enables follow and clears the badge
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const NEAR_BOTTOM_PX = 120;

export function useStickToBottom(dep: unknown) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stuckRef = useRef(true);
  const newCountRef = useRef(0);
  const wasStreaming = useRef(false);
  // State mirrors so consumers can read values during render (rule: no ref
  // access in render). Mutations happen in handlers/effects only.
  const [isStuck, setIsStuck] = useState(true);
  const [newCount, setNewCount] = useState(0);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  const onScroll = useCallback(() => {
    const near = measure();
    if (near && !stuckRef.current) {
      stuckRef.current = true;
      newCountRef.current = 0;
      setIsStuck(true);
      setNewCount(0);
    } else if (!near && stuckRef.current) {
      stuckRef.current = false;
      setIsStuck(false);
    }
  }, [measure]);

  /** Force follow-mode on (e.g. the user just sent a message). */
  const forceStick = useCallback(() => {
    stuckRef.current = true;
    newCountRef.current = 0;
    setIsStuck(true);
    setNewCount(0);
  }, []);

  // Follow content changes while stuck. `dep` is a stable key (string) so the
  // effect only fires when the conversation actually grew/changed.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const streaming = typeof dep === 'string' && dep.endsWith('|streaming');

    if (stuckRef.current) {
      el.scrollTop = el.scrollHeight; // instant — no smooth per token
      wasStreaming.current = streaming;
      return;
    }
    // A completed message while detached counts as "new".
    if (wasStreaming.current && !streaming) {
      newCountRef.current += 1;
      setNewCount(newCountRef.current);
    }
    wasStreaming.current = streaming;
  }, [dep]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'smooth'
        : 'auto',
    });
    stuckRef.current = true;
    newCountRef.current = 0;
    setIsStuck(true);
    setNewCount(0);
  }, []);

  return { containerRef, onScroll, scrollToBottom, forceStick, isStuck, newCount };
}
