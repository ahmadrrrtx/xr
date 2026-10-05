/*
 * Onboarding wizard (Phase 3 · docs/SCREEN-BRIEFS.md OV-8).
 *
 * 10 steps · 720×620 modal · always XR-Native (cinematic exception). Slides
 * are direction-aware (Framer `AnimatePresence custom={direction}`); the
 * progress bar spans (step-1)/9. Keyboard: Enter → continue, Alt+←/Backspace
 * → back (ignored while typing), triple-Esc → dev reset. Steps 1–3 are not
 * skippable; 4–9 may skip; 10 always ends the flow.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { orbShow } from '@/lib/orb';

import { clearOnboardingFlag, useOnboardingStore } from '@/stores/onboarding';

import { StepAllSet } from './StepAllSet';
import { StepDownload } from './StepDownload';
import { StepIntegrations } from './StepIntegrations';
import { StepMicSetup } from './StepMicSetup';
import { StepModelSetup } from './StepModelSetup';
import { StepPrefs } from './StepPrefs';
import { StepPromise } from './StepPromise';
import { StepSystemCheck } from './StepSystemCheck';
import { StepVoice } from './StepVoice';
import { StepWelcome } from './StepWelcome';

/** Steps that may be skipped via the Skip button (brief: 4–9). */
const SKIPPABLE = new Set([4, 5, 6, 7, 8, 9]);

const STEP_TITLES: Record<number, string> = {
  1: 'Welcome',
  2: 'The XR promise',
  3: 'System check',
  4: 'Model setup',
  5: 'Downloading model',
  6: 'Microphone',
  7: 'Voice',
  8: 'Preferences',
  9: 'Integrations',
  10: 'All set',
};

export function OnboardingWizard() {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const { step, direction, nextStep, prevStep, goToStep } = useOnboardingStore();
  const [understood, setUnderstood] = useState(false);
  const escTimes = useRef<number[]>([]);

  /** Per-step continue-gating + completion. */
  const canContinue = useMemo(() => {
    if (step === 2) return understood; // checkbox gates the promise step
    return true;
  }, [step, understood]);

  const finish = useCallback(async (to: string = '/chat') => {
    await useOnboardingStore.getState().finishOnboarding();
    // The orb joins the desktop the moment onboarding completes (Phase 6).
    void orbShow();
    navigate(to, { replace: true });
    const name = useOnboardingStore.getState().userName;
    toast(`Welcome${name ? `, ${name}` : ''}. XR is ready.`);
  }, [navigate]);

  const onContinue = useCallback(() => {
    if (step < 10) {
      nextStep();
    } else {
      void finish();
    }
  }, [step, nextStep, finish]);

  /** Triple-Esc dev reset — confirm, then clear the flag and reload. */
  const devReset = useCallback(() => {
    if (!import.meta.env.DEV) return;
    const ok = window.confirm('Reset onboarding? (dev only)');
    if (!ok) return;
    void clearOnboardingFlag().then(() => window.location.reload());
  }, []);

  /** Keyboard: Enter continue · Alt+←/Backspace back · triple-Esc dev reset. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Only TEXT entry swallows Enter — checkboxes/radios/buttons/sliders
      // and selects should still advance the wizard.
      const textEntry =
        el instanceof HTMLTextAreaElement ||
        el?.isContentEditable === true ||
        (el instanceof HTMLInputElement &&
          !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type));

      if (e.key === 'Escape') {
        const now = Date.now();
        escTimes.current = [...escTimes.current.filter((t) => now - t < 700), now];
        if (escTimes.current.length >= 3) {
          escTimes.current = [];
          devReset();
        }
        return;
      }
      if (e.key === 'Enter' && !textEntry) {
        e.preventDefault();
        if (canContinue) onContinue();
        return;
      }
      if ((e.altKey && e.key === 'ArrowLeft') || (e.key === 'Backspace' && !textEntry)) {
        e.preventDefault();
        if (step > 1) prevStep();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canContinue, onContinue, prevStep, step, devReset]);

  const slides: Record<number, ReactNode> = {
    1: <StepWelcome />,
    2: <StepPromise understood={understood} setUnderstood={setUnderstood} />,
    3: <StepSystemCheck />,
    4: <StepModelSetup />,
    5: <StepDownload />,
    6: <StepMicSetup />,
    7: <StepVoice />,
    8: <StepPrefs />,
    9: <StepIntegrations />,
    10: <StepAllSet onStart={() => void finish()} onShield={() => void finish('/shield')} />,
  };

  const variants = {
    enter: (dir: 1 | -1) => (reduced ? { opacity: 0 } : { x: dir * 48, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: 1 | -1) => (reduced ? { opacity: 0 } : { x: dir * -48, opacity: 0 }),
  };

  return (
    <div
      data-theme="xr-native"
      className="bg-bg-void/95 fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Onboarding — ${STEP_TITLES[step]}`}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 200, damping: 28 }}
        className="bg-bg-ink border-border-subtle flex h-[92vh] max-h-[620px] w-[92vw] max-w-[720px] flex-col overflow-hidden rounded-2xl border shadow-2xl"
      >
        {/* Header: progress + step counter + skip */}
        <div className="border-border-subtle flex items-center gap-4 border-b px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-text-tertiary text-[11px] font-semibold tracking-[0.08em] uppercase">
                {STEP_TITLES[step]}
              </span>
              <span className="text-text-tertiary font-mono text-[11px]" aria-live="polite">
                {step} / 10
              </span>
            </div>
            <div
              className="bg-bg-raised h-[3px] overflow-hidden rounded-full"
              role="progressbar"
              aria-label="Onboarding progress"
              aria-valuenow={step - 1}
              aria-valuemin={0}
              aria-valuemax={9}
            >
              <motion.div
                className="bg-accent h-full rounded-full"
                initial={false}
                animate={{ width: `${((step - 1) / 9) * 100}%` }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            </div>
          </div>
          {SKIPPABLE.has(step) && (
            <button
              type="button"
              onClick={() => nextStep()}
              className="text-text-tertiary hover:text-text-secondary ml-2 shrink-0 text-[12.5px] font-medium"
            >
              Skip
            </button>
          )}
        </div>

        {/* Body: direction-aware slide region */}
        <div className="relative min-h-0 flex-1">
          <AnimatePresence custom={direction} initial={false}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 300, damping: 30 }}
              className="absolute inset-0 overflow-y-auto px-6 py-6"
            >
              {slides[step]}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer: back / continue */}
        <div className="border-border-subtle flex items-center justify-between border-t px-6 py-4">
          <button
            type="button"
            onClick={() => (step > 1 ? prevStep() : goToStep(1))}
            disabled={step === 1}
            className="text-text-secondary hover:text-text-primary disabled:text-text-tertiary/50 text-[13px] font-medium disabled:cursor-not-allowed"
          >
            ← Back
          </button>
          {step < 10 && (
            <button
              type="button"
              onClick={onContinue}
              disabled={!canContinue}
              className="bg-accent text-accent-contrast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 rounded-lg px-5 py-2 text-[13.5px] font-semibold transition-colors"
            >
              Continue
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
