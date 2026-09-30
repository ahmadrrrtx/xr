import { Logo } from '@/components/brand/Logo';
import { Reveal } from './parts';

/** Step 1 — welcome (not skippable). */
export function StepWelcome() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Reveal>
        <Logo variant="large" size={110} />
      </Reveal>
      <Reveal delay={0.08}>
        <h1 className="text-text-primary mt-8 text-[26px] font-semibold tracking-[-0.01em]">
          Welcome to XR.
        </h1>
      </Reveal>
      <Reveal delay={0.16}>
        <p className="text-text-tertiary mt-2 max-w-[44ch] text-[14px] leading-relaxed">
          Your private AI companion — local-first, voice-native, yours.
          Takes about two minutes to set up.
        </p>
      </Reveal>
    </div>
  );
}
