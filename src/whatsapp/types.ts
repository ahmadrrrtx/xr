/**
 * XR — WhatsApp wire shims (Phase 26).
 *
 * WhatsApp is the one surface with no HTTP API to talk to: it is a linked
 * *device*, so the adapter speaks the same multi-device protocol the phone does
 * (through Baileys) over a WebSocket to WhatsApp's own servers. Nothing in this
 * file talks to the network; it describes the small, structural view of the
 * socket the rest of the adapter uses, so a test can drive the whole surface
 * with a fake socket and no Baileys at all.
 *
 * The dependency is optional and loaded lazily (`src/whatsapp/client.ts`), so a
 * user who never links WhatsApp never loads it.
 */

/** Disconnect codes WhatsApp/Baileys report in `connection.update`. */
export const DISCONNECT = {
  /** The device was unlinked from the phone. Credentials are dead: wipe them. */
  LOGGED_OUT: 401,
  /** Socket dropped; reconnect expected. */
  CONNECTION_LOST: 408,
  /** Another connection took over (the phone re-linked). */
  CONNECTION_REPLACED: 440,
  /** Session blobs are unusable — re-link from the phone. */
  BAD_SESSION: 500,
  /** WhatsApp asks for a reconnect right after pairing. */
  RESTART_REQUIRED: 515,
} as const;

export const WA_MAX_CHARS = 1500;
export const TYPING_PULSE_MS = 5000;

/** The connection states the manager reports to the UI. */
export type WhatsAppConnectionStatus = "idle" | "connecting" | "qr" | "open" | "reconnecting" | "unpaired" | "error";

export interface WhatsAppConnectionState {
  status: WhatsAppConnectionStatus;
  /** Last close code from WhatsApp, when there was one. */
  lastCloseCode: number | null;
  /** Short, already-redacted human reason (never contains credentials). */
  reason: string | null;
  /** The account's own jid/phone label once linked (masked: `…4567`). */
  linkedAs: string | null;
}

/** One QR frame for the dialog, already an image data URL. */
export interface WhatsAppQrFrame {
  state: "qr" | "open" | "timeout" | "closed" | "error";
  /** `data:image/png;base64,…` — present for `state: "qr"`. */
  png?: string;
  /** When this frame stops being useful (ms epoch). */
  expiresAt?: number;
  reason?: string;
}

/** Media attached to an incoming message, with the bytes deliberately lazy. */
export interface WhatsAppMedia {
  kind: "image" | "document" | "audio";
  /** WhatsApp's own size metadata — checked BEFORE any download. */
  sizeBytes?: number;
  fileName?: string;
  mime?: string;
  /** True for a voice note (push-to-talk) rather than an uploaded audio file. */
  voice?: boolean;
  /** Seconds, for audio. */
  seconds?: number;
  /**
   * Fetch the bytes. Only ever called after the size cap passed, and only for
   * the CDN URL WhatsApp itself put in the message.
   */
  download: () => Promise<Uint8Array>;
}

/**
 * One normalized incoming message. The client turns a Baileys/proto message
 * into this shape, so the bot never sees proto types (and tests never need
 * them either).
 */
export interface WhatsAppIncoming {
  /** Chat jid — for 1:1 traffic this is the contact, and it is the only kind XR answers. */
  chatId: string;
  /** Sender jid (same value as `chatId` for 1:1). */
  senderId: string;
  /** Digits-only phone number of the sender, when the jid is a user jid. */
  phone: string | null;
  /** Display name from WhatsApp, shown next to the phone in the UI. Never used for auth. */
  pushName?: string;
  messageId: string;
  timestampMs: number;
  /** True when the message was sent from the linked account itself. */
  fromMe: boolean;
  /** Group/broadcast/status traffic. Dropped: Phase 26 is 1:1 only. */
  group: boolean;
  broadcast: boolean;
  /** Message text (caption text counts). */
  text: string;
  /** Quoted text, when this message replies to one of XR's own messages. */
  quotedText?: string;
  media: WhatsAppMedia[];
  /** Media types XR cannot use yet (video, stickers) — named so it can say so. */
  unsupported?: string[];
  /**
   * The platform's raw message. Only the media download closure uses it; it is
   * never logged and never serialized.
   */
  raw?: unknown;
}

/**
 * Fetch the bytes of one attached message. The real implementation is Baileys'
 * downloader; tests supply their own, so no test ever opens a socket.
 */
export type MediaDownloader = (raw: unknown, kind: string) => Promise<Uint8Array>;

/**
 * Structural view of the Baileys socket — the only members the adapter needs,
 * and exactly what the test fake implements.
 */
export interface WhatsAppSocket {
  /** Event emitter: `connection.update`, `creds.update`, `messages.upsert`, … */
  ev: {
    on(event: string, listener: (...args: unknown[]) => void): void;
    off?(event: string, listener: (...args: unknown[]) => void): void;
    removeAllListeners?(event?: string): void;
  };
  /** The linked account, once known. */
  user?: { id?: string | null; name?: string | null } | null;
  /** Underlying WebSocket, for its state getters. */
  ws?: { isOpen?: boolean; isClosed?: boolean; isConnecting?: boolean };
  sendMessage(
    jid: string,
    content: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ key?: { id?: string | null } | null } | undefined>;
  sendPresenceUpdate?(type: string, jid?: string): Promise<void>;
  readMessages?(keys: unknown[]): Promise<void>;
  logout?(): Promise<void>;
  end?(error?: Error): void;
}

/** The Baileys event shapes the adapter consumes — described, not imported. */
export interface ConnectionUpdatePayload {
  connection?: string;
  lastDisconnect?: { error?: { output?: { statusCode?: number } } };
  qr?: string;
  isNewLogin?: boolean;
}

export interface UpsertPayload {
  messages?: unknown[];
  type?: string;
}
