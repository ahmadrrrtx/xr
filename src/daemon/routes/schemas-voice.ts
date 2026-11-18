import { z } from 'zod/v4';
/** Revision precondition is mandatory: clients must review conflicts, never
 * silently fetch a newer revision and retry an old offline patch. */
export const VoiceSettingsRequest = z.looseObject({
  expectedRevision: z.string().min(1).max(64),
  mode: z.enum(['off', 'push-to-talk', 'wake-word', 'always-listen']).optional(),
  enabled: z.boolean().optional(), noiseSuppression: z.boolean().optional(),
  sttBackend: z.string().max(200).optional(), sttModel: z.string().max(200).optional(), sttLanguage: z.string().max(200).optional(),
  ttsBackend: z.string().max(200).optional(), ttsVoice: z.string().max(200).optional(), ttsSpeed: z.number().optional(),
  wakeWord: z.string().max(200).optional(), wakeSensitivity: z.enum(['low', 'medium', 'high']).optional(),
  wakeSound: z.boolean().optional(), profanityFilter: z.boolean().optional(),
  allowCloudStt: z.boolean().optional(), allowCloudTts: z.boolean().optional(), sentenceTts: z.boolean().optional(), spokenStatus: z.boolean().optional(),
  desktop: z.looseObject({
    micDeviceId: z.string().max(500).nullable().optional(), inputGain: z.number().optional(),
    activation: z.enum(['hold', 'tap', 'always']).optional(), ttsPitch: z.number().optional(),
    autoExitSilenceSec: z.number().optional(), showTranscripts: z.boolean().optional(), theaterImmersive: z.boolean().optional(),
    chatMicTarget: z.enum(['screen', 'docked']).optional(), holdGlobalHotkey: z.boolean().optional(),
  }).optional(),
});
export const VoiceSettingsResponse = z.looseObject({ settings: z.looseObject({ revision: z.string() }) });
