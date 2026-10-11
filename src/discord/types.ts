/**
 * XR — Discord wire constants and minimal payload shapes (Phase 26).
 *
 * Only the fields XR reads or writes are typed. This is deliberately not a
 * copy of the Discord API surface: no discord.js, no @discordjs/* packages.
 * Values come from the Discord developer documentation (API v10).
 */

export const DISCORD_API_BASE = "https://discord.com/api/v10";

/** Gateway intents XR requests. MESSAGE_CONTENT is privileged: enable it in the Developer Portal. */
export const GatewayIntent = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
} as const;
export const XR_INTENTS = GatewayIntent.GUILDS | GatewayIntent.GUILD_MESSAGES | GatewayIntent.DIRECT_MESSAGES | GatewayIntent.MESSAGE_CONTENT;

/** Permissions in the invite URL: send messages, embed links, attach files. No history access, no admin. */
export const XR_INVITE_PERMISSIONS = (1 << 11) | (1 << 14) | (1 << 15);

/** Gateway close codes that cannot succeed on retry. */
export const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

export const ChannelType = {
  GUILD_TEXT: 0,
  DM: 1,
  PUBLIC_THREAD: 11,
  PRIVATE_THREAD: 12,
} as const;

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

export const InteractionCallbackType = {
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
} as const;

export const MessageFlags = { EPHEMERAL: 1 << 6 } as const;

export const ComponentType = { ACTION_ROW: 1, BUTTON: 2 } as const;
export const ButtonStyle = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4 } as const;

export const OptionType = { SUB_COMMAND: 1, STRING: 3 } as const;

/** Discord message length limits. */
export const DISCORD_MAX_CHARS = 2000;
export const EMBED_FIELD_MAX = 1024;
export const EMBED_DESCRIPTION_MAX = 4096;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordMember {
  user?: DiscordUser;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  url: string;
  size: number;
  content_type?: string;
}

export interface DiscordMessageCreate {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: DiscordUser;
  mentions?: DiscordUser[];
  attachments?: DiscordAttachment[];
  referenced_message?: { id: string; content?: string; author?: DiscordUser } | null;
}

export interface DiscordInteraction {
  id: string;
  type: number;
  token: string;
  application_id: string;
  channel_id?: string;
  guild_id?: string;
  channel?: { id: string; type: number };
  member?: DiscordMember;
  user?: DiscordUser;
  data?: {
    name?: string;
    custom_id?: string;
    options?: Array<{ name: string; type: number; value?: unknown; options?: Array<{ name: string; type: number; value?: unknown }> }>;
  };
}

export interface DiscordReady {
  user: DiscordUser;
  session_id: string;
  resume_gateway_url: string;
  guilds: Array<{ id: string }>;
  application: { id: string };
}

/** A message XR sends. Plain text plus optional embed and action-row buttons. */
export interface DiscordOutgoing {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
  components?: Array<Record<string, unknown>>;
  /** Reply to a message in the same channel, without failing if it is gone. */
  replyTo?: string;
  /** Interaction messages are ephemeral (visible only to the invoker). */
  ephemeral?: boolean;
}
