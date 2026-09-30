import { useEffect, useState } from 'react';

import { type Platform, resolvePlatform } from '@/lib/tauri';

/**
 * Resolves the host platform ('macos' | 'windows' | 'linux' | …).
 * Starts from the synchronous userAgent guess, then refines via
 * `@tauri-apps/plugin-os` when running inside Tauri.
 */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>(() =>
    resolvePlatformSync()
  );

  useEffect(() => {
    let alive = true;
    void resolvePlatform().then((p) => {
      if (alive) setPlatform(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  return platform;
}

function resolvePlatformSync(): Platform {
  // Local re-implementation to avoid importing the async module at top level.
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'web';
}
