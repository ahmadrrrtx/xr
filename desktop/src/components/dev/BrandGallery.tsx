/**
 * BrandGallery — dev-only QA page for the Phase-2 brand components.
 * Mounted at `#__brand` ONLY in dev builds (`import.meta.env.DEV` guard in
 * router.tsx) — never ships in production.
 *
 * Shows every avatar state × size, all logo variants, and the companion orb
 * with a live state switcher. Theme-adaptation QA: cycle themes with the
 * ⌘K palette ("Cycle theme") or Ctrl+Shift+L.
 */
import { useState } from 'react';

import { Avatar } from '@/components/brand/Avatar';
import { CompanionOrb } from '@/components/brand/CompanionOrb';
import { Logo } from '@/components/brand/Logo';
import {
  AVATAR_SIZES,
  AVATAR_STATES,
  type AvatarState,
} from '@/components/brand/types';

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border-subtle border-t pt-8">
      <h2 className="text-text-primary text-lg font-semibold">{title}</h2>
      {hint && <p className="text-text-tertiary mt-1 text-xs">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function BrandGallery() {
  const [orbState, setOrbState] = useState<AvatarState>('idle');

  return (
    <div className="bg-bg-void text-text-primary min-h-screen">
      <div className="mx-auto max-w-5xl px-8 py-12">
        <header className="flex items-center gap-6">
          <Logo variant="large" size={140} decorative={false} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Brand Gallery
            </h1>
            <p className="text-text-secondary mt-1 max-w-md text-sm">
              Phase-2 shared brand components — every avatar state × size, logo
              variants, and the companion orb. Cycle themes (⌘K → “Cycle
              theme”) to verify adaptation; Paper/Arctic disable the glow.
            </p>
            <p className="text-text-tertiary mt-2 font-mono text-[11px]">
              Dev-only route — /#/__brand — stripped from production builds.
            </p>
          </div>
        </header>

        <div className="mt-10 flex flex-col gap-10">
          <Section
            title="Logo"
            hint="icon (rail · 28px) · full (wordmark) · large (splash · animated)"
          >
            <div className="flex flex-wrap items-end gap-12">
              <div className="flex flex-col items-center gap-3">
                <Logo variant="icon" size={32} decorative={false} />
                <span className="text-text-tertiary font-mono text-[10px]">
                  icon · 32
                </span>
              </div>
              <div className="flex flex-col items-center gap-3">
                <Logo variant="full" decorative={false} />
                <span className="text-text-tertiary font-mono text-[10px]">
                  full · 22
                </span>
              </div>
              <div className="flex flex-col items-center gap-3">
                <Logo variant="large" size={170} decorative={false} />
                <span className="text-text-tertiary font-mono text-[10px]">
                  large · 170
                </span>
              </div>
            </div>
          </Section>

          <Section
            title="Avatar — states × sizes"
            hint="Vectorized from the original upload. xs/sm render the head crop; md+ default to the full figure. error flashes red 2s then settles."
          >
            <div className="flex flex-col gap-6 overflow-x-auto pb-2">
              {AVATAR_STATES.map((state) => (
                <div
                  key={state}
                  className="flex items-center gap-8"
                  data-state={state}
                >
                  <span className="text-text-tertiary w-32 shrink-0 font-mono text-[11px]">
                    {state}
                  </span>
                  {(Object.keys(AVATAR_SIZES) as Array<keyof typeof AVATAR_SIZES>).map(
                    (size) => (
                      <div
                        key={`${state}-${size}`}
                        className="flex flex-col items-center gap-2"
                      >
                        <Avatar state={state} size={size} />
                        <span className="text-text-tertiary font-mono text-[10px]">
                          {size}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              ))}
              <div className="flex items-center gap-8">
                <span className="text-text-tertiary w-32 shrink-0 font-mono text-[11px]">
                  head variant
                </span>
                {(['sm', 'md', 'lg'] as const).map((size) => (
                  <div
                    key={`head-${size}`}
                    className="flex flex-col items-center gap-2"
                  >
                    <Avatar state="idle" size={size} variant="head" />
                    <span className="text-text-tertiary font-mono text-[10px]">
                      {size}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-8">
                <span className="text-text-tertiary w-32 shrink-0 font-mono text-[11px]">
                  side profiles
                </span>
                {(['side', 'side2'] as const).map((v) => (
                  <div
                    key={`side-${v}`}
                    className="flex flex-col items-center gap-2"
                  >
                    <Avatar state="idle" size="lg" variant={v} />
                    <span className="text-text-tertiary font-mono text-[10px]">
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section
            title="Companion Orb"
            hint="sphere + tilted ring (12s) + halo + voice rings. Click a state to preview."
          >
            <div className="flex flex-wrap items-center gap-10">
              <CompanionOrb size={180} state={orbState} />
              <div className="flex max-w-md flex-wrap gap-2">
                {AVATAR_STATES.map((state) => (
                  <button
                    key={state}
                    type="button"
                    onClick={() => setOrbState(state)}
                    aria-pressed={orbState === state}
                    className={
                      'rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors ' +
                      (orbState === state
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border-subtle text-text-secondary hover:bg-bg-raised')
                    }
                  >
                    {state}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-8">
              {AVATAR_STATES.map((state) => (
                <div
                  key={`orb-${state}`}
                  className="flex flex-col items-center gap-2"
                >
                  <CompanionOrb size={64} state={state} />
                  <span className="text-text-tertiary font-mono text-[10px]">
                    {state}
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Notes"
            hint="Reduced-motion (OS setting) renders static frames. Drag/window behavior is Phase 6."
          >
            <ul className="text-text-secondary list-disc pl-5 text-sm">
              <li>
                All figure/logo geometry is auto-vectorized from the original
                uploads (k-means palette + per-color traces) — no hand-drawn
                shapes, no images.
              </li>
              <li>States animate only the cyan energy layers; the art itself never changes.</li>
              <li>
                No hex outside themes.css; glow strength comes from
                <code className="text-accent font-mono text-xs">
                  {' '}
                  --avatar-glow-strength
                </code>
                .
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
