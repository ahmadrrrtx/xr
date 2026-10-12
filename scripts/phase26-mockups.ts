#!/usr/bin/env bun
/**
 * XR — Phase 26 mockup generator.
 *
 * Renders the Discord and WhatsApp Integrations surfaces as self-contained HTML
 * files: no scripts, no external stylesheets, no network. Each file inlines the
 * desktop theme tokens, the Phase 22 dialog shell and the Phase 26 additions, so
 * it opens correctly from disk, from an email, or in a sandboxed preview pane.
 *
 * Why mockups instead of screenshots: the sandbox that produced this phase has
 * no Discord bot token and no WhatsApp account, so there is nothing to point a
 * camera at. The markup, class names and copy mirror the real components
 * (desktop/src/screens/Integrations/**), and the QR image is a real one —
 * generated here with the same `qrcode` dependency the engine uses.
 *
 *   bun run scripts/phase26-mockups.ts /home/user/previews/implementation/phase-26
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";

const outDir = process.argv[2] ?? "/home/user/previews/implementation/phase-26";
mkdirSync(outDir, { recursive: true });

// A real QR payload, rendered with the same library the daemon uses.
const qrDataUrl = await QRCode.toDataURL("2@XR26-phase-mockup-not-a-real-code,1", {
  margin: 1,
  width: 300,
  errorCorrectionLevel: "M",
});
const qrPairingDataUrl = await QRCode.toDataURL("2@XR26-pairing-frame-2,7", {
  margin: 1,
  width: 300,
  errorCorrectionLevel: "M",
});

const THEME = `
  /* Theme: XR Midnight (the desktop default). Copied from desktop/src/styles/themes.css. */
  :root {
    --bg-base: #0b0f17;
    --bg-raised: #121826;
    --bg-elevated: #18202f;
    --border-subtle: rgba(183, 194, 207, 0.08);
    --border-default: rgba(183, 194, 207, 0.16);
    --text-primary: #f0f4f8;
    --text-secondary: #9aa8ba;
    --text-tertiary: #5a6678;
    --accent: #00e5ff;
    --accent-dim: #008da8;
    --success: #34d399;
    --warning: #fbbf24;
    --danger: #f87171;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --radius: 12px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg-base); color: var(--text-primary);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { padding: 24px 28px 40px; display: flex; flex-direction: column; gap: 16px; }
  .caption {
    font-size: 12px; color: var(--text-tertiary); border-left: 2px solid var(--accent-dim);
    padding-left: 10px; margin: 0 0 4px; max-width: 90ch;
  }
  h1 { font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  h3 { font-size: 13px; margin: 0 0 6px; font-weight: 600; }
  h4 { font-size: 13px; margin: 12px 0 6px; font-weight: 600; color: var(--text-secondary); }
  p { margin: 0; }
  .sub { color: var(--text-secondary); font-size: 13px; max-width: 60ch; }
  .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .btn {
    display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px;
    border-radius: 8px; font-size: 13px; cursor: default; border: 1px solid var(--border-default);
    background: transparent; color: var(--text-primary);
  }
  .btn--outline { border-color: var(--accent); color: var(--accent); }
  .btn--ghost { border-color: transparent; color: var(--text-secondary); }
  .btn--danger { border-color: var(--danger); color: var(--danger); }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 1100px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .card {
    position: relative; display: flex; flex-direction: column; gap: 10px; padding: 16px;
    border-radius: var(--radius); border: 1px solid var(--border-subtle); background: var(--bg-raised);
  }
  .card--connected { border-color: rgba(52, 211, 153, 0.35); }
  .card__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .badges { display: inline-flex; align-items: center; gap: 6px; }
  .tile {
    width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center;
    font-size: 20px; background: var(--bg-elevated); border: 1px solid var(--border-subtle);
  }
  .chip {
    font-size: 11px; border-radius: 999px; padding: 2px 8px; border: 1px solid var(--border-subtle);
    color: var(--text-secondary); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
  }
  .chip--connected { border-color: var(--success); color: var(--success); background: rgba(52, 211, 153, 0.08); }
  .chip--warn { border-color: var(--warning); color: var(--warning); }
  .chips { list-style: none; display: flex; gap: 4px; flex-wrap: wrap; margin: 4px 0 0; padding: 0; }
  .dots { display: inline-flex; align-items: center; gap: 6px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .dot--green { background: var(--success); }
  .dot--yellow { background: var(--warning); }
  .dot--red { background: var(--danger); }
  .card__name { font-size: 15px; font-weight: 600; margin: 0; }
  .card__desc { font-size: 13px; color: var(--text-secondary); margin: 0; }
  .card__footer { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: auto; }

  /* Dialog shell (Phase 22 .ix-dialog). */
  .dialog {
    width: 480px; max-width: 100%; border-radius: var(--radius); border: 1px solid var(--border-default);
    background: var(--bg-elevated); padding: 20px; display: flex; flex-direction: column; gap: 14px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  }
  .dialog__title { font-size: 16px; font-weight: 600; margin: 0; }
  .dialog__desc { font-size: 13px; color: var(--text-secondary); margin: 4px 0 0; }
  .form { display: flex; flex-direction: column; gap: 14px; }
  .form label { font-size: 13px; font-weight: 500; }
  .input {
    height: 36px; border-radius: 8px; border: 1px solid var(--border-default); background: var(--bg-raised);
    color: var(--text-primary); padding: 0 12px; font-size: 13px; width: 100%;
  }
  .hint { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
  .hint--warn { color: var(--warning); display: flex; gap: 6px; align-items: flex-start; }
  .link { color: var(--accent); text-decoration: underline; font-size: 12px; }
  .check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 1.5; }
  .check input { margin-top: 2px; }
  .foot { display: flex; justify-content: flex-end; gap: 8px; }
  .notice {
    display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 10px;
    border: 1px solid var(--warning); background: var(--bg-raised); font-size: 13px;
  }
  .notice p code { font-family: var(--font-mono); font-size: 12px; }
  .btn--off { opacity: 0.45; }
  .notice p { margin: 6px 0 0; font-size: 12px; color: var(--text-secondary); }
  .paircode {
    display: flex; flex-direction: column; gap: 6px; align-items: flex-start; padding: 12px 14px;
    border-radius: 10px; border: 1px solid var(--accent-dim); background: var(--bg-raised);
  }
  .paircode__digits {
    font-family: var(--font-mono); font-size: 24px; letter-spacing: 0.16em; font-variant-numeric: tabular-nums;
  }
  .paircode__meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-secondary); }
  .invite {
    display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 10px;
    border: 1px solid var(--border-subtle); background: var(--bg-raised);
  }
  .invite__url { font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); overflow-wrap: anywhere; }
  .qr { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .qr__frame {
    width: 300px; height: 300px; border-radius: 12px; border: 1px solid var(--border-subtle);
    background: #fff; display: grid; place-items: center; overflow: hidden;
  }
  .qr__meta { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-height: 18px; }
  .qr__placeholder {
    padding: 16px; text-align: center; font-size: 13px; color: var(--text-secondary);
    display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: var(--bg-raised);
  }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  .list li { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .logs {
    margin: 0; max-height: 160px; overflow: auto; padding: 10px 12px; border-radius: 8px;
    border: 1px solid var(--border-subtle); background: var(--bg-raised); font-family: var(--font-mono);
    font-size: 11px; line-height: 1.5; color: var(--text-secondary); white-space: pre-wrap;
  }
  .row { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
  .mono { font-family: var(--font-mono); font-size: 12px; }
  .kbd {
    font-family: var(--font-mono); font-size: 12px; border: 1px solid var(--border-default);
    border-radius: 6px; padding: 1px 6px; background: var(--bg-raised);
  }
`;

const CAPTION = (what: string): string =>
  `<p class="caption"><strong>Mockup, not a screenshot.</strong> ${what} The markup, class names and copy mirror ` +
  `desktop/src/screens/Integrations/**, and the QR images are real (generated with the same qrcode dependency the engine uses).</p>`;

const shell = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${THEME}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>
`;

/* ── 1 · the Integrations grid, with both new cards ─────────────────────── */

const card = (opts: {
  monogram: string;
  name: string;
  desc: string;
  auth: string;
  capabilities: string[];
  dot: "green" | "yellow" | "red";
  dotLabel: string;
  footer: string;
  connected?: boolean;
}): string => `
    <article class="card ${opts.connected ? "card--connected" : ""}">
      <div class="card__top">
        <div class="tile" aria-hidden="true">${opts.monogram}</div>
        <span class="badges">
          <span class="dot dot--${opts.dot}" title="${opts.dotLabel}"></span>
          <span class="chip">${opts.auth}</span>
        </span>
      </div>
      <h2 class="card__name">${opts.name}</h2>
      <p class="card__desc">${opts.desc}</p>
      <ul class="chips">${opts.capabilities.map((c) => `<li class="chip">${c}</li>`).join("")}</ul>
      <div class="card__footer">${opts.footer}</div>
    </article>`;

const grid = shell(
  "XR · Integrations — Phase 26 cards",
  `${CAPTION("The Integrations grid as it renders with Discord connected, WhatsApp linked-but-idle and Telegram running.")}
  <h1>Integrations</h1>
  <p class="sub">Connect only the apps you choose. Credentials are encrypted on this computer.</p>
  <div class="grid">
    ${card({
      monogram: "🎮",
      name: "Discord",
      desc: "Run tasks and approve actions from Discord. XR must be running on your computer.",
      auth: "Bot token",
      capabilities: ["send message", "read messages", "slash commands", "approvals"],
      dot: "green",
      dotLabel: "Answering",
      connected: true,
      footer: `<span class="chip chip--connected">✓ Connected</span><span class="btn btn--ghost">⚙︎ Settings</span><span class="btn btn--ghost">Unplug Disconnect</span>`,
    })}
    ${card({
      monogram: "💬",
      name: "WhatsApp",
      desc: "Link XR as a companion device and talk to it from your phone. Unofficial client — read the warning first.",
      auth: "QR link",
      capabilities: ["send message", "read messages", "voice notes", "approvals"],
      dot: "yellow",
      dotLabel: "Configured, not answering",
      footer: `<span class="chip chip--warn">Stopped</span><span class="btn btn--ghost">⚙︎ Settings</span>`,
    })}
    ${card({
      monogram: "✈️",
      name: "Telegram",
      desc: "Run tasks and approve actions from your phone. XR must be running on your computer.",
      auth: "Bot token",
      capabilities: ["send message", "read messages"],
      dot: "green",
      dotLabel: "Answering",
      connected: true,
      footer: `<span class="chip chip--connected">✓ Connected</span><span class="btn btn--ghost">⚙︎ Settings</span>`,
    })}
    ${card({
      monogram: "🐙",
      name: "GitHub",
      desc: "Connect a repository so XR can read issues and open pull requests.",
      auth: "OAuth",
      capabilities: ["issues", "pull requests", "repo read"],
      dot: "green",
      dotLabel: "Answering",
      connected: true,
      footer: `<span class="chip chip--connected">✓ Connected</span><span class="btn btn--ghost">⚙︎ Settings</span>`,
    })}
  </div>`,
);

/* ── 2 · Discord connect: token → invite → pairing ──────────────────────── */

const discordConnect = shell(
  "XR · Connect Discord",
  `${CAPTION("The three steps of the Discord connect dialog. Pairing runs the other way round from Telegram: the desktop mints the code and the user types it into Discord, because a bot cannot DM someone who has never spoken to it.")}
  <h1>Connect Discord</h1>
  <div class="row">
    <section class="dialog" aria-label="Step 1: token">
      <div>
        <h2 class="dialog__title">Connect Discord</h2>
        <p class="dialog__desc">XR must be running on your computer for the bot to respond.</p>
      </div>
      <div class="form">
        <label for="token">Bot token</label>
        <input class="input" id="token" type="password" value="MTIzNDU2Nzg5MDEyMzQ1Njc4.GaBcDe.****" readonly />
        <p class="hint">In the <span class="link">Discord Developer Portal ↗</span> create an application, add a bot, and paste its
          token. XR checks it with Discord and stores it in the OS keychain.</p>
        <p class="hint hint--warn">⚠︎ Also switch on <strong>MESSAGE_CONTENT</strong> under Bot → Privileged Gateway Intents, or Discord
          delivers empty message text and XR cannot read what you send it.</p>
        <div class="foot"><span class="btn btn--ghost">Cancel</span><span class="btn btn--outline">Connect</span></div>
      </div>
    </section>

    <section class="dialog" aria-label="Step 2: invite">
      <div>
        <h2 class="dialog__title">Connect Discord</h2>
        <p class="dialog__desc">XR must be running on your computer for the bot to respond.</p>
      </div>
      <div class="form">
        <p role="status">✓ Token accepted — XR · Home Lab.</p>
        <p class="hint">Add the bot to a server you own. XR asks for five permissions only: view channels, send messages, embed
          links, attach files and read history. No moderation, no administrator.</p>
        <div class="invite">
          <code class="invite__url">https://discord.com/oauth2/authorize?client_id=123456789012345678&amp;scope=bot+applications.commands&amp;permissions=117760</code>
          <div class="actions"><span class="btn btn--outline">↗ Open invite</span><span class="btn btn--ghost">⧉ Copy</span></div>
        </div>
        <div class="foot"><span class="btn btn--ghost">Skip</span><span class="btn btn--outline">Continue</span></div>
      </div>
    </section>

    <section class="dialog" aria-label="Step 3: pairing">
      <div>
        <h2 class="dialog__title">Connect Discord</h2>
        <p class="dialog__desc">XR must be running on your computer for the bot to respond.</p>
      </div>
      <div class="form">
        <div class="paircode">
          <code class="paircode__digits">402 913</code>
          <div class="paircode__meta"><span>Expires in 8:41</span><span class="btn btn--ghost">⧉ Copy</span></div>
        </div>
        <p class="hint">In Discord, send <code>/xr pair 402913</code> in a DM to the bot (or <code>/xr pairchannel 402913</code> in a
          server channel). The code works once, for ten minutes.</p>
        <p class="hint">✓ 1 account paired already.</p>
        <div class="foot"><span class="btn btn--ghost">Done</span></div>
      </div>
    </section>
  </div>`,
);

/* ── 3 · Discord settings ───────────────────────────────────────────────── */

const discordSettings = shell(
  "XR · Discord settings",
  `${CAPTION("The Discord settings dialog: who may talk to XR, the channel allow-list with its server/channel picker, per-chat limits, the optional interactions webhook and dev-guild registration, auto-start, logs and disconnect.")}
  <h1>Discord settings</h1>
  <section class="dialog" aria-label="Discord settings">
    <div>
      <h2 class="dialog__title">Discord settings</h2>
      <p class="dialog__desc">XR · Home Lab · Connected. XR must be running on your computer for the bot to respond.</p>
    </div>
    <div class="form">
      <p class="hint" style="color: var(--success)">State: Connected — gateway, 42 ms</p>

      <section>
        <h3>Who may talk to XR</h3>
        <h4>Paired accounts</h4>
        <ul class="list">
          <li><span><strong>ana</strong> · 111111111111111111</span><span class="btn btn--ghost">Unpair</span></li>
        </ul>
        <h4>Allowed channels</h4>
        <ul class="list">
          <li><span>#general · 444444444444444444 / 555555555555555555</span><span class="btn btn--ghost">Remove</span></li>
        </ul>
        <div class="actions" style="margin-top:8px">
          <span class="btn btn--outline">Load my servers</span>
          <span class="btn btn--outline">Pair a channel by code</span>
        </div>
        <div style="margin-top:10px; display:flex; flex-direction:column; gap:6px">
          <label for="guild" class="hint">Server</label>
          <select class="input" id="guild"><option>Home Lab</option></select>
          <label for="chan" class="hint">Channel</label>
          <select class="input" id="chan"><option>#general</option></select>
        </div>
      </section>

      <section>
        <h3>Limits</h3>
        <label for="rate" class="hint">Messages per minute, per chat</label>
        <input class="input" id="rate" value="20" readonly />
        <label for="attach" class="hint">Attachment limit (MB)</label>
        <input class="input" id="attach" value="5" readonly />
        <label for="webhook" class="hint">Interactions webhook URL (optional, https only)</label>
        <input class="input" id="webhook" placeholder="Leave empty to use the gateway" readonly />
        <label for="devguild" class="hint">Register slash commands in one server (instant, optional)</label>
        <input class="input" id="devguild" placeholder="Server id — global commands can take an hour" readonly />
        <div class="actions"><span class="btn btn--outline">Save limits</span></div>
      </section>

      <section>
        <h3>Running</h3>
        <label class="check"><input type="checkbox" checked /> Start automatically when XR starts</label>
        <div class="actions" style="margin-top:8px"><span class="btn btn--outline">Stop</span></div>
      </section>

      <section>
        <h3>Logs</h3>
        <pre class="logs">13:41:02 info  gateway READY · session 9f2c…
13:41:02 info  slash commands registered (global, 10 commands)
13:44:19 info  message from a paired user in a DM
13:44:31 info  approval ap_e70b7f95 requested · run_command
13:44:47 info  decision from desktop · approved
13:45:02 info  chat budget cap 5.00 usd · spent 0.0142</pre>
        <p class="hint">The bot token never appears here — only the engine's redacted lines.</p>
      </section>

      <section>
        <h3>Disconnect</h3>
        <div class="actions"><span class="btn btn--danger">Disconnect</span></div>
      </section>
    </div>
    <div class="foot"><span class="btn btn--ghost">Close</span></div>
  </section>`,
);

/* ── 4 · WhatsApp connect: disclosure → QR → linked ─────────────────────── */

const whatsappConnect = shell(
  "XR · Connect WhatsApp",
  `${CAPTION("The WhatsApp connect dialog. The risk acknowledgement comes before the QR: linking uses an unofficial client, so the user has to say they understand before a code is minted. The QR area is 300×300 and follows the engine's frame stream. The last panel is the state a fresh install is in — the Baileys runtime is opt-in and not bundled (GPL-3.0 libsignal), so the QR button is disabled until it is installed.")}
  <h1>Connect WhatsApp</h1>
  <div class="row">
    <section class="dialog" aria-label="Step 1: disclosure and QR">
      <div>
        <h2 class="dialog__title">Connect WhatsApp</h2>
        <p class="dialog__desc">XR must be running on your computer for this chat to answer.</p>
      </div>
      <div class="form">
        <div class="notice">
          <span aria-hidden="true">🛡</span>
          <div>
            <strong>⚠️ Unofficial client</strong>
            <p>WhatsApp does not offer an official API for personal accounts. XR links as a companion device using an unofficial
              open-source client (Baileys), exactly like a second phone you signed in from. That is against WhatsApp's terms for
              automated use, and accounts have been banned for it. Use a number you can afford to lose, keep the rate low, and only
              allow the contacts you mean to.</p>
          </div>
        </div>
        <label class="check"><input type="checkbox" checked /> I understand: this uses an unofficial WhatsApp client, and my account
          could be banned.</label>
        <div class="qr">
          <div class="qr__frame"><img src="${qrDataUrl}" width="300" height="300" alt="WhatsApp pairing QR code (mockup)" /></div>
          <div class="qr__meta">New code in 37s</div>
        </div>
        <p class="hint">On your phone: <strong>Settings → Linked devices → Link a device</strong>, then scan this code. WhatsApp
          rotates it every twenty seconds — XR follows along.</p>
        <div class="foot"><span class="btn btn--ghost">Close</span><span class="btn btn--outline">Waiting for the scan…</span></div>
      </div>
    </section>

    <section class="dialog" aria-label="Step 2: second QR frame">
      <div>
        <h2 class="dialog__title">Connect WhatsApp</h2>
        <p class="dialog__desc">A later frame from the same stream: the code rotated, the countdown restarted.</p>
      </div>
      <div class="form">
        <div class="qr">
          <div class="qr__frame"><img src="${qrPairingDataUrl}" width="300" height="300" alt="WhatsApp pairing QR code, second frame (mockup)" /></div>
          <div class="qr__meta">New code in 52s</div>
        </div>
        <p class="hint">Both images are genuinely different QR codes — the generator encodes two different payloads, the way
          WhatsApp's stream produces new frames.</p>
      </div>
    </section>

    <section class="dialog" aria-label="Runtime not installed">
      <div>
        <h2 class="dialog__title">Connect WhatsApp</h2>
        <p class="dialog__desc">The state a fresh install is in — and the reason the QR button is off.</p>
      </div>
      <div class="form">
        <div class="notice">
          <span aria-hidden="true">⚠️</span>
          <div>
            <strong>⚠️ Runtime not installed</strong>
            <p>WhatsApp support needs the optional <code>@whiskeysockets/baileys</code> runtime, which XR cannot bundle:
              it links against GPL-3.0 libsignal, and this project's release pipeline only ships permissive licenses.
              Install it where the XR daemon runs (<code>bun add @whiskeysockets/baileys</code>) and restart the daemon.</p>
          </div>
        </div>
        <div class="qr">
          <div class="qr__frame"><div class="qr__placeholder">Waiting for WhatsApp to send a code…</div></div>
          <div class="qr__meta"></div>
        </div>
        <label class="check"><input type="checkbox" checked /> I understand: this uses an unofficial WhatsApp client, and my
          account could be banned.</label>
        <p class="hint">Install the runtime, then reopen this dialog.</p>
        <div class="foot"><span class="btn btn--ghost">Close</span><span class="btn btn--outline btn--off">Show QR code</span></div>
      </div>
    </section>

    <section class="dialog" aria-label="Step 3: linked">
      <div>
        <h2 class="dialog__title">Connect WhatsApp</h2>
        <p class="dialog__desc">After the scan: linked, and still nobody may talk to XR.</p>
      </div>
      <div class="form">
        <p role="status">✓ Linked as …4567. XR is a companion device now.</p>
        <p class="hint">⚠︎ Linking authorizes nobody. Add the contacts you want below, or switch on “respond to contacts I message
          first” in settings. Everything else is ignored silently.</p>
        <label for="contact" class="hint">Allow a contact</label>
        <input class="input" id="contact" placeholder="923001234567 (country code, no +)" readonly />
        <div class="actions"><span class="btn btn--outline">Add contact</span></div>
        <div class="foot"><span class="btn btn--ghost">Close</span><span class="btn btn--outline">Start now</span></div>
      </div>
    </section>
  </div>`,
);

/* ── 5 · WhatsApp settings ──────────────────────────────────────────────── */

const whatsappSettings = shell(
  "XR · WhatsApp settings",
  `${CAPTION("WhatsApp settings: the contact allow-list, the outbox switch, the 1/second limits, auto-reconnect, the redacted log (last four digits of any number), and unpair.")}
  <h1>WhatsApp settings</h1>
  <section class="dialog" aria-label="WhatsApp settings">
    <div>
      <h2 class="dialog__title">WhatsApp settings</h2>
      <p class="dialog__desc">…4567 · open. XR must be running on your computer for this chat to answer.</p>
    </div>
    <div class="form">
      <p class="hint" style="color: var(--success)">State: open</p>
      <p class="hint">Session: sealed on disk (128 keys) · history payloads declined: 3</p>

      <section>
        <h3>Allowed contacts</h3>
        <ul class="list">
          <li><span><strong>Ana</strong> · 923001234567</span><span class="btn btn--ghost">Remove</span></li>
          <li><span>447700900123</span><span class="btn btn--ghost">Remove</span></li>
        </ul>
        <div class="actions" style="margin-top:8px">
          <input class="input" style="max-width:220px" placeholder="923001234567" readonly />
          <span class="btn btn--outline">Add</span>
        </div>
        <label class="check" style="margin-top:10px"><input type="checkbox" checked /> Respond to contacts I message first</label>
        <p class="hint">Learned from messages you send while XR is running (never from your chat history). 1 number learned so far.</p>
      </section>

      <section>
        <h3>Limits</h3>
        <label for="wrate" class="hint">Messages per minute, per chat (1–60)</label>
        <input class="input" id="wrate" value="20" readonly />
        <label for="wattach" class="hint">Document limit (MB, photos stay capped at 2 MB)</label>
        <input class="input" id="wattach" value="5" readonly />
        <div class="actions"><span class="btn btn--outline">Save limits</span></div>
      </section>

      <section>
        <h3>Running</h3>
        <label class="check"><input type="checkbox" checked /> Reconnect automatically when XR starts</label>
        <div class="actions" style="margin-top:8px"><span class="btn btn--outline">Stop</span></div>
      </section>

      <section>
        <h3>Logs</h3>
        <pre class="logs">13:40:11 info  linked as …4567
13:40:11 info  someone may now talk to XR: 2 contacts allowed
13:41:55 info  rate_limited for …0123 (too many messages)
13:42:10 info  voice note from …4567 transcribed (41 chars)
13:43:02 info  approval requested · whatsapp · run_command
13:43:19 info  decision from telegram · approved</pre>
        <p class="hint">Phone numbers appear as last four digits only, even here.</p>
      </section>

      <section>
        <h3>Unpair</h3>
        <div class="actions"><span class="btn btn--danger">Unpair this device</span></div>
      </section>
    </div>
    <div class="foot"><span class="btn btn--ghost">Close</span></div>
  </section>`,
);

/* ── 6 · approvals across surfaces + Runs badge ─────────────────────────── */

const APPROVAL_ROW = (surface: string, actor: string, when: string, badge: string, tone: string): string => `
      <tr>
        <td><span class="chip">${badge}</span></td>
        <td class="mono">ap_e70b7f95</td>
        <td>run_command</td>
        <td>${surface}</td>
        <td class="mono">${actor}</td>
        <td style="color: var(--${tone})">${when}</td>
      </tr>`;

const approvals = shell(
  "XR · Approvals and Runs — Phase 26 surfaces",
  `${CAPTION("What cross-surface sync looks like in the desktop: one durable approval record, decided once, and the surface that decided it named in the audit trail. The Runs badge marks which surface a run came from.")}
  <h1>Approvals &amp; runs</h1>
  <p class="sub">One approval record per risky action. The first answer wins, whichever surface it came from, and the other
    surfaces are edited or followed up so nobody sees a stale button.</p>
  <div class="card" style="max-width: 980px">
    <h3 style="margin-bottom:10px">Approval ap_e70b7f95 · run_command · risk: medium</h3>
    <div class="row">
      <div class="card" style="flex:1; min-width:260px">
        <span class="chip chip--connected">✅ Approved</span>
        <p class="hint">Decided from <strong>desktop</strong> at 13:44:47, 16 s after the request. The Discord message was edited to
          “✅ Approved from desktop · run_command” and WhatsApp received the same line as a follow-up, because WhatsApp cannot edit
          messages.</p>
      </div>
      <div style="flex:1; min-width:320px">
        <table style="width:100%; border-collapse:collapse; font-size:13px">
          <thead>
            <tr style="color: var(--text-tertiary); text-align:left">
              <th style="padding:6px 4px">Surface</th><th>Approval</th><th>Tool</th><th>Shown on</th><th>Decided by</th><th>When</th>
            </tr>
          </thead>
          <tbody>
            ${APPROVAL_ROW("Discord", "discord:111111111111111111", "edited at 13:44:47", "discord", "success")}
            ${APPROVAL_ROW("WhatsApp", "whatsapp:…4567", "follow-up at 13:44:47", "whatsapp", "success")}
            ${APPROVAL_ROW("Telegram", "telegram:55512345", "edited at 13:44:47", "telegram", "success")}
            ${APPROVAL_ROW("Desktop", "local", "record updated at 13:44:47", "daemon", "success")}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="card" style="max-width: 980px">
    <h3 style="margin-bottom:10px">Runs — the surface badge</h3>
    <ul class="list">
      <li><span><span class="chip">discord</span> <span class="mono">run_9f2c41</span> — “refactor the auth module, keep it under $0.50”</span><span class="mono">$0.0142 · 8.4k tok</span></li>
      <li><span><span class="chip">whatsapp</span> <span class="mono">run_9f2c38</span> — “[🎤 Voice note] summarise the failing test in billing”</span><span class="mono">$0.0061 · 3.1k tok</span></li>
      <li><span><span class="chip">telegram</span> <span class="mono">run_9f2c30</span> — “what changed in the repo today?”</span><span class="mono">$0.0029 · 1.7k tok</span></li>
      <li><span><span class="chip">cli</span> <span class="mono">run_9f2c22</span> — “xr build the desktop app”</span><span class="mono">$0.0088 · 5.2k tok</span></li>
    </ul>
  </div>`,
);

/* ── write everything ───────────────────────────────────────────────────── */

const files: Array<[string, string]> = [
  ["01-integrations-cards.html", grid],
  ["02-discord-connect.html", discordConnect],
  ["03-discord-settings.html", discordSettings],
  ["04-whatsapp-connect.html", whatsappConnect],
  ["05-whatsapp-settings.html", whatsappSettings],
  ["06-approvals-and-runs.html", approvals],
];

for (const [name, html] of files) {
  writeFileSync(join(outDir, name), html, "utf8");
  console.log(`wrote ${join(outDir, name)} (${html.length} bytes)`);
}
