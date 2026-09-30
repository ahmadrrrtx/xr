import { useEffect, useState } from 'react';

import { Avatar } from '@/components/brand/Avatar';
import { useOnboardingStore } from '@/stores/onboarding';
import { Reveal } from './parts';

/**
 * Step 10 — all set. Avatar idles then pulses a greeting; exact copy:
 * "Hey {name}. I'm XR." / "Ready when you are." → Start chatting → /chat.
 */
export function StepAllSet({ onStart }: { onStart: () => void }) {
  const userName = useOnboardingStore((s) => s.userName);
  const [greeting, setGreeting] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setGreeting(true), 900);
    return () => window.clearTimeout(t);
  }, []);

  const name = userName.trim();

  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Reveal>
        <Avatar size="lg" state={greeting ? 'speaking' : 'idle'} />
      </Reveal>
      <Reveal delay={0.7}>
        <h2 className="text-text-primary mt-6 text-[24px] font-semibold tracking-[-0.01em]">
          Hey{name ? ` ${name}` : ''}. I'm XR.
        </h2>
      </Reveal>
      <Reveal delay={0.9}>
        <p className="text-text-tertiary mt-1.5 text-[14px]">Ready when you are.</p>
      </Reveal>
      <Reveal delay={1.05}>
        <button
          type="button"
          onClick={onStart}
          className="bg-accent text-accent-contrast hover:bg-accent-hover mt-8 rounded-lg px-6 py-2.5 text-[14px] font-semibold transition-colors"
        >
          Start chatting
        </button>
      </Reveal>
      <Reveal delay={1.15}>
        <p className="text-text-tertiary/70 mt-4 font-mono text-[10.5px]">
          press Enter
        </p>
      </Reveal>
    </div>
  );
}
