/**
 * XR — Discord API type shims (Phase 26).
 *
 * Only the fields XR reads or writes. Deliberately not `discord.js`: the bot
 * needs two REST calls per answer and four gateway events, and a structure
 * library would be several megabytes of machinery XR would never touch.
 * Values are from the Discord API v10 reference.
 */

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordApplication {
  id: string;
  name: string;
  bot?: DiscordUser;
}

export interface DiscordGuildSummary {
  id: string;
  name: string;
}

export interface DiscordChannel {
  id: string;
  type: number;
  guild_id?: string;
  name?: string;
  recipients?: DiscordUser[];
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  content_type?: string;
  url: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  author: DiscordUser;
  attachments?: DiscordAttachment[];
  webhook_id?: string;
  /** Message type (0 = default, 19 = reply). Others are ignored. */
  type?: number;
  /** Present on replies; XR only re-quotes its own messages. */
  referenced_message?: { author?: DiscordUser; content?: string };
}

export interface DiscordInteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordInteractionOption[];
  focused?: boolean;
}

export interface DiscordInteractionData {
  id?: string;
  name?: string;
  custom_id?: string;
  component_type?: number;
  options?: DiscordInteractionOption[];
}

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  data?: DiscordInteractionData;
  channel_id?: string;
  guild_id?: string;
  member?: { user: DiscordUser };
  user?: DiscordUser;
  message?: DiscordMessage;
}

/** Interaction types (API v10). */
export const INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  AUTOCOMPLETE: 4,
} as const;

/** Interaction callback types. */
export const CALLBACK_TYPE = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
} as const;

/** Interaction callback flags. */
export const CALLBACK_FLAG = { EPHEMERAL: 64 } as const;

/** Message flags (REST). */
export const MESSAGE_FLAG = { SUPPRESS_EMBEDS: 4, SUPPRESS_NOTIFICATIONS: 4096 } as const;

/** Channel types relevant to XR. */
export const CHANNEL_TYPE = {
  GUILD_TEXT: 0,
  DM: 1,
  GUILD_VOICE: 2,
  GROUP_DM: 3,
  GUILD_CATEGORY: 4,
  GUILD_ANNOUNCEMENT: 5,
  PUBLIC_THREAD: 11,
  PRIVATE_THREAD: 12,
  GUILD_STAGE_VOICE: 13,
  GUILD_FORUM: 15,
} as const;

/**
 * Gateway intents XR needs. MESSAGE_CONTENT (1 << 15) is privileged: the user
 * must switch it on in the Developer Portal, which the connect dialog and the
 * docs say in plain language. Without it Discord delivers empty `content` for
 * guild messages, and DMs are filtered out entirely.
 */
export const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
} as const;

export const REQUIRED_INTENTS = INTENTS.GUILDS | INTENTS.GUILD_MESSAGES | INTENTS.DIRECT_MESSAGES | INTENTS.MESSAGE_CONTENT;

/** Gateway opcodes. */
export const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

/** Gateway close codes XR reacts to (4004 is fatal: the token is wrong). */
export const CLOSE_FATAL_AUTH = 4004;

/** Button styles. */
export const BUTTON_STYLE = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const;

export const COMPONENT_TYPE = { ACTION_ROW: 1, BUTTON: 2 } as const;
