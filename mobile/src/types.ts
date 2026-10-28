/** Shared shapes for the XR mobile companion. Mirrors the daemon REST contract. */

export type ThemeId = 'system' | 'xr-native' | 'graphite' | 'midnight' | 'paper' | 'arctic';

export type DeviceKind = 'mobile' | 'desktop';

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  /** True when the model runs on the user's own machine (no third-party hop). */
  local?: boolean;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  lastMessage?: string | undefined;
  unread?: number | undefined;
  messageCount?: number | undefined;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export type DeliveryState = 'sent' | 'sending' | 'queued' | 'failed';

export interface ChatMessage {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  delivery?: DeliveryState | undefined;
  /** Client-only: true while tokens are still arriving. */
  streaming?: boolean | undefined;
  /** Set when this message came from a voice note on the Voice tab. */
  viaVoice?: boolean | undefined;
  error?: string | undefined;
}

export interface Approval {
  id: string;
  title: string;
  summary: string;
  workspace: string;
  runId?: string | undefined;
  createdAt: number;
  status: 'pending' | 'approved' | 'denied';
  /** Budget impact in cents, when the action has one. */
  budgetCents?: number | undefined;
  /** Unified diff or file preview rendered in the detail sheet. */
  diff?: string | undefined;
  filePath?: string | undefined;
  language?: string | undefined;
  resolvedAt?: number | undefined;
  resolvedOn?: string | undefined;
}

export interface Budget {
  spentTodayCents: number;
  /** Present only when a daily ceiling actually exists — the governed daemon
   * budget has a per-task + monthly cap instead (V1-P5-001 honesty fix). */
  dailyCapCents?: number | undefined;
  /** Per-task spend ceiling in cents (the daemon's real governed cap). */
  perTaskCents?: number | undefined;
  spentMonthCents: number;
  monthCapCents: number;
  currency: string;
}

export interface DaemonMeta {
  version: string;
  host: string;
  lan: boolean;
  deviceName?: string | undefined;
}

export interface PairingParams {
  code?: string | undefined;
  fp?: string | undefined;
  host?: string | undefined;
}

export type ConnectionStatus = 'connected' | 'connecting' | 'offline' | 'unpaired';

export interface QueuedRequest {
  id: string;
  url: string;
  method: 'POST' | 'DELETE';
  body: unknown;
  createdAt: number;
  /** Local message id so the UI can resolve the optimistic bubble on drain. */
  localId?: string | undefined;
  kind: 'chat' | 'new-chat' | 'approval' | 'transcribe';
  attempts: number;
  /**
   * Set (with a timestamp) by whichever side — page or service worker — is
   * currently replaying this item. Prevents a double-send when both wake up.
   */
  inflight?: number | undefined;
}
