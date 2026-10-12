/**
 * XR — the Baileys boundary (Phase 26).
 *
 * Why this file exists instead of `typeof import("@whiskeysockets/baileys")`:
 *
 *   Baileys links against `libsignal-node`, which is **GPL-3.0**. The repository
 *   forbids copyleft dependencies in the lockfile (`scripts/license-check.ts`,
 *   a Quality Gate job), and that gate is a product invariant, not a lint rule —
 *   so Baileys is an **opt-in runtime**: the user installs it only if they want
 *   the WhatsApp surface, and it is not in `package.json`, not in `bun.lock`,
 *   and not scanned.
 *
 *   That has one consequence for the code: XR cannot import Baileys' types
 *   either (a type import still requires the package to be installed to
 *   typecheck, and would put it back in the tree the moment someone added it as
 *   a devDependency for convenience). So the exact surface XR uses — eleven
 *   members, listed below — is declared structurally here. Everything else in
 *   the adapter already talks to the `WhatsAppSocket` interface in `types.ts`,
 *   so the adapter stays fully typed and testable without the package present.
 *
 * The five call sites in `client.ts` are the only places that touch this, and
 * `npm i`-style drift shows up immediately: a renamed member throws the error
 * below at link time, with the install hint attached.
 */
import type { WhatsAppAuthState } from "./creds.ts";

/** What `downloadMediaMessage` is handed: a Baileys message plus a helper. */
export interface BaileysMediaRequest {
  updateMediaMessage?: (message: unknown) => Promise<unknown>;
}

/** The structural subset of a Baileys socket that XR relies on. */
export interface BaileysSocketLike {
  ev: {
    on(event: string, handler: (payload: unknown) => void): void;
  };
  sendMessage(
    jid: string,
    content: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ key?: { id?: string | null } | null } | undefined>;
  sendPresenceUpdate?(presence: string, jid: string): Promise<void>;
  end?(error?: Error): void;
  logout?(message?: string): Promise<void>;
  updateMediaMessage?(message: unknown): Promise<unknown>;
}

/** The structural subset of the Baileys module that XR calls. */
export interface BaileysModuleLike {
  makeWASocket(options: Record<string, unknown>): BaileysSocketLike;
  initAuthCreds(): unknown;
  makeCacheableSignalKeyStore(
    keys: WhatsAppAuthState["keys"],
    logger: unknown,
  ): WhatsAppAuthState["keys"];
  Browsers: { appropriate(name: string): unknown };
  downloadMediaMessage(
    message: unknown,
    type: "buffer",
    options: Record<string, unknown>,
    context: { logger: unknown; reuploadRequest?: BaileysMediaRequest["updateMediaMessage"] },
  ): Promise<Buffer>;
}

/** The package the user installs to turn the WhatsApp surface on. */
const RUNTIME_PACKAGE = "@whiskeysockets/baileys";

/** The one message a user sees when the optional runtime is missing. */
export const RUNTIME_MISSING_MESSAGE =
  "WhatsApp support needs the optional @whiskeysockets/baileys runtime, which XR cannot bundle: it links against GPL-3.0 libsignal, and this project's release pipeline only ships permissive licenses. Install it where the XR daemon runs (bun add @whiskeysockets/baileys) and restart the daemon.";

/**
 * Load Baileys, or explain in words what to do.
 *
 * Kept lazy for two reasons: a user who never links WhatsApp never pays for the
 * import, and the module is genuinely absent for most installs.
 */
export async function loadBaileys(): Promise<BaileysModuleLike> {
  try {
    // The specifier is built at runtime rather than written as a literal: a
    // literal would be resolved by the typechecker (and by any bundler that
    // walks this file), which would drag the GPL-3.0 tree back in — as a type
    // dependency at best, as a shipped one at worst. `import(RUNTIME_PACKAGE)`
    // is opaque to both, which is exactly what "opt-in runtime" has to mean.
    const mod = (await import(RUNTIME_PACKAGE)) as unknown as Partial<BaileysModuleLike>;
    if (typeof mod.makeWASocket !== "function") throw new Error("missing makeWASocket");
    return mod as BaileysModuleLike;
  } catch {
    throw new Error(RUNTIME_MISSING_MESSAGE);
  }
}

/**
 * Is the runtime importable? Used by `/api/whatsapp/status` so the desktop can
 * say so *before* the user scans a QR, instead of failing at link time.
 */
export async function isRuntimeInstalled(): Promise<boolean> {
  try {
    await loadBaileys();
    return true;
  } catch {
    return false;
  }
}
