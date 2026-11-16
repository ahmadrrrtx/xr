/** One media owner per component. Abort is advisory; current() also rejects
 * late permission/network responses and callbacks that ignore cancellation. */
import { useCallback, useEffect, useRef } from 'react';

export function useMediaOperation(cleanup: () => void) {
  const mounted = useRef(false);
  const active = useRef<AbortController | null>(null);
  const release = useRef(cleanup);
  release.current = cleanup;
  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    release.current();
  }, []);
  useEffect(() => {
    mounted.current = true; // React StrictMode may replay effect setup.
    return () => { mounted.current = false; cancel(); };
  }, [cancel]);
  const begin = useCallback(() => {
    cancel();
    const controller = new AbortController();
    active.current = controller;
    return { signal: controller.signal,
      current: () => mounted.current && active.current === controller && !controller.signal.aborted };
  }, [cancel]);
  return { begin, cancel };
}
