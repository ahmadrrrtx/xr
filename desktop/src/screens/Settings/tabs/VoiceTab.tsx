/*
 * Settings → Voice (Phase 8 → 15). The microphone, recogniser, voice and
 * activation controls live on the Voice screen (SCREEN 13) next to the live
 * session so changes can be heard immediately; this tab keeps the global
 * push-to-talk key (Rust-owned), the XR sound preferences and a summary.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { LabeledSlider, Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { ArrowRight, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isTauri } from '@/lib/tauri';
import { eventToCombo, formatTauriChord, toTauriChord } from '@/lib/shortcuts';
import { pttSetShortcut, pttShortcutInfo } from '@/lib/settingsApi';
import { useSettingsStore } from '@/stores/settingsStore';
import { useVoiceStore } from '@/voice/voiceStore';

export function VoiceTab() {
  const voice = useSettingsStore((state) => state.settings.voice);
  const update = useSettingsStore((state) => state.update);

  const navigate = useNavigate();
  const engineVoice = useVoiceStore((state) => state.settings);
  const voices = useVoiceStore((state) => state.voices);
  const devices = useVoiceStore((state) => state.devices);
  const refreshStatus = useVoiceStore((state) => state.refreshStatus);
  const loadCatalogues = useVoiceStore((state) => state.loadCatalogues);
  useEffect(() => {
    void refreshStatus().then(() => loadCatalogues());
  }, [refreshStatus, loadCatalogues]);
  const deviceLabel = devices.find((d) => d.id === engineVoice?.desktop.micDeviceId)?.label ?? 'System default';
  const voiceLabel = voices.find((v) => v.id === engineVoice?.ttsVoice)?.label ?? engineVoice?.ttsVoice ?? '—';
  const activationLabel = engineVoice?.desktop.activation === 'hold' ? 'Hold to talk' : engineVoice?.desktop.activation === 'always' ? 'Always on' : 'Tap to talk';

  /* ── push-to-talk ── */
  const [pttChord, setPttChord] = useState<string | null>(null);
  const [pttRecording, setPttRecording] = useState(false);
  const [pttWarning, setPttWarning] = useState<'modifier' | 'system' | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void pttShortcutInfo().then((chord) => {
      if (chord) setPttChord(chord);
    });
  }, []);

  useEffect(() => {
    if (!pttRecording) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setPttRecording(false);
        setPttWarning(null);
        return;
      }
      const combo = eventToCombo(event);
      if (!combo) return;
      if (!combo.includes('+')) {
        setPttWarning('modifier');
        return;
      }
      void pttSetShortcut(toTauriChord(combo)).then((result) => {
        if (result === null || result.conflict) {
          setPttWarning('system');
          return;
        }
        setPttChord(result.shortcut);
        setPttRecording(false);
        setPttWarning(null);
        toast.success(`Push-to-talk: ${formatTauriChord(result.shortcut)}`);
      });
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [pttRecording]);

  return (
    <div>
      {/* ── Summary → Voice screen ── */}
      <SettingsSection title="Voice" description="Microphone, recogniser, voice and activation are set on the Voice screen, where you can hear the result.">
        <SettingRow label="Microphone" description={deviceLabel}>
          <span className="text-text-tertiary text-xs">{engineVoice?.desktop.noiseSuppression === false ? 'noise suppression off' : 'noise suppression on'}</span>
        </SettingRow>
        <SettingRow label="Recogniser" description={engineVoice ? (engineVoice.sttBackend === 'sherpa' || engineVoice.sttBackend === 'auto' ? `${engineVoice.sttModel} · offline` : `${engineVoice.sttBackend} · cloud`) : 'Engine offline'}>
          <span className="text-text-tertiary text-xs">{engineVoice?.profanityFilter ? 'profanity filter on' : ''}</span>
        </SettingRow>
        <SettingRow label="Voice" description={engineVoice ? `${voiceLabel} · ${engineVoice.ttsSpeed.toFixed(2)}×` : 'Engine offline'}>
          <span className="text-text-tertiary text-xs">{activationLabel}</span>
        </SettingRow>
        <SettingRow label="Open the Voice screen" description="Live meter, test transcription, voice previews, downloads.">
          <Button size="sm" onClick={() => navigate('/voice')}>
            Open Voice <ArrowRight size={14} aria-hidden="true" />
          </Button>
        </SettingRow>
      </SettingsSection>

      {/* ── Voice activation ── */}
      <SettingsSection title="Voice activation">
        <SettingRow
          label={
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                <Globe size={9} className="mr-1" /> Global
              </Badge>
              <span className="text-text-primary text-[13px] font-medium">Push-to-talk key</span>
            </span>
          }
          description={
            pttRecording
              ? pttWarning === 'modifier'
                ? 'Add a modifier (⌘/Ctrl, Alt or Shift). Esc cancels.'
                : pttWarning === 'system'
                  ? 'The OS refused that chord — another app may own it. Try again.'
                  : 'Press keys now. Esc cancels.'
              : 'Hold to talk — works even when XR is not focused.'
          }
        >
          {pttRecording ? (
            <div className="flex items-center gap-2">
              <span className="border-accent/60 text-accent animate-pulse rounded-md border border-dashed px-2.5 py-1 text-xs">
                Recording…
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPttRecording(false);
                  setPttWarning(null);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Kbd>
                {formatTauriChord(pttChord ?? toTauriChord('mod+.'))}
              </Kbd>
              <Button variant="ghost" size="sm" onClick={() => setPttRecording(true)}>
                Rebind
              </Button>
            </div>
          )}
        </SettingRow>
        <SettingRow
          label="Wake word (“Hey XR”)"
          description={engineVoice?.mode === 'wake-word' ? 'On — set up on the Voice screen.' : 'Off — enable it on the Voice screen.'}
        >
          <Button variant="ghost" size="sm" onClick={() => navigate('/voice')}>
            Voice settings
          </Button>
        </SettingRow>
      </SettingsSection>

      {/* ── Sounds ── */}
      <SettingsSection title="Sounds">
        <SettingRow label="Mute all XR sounds" htmlFor="xr-sounds-muted">
          <Toggle
            id="xr-sounds-muted"
            checked={voice.muted}
            onCheckedChange={(v) => update('voice', { muted: v })}
          />
        </SettingRow>
        <SettingRow label="Sound volume" htmlFor="xr-sounds-volume">
          <LabeledSlider
            label="Sound volume"
            min={0}
            max={100}
            value={voice.soundsVolume}
            onChange={(value) => update('voice', { soundsVolume: value })}
            format={(value) => `${value}%`}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
