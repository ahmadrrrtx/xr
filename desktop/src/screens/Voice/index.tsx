/*
 * SCREEN 13 · Voice (Phase 15).
 *
 * Idle: 50/50 — settings on the left (microphone, wake word, STT, TTS,
 * activation, theater, storage), a 400 px mini theater on the right with the
 * big Start button. Running (and not docked): the cinematic session hero
 * replaces the right column and stretches; Esc docks it into the pill.
 */
import { Mic } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { probeMicrophones, voice } from '@/voice/session';
import { useVoiceHotkeys } from '@/voice/useVoice';
import { useVoiceStore } from '@/voice/voiceStore';

import { ActivationSection, MicrophoneSection, SttSection, StorageSection, TheaterSection, TtsSection, WakeWordSection } from './components/sections';
import { ModelDownloadCard } from './components/shared';
import { MiniTheater, SessionHero } from './components/theater';

export default function VoiceScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const active = useVoiceStore((s) => s.active);
  const docked = useVoiceStore((s) => s.docked);
  const setDocked = useVoiceStore((s) => s.setDocked);
  const refreshStatus = useVoiceStore((s) => s.refreshStatus);
  const loadCatalogues = useVoiceStore((s) => s.loadCatalogues);
  const statusError = useVoiceStore((s) => s.statusError);

  useEffect(() => {
    const release = voice.retain();
    void refreshStatus().then(() => loadCatalogues());
    void probeMicrophones(false);
    return release;
  }, [refreshStatus, loadCatalogues]);

  // `/voice?start=1` (palette, HUD, orb menu) starts right away.
  useEffect(() => {
    if (params.get('start') !== '1') return;
    setParams({}, { replace: true });
    if (!useVoiceStore.getState().active) void voice.start('screen');
  }, [params, setParams]);

  // Arriving here while a session is docked re-expands it.
  useEffect(() => {
    if (active && docked) setDocked(false);
  }, [active, docked, setDocked]);

  // Engine down → poll softly until it is back.
  useEffect(() => {
    if (statusError !== 'engine-down') return;
    const t = window.setInterval(() => void refreshStatus(), 5000);
    return () => window.clearInterval(t);
  }, [statusError, refreshStatus]);

  // Esc: a running session docks into the pill and we go back (or to Chat
  // when this screen was the first thing opened); idle just goes back.
  const hasHistory = location.key !== 'default';
  const onEscape = useCallback(() => {
    if (useVoiceStore.getState().active) setDocked(true);
    if (hasHistory) navigate(-1);
    else navigate('/chat');
  }, [hasHistory, navigate, setDocked]);
  useVoiceHotkeys({ onEscape });

  const showHero = active && !docked;

  return (
    <div className="flex h-full min-h-0 flex-col" data-screen="voice">
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-3">
        <div className="min-w-0">
          <h2 className="text-text-primary flex items-center gap-2 text-[24px] leading-tight font-semibold tracking-tight">
            <Mic size={20} strokeWidth={1.75} aria-hidden="true" /> Voice
          </h2>
          <p className="text-text-tertiary text-[13px]">Talk to XR. Speech stays on this machine unless you pick a cloud voice.</p>
        </div>
      </div>

      <div className={cn('grid min-h-0 flex-1 gap-6 px-6 pb-6', showHero ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]')}>
        <div className="min-w-0 overflow-y-auto pr-1">
          <ModelDownloadCard className="mb-5" />
          <MicrophoneSection />
          <WakeWordSection />
          <SttSection />
          <TtsSection />
          <ActivationSection />
          <TheaterSection />
          <StorageSection />
        </div>
        <div className="min-h-0 lg:sticky lg:top-0 lg:self-start">
          {showHero ? (
            <SessionHero onDock={() => setDocked(true)} onStop={() => void voice.stop('user')} />
          ) : (
            <MiniTheater onStart={() => void voice.start('screen')} />
          )}
        </div>
      </div>
    </div>
  );
}
