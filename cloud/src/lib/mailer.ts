/**
 * XR Cloud — transactional email.
 *
 * Per the brief's aesthetic rules: plain text first, simple HTML second, a quiet
 * cyan accent, and **no marketing footer spam**. Every message this service sends
 * is one a recipient actively caused: a sign-in link, an invitation, or a billing
 * notice. There is no newsletter, no "you might also like", and no open-tracking
 * pixel — which is also why `nodemailer` is configured with `disableFileAccess`
 * and no analytics header.
 *
 * Two transports:
 *   - `smtp` — real delivery.
 *   - `capture` — writes `.eml` files to a directory. This is what makes the
 *     acceptance test "signup + magic-link login works" actually runnable in a
 *     sandbox with no mail server, and it is the default in development.
 *
 * A failed send is **reported**, never swallowed: `sendMail` returns a result and
 * the route surfaces it. A magic-link endpoint that silently fails to send is
 * indistinguishable from one that works, which is the worst possible failure mode
 * for a login flow (Constitution Art. IV.2).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";

import { loadEnv } from "../env.ts";
import { getLogger } from "./logger.ts";

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text is authored first and is always present. */
  text: string;
  html: string;
  /** Reply-To, when a human should be reachable. */
  replyTo?: string;
}

export interface MailResult {
  ok: boolean;
  transport: "smtp" | "capture";
  /** Where the captured message landed, in capture mode. */
  path?: string;
  /** Operator-facing reason on failure. Never contains the body. */
  error?: string;
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  const env = loadEnv();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER && env.SMTP_PASSWORD
          ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
          : undefined,
      // Bounded (Art. XII · Rule 3): a hung SMTP server must not hang a request.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  return transporter;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const env = loadEnv();

  if (env.MAIL_TRANSPORT === "capture") {
    try {
      await mkdir(env.MAIL_CAPTURE_DIR, { recursive: true });
      const safeTo = message.to.replace(/[^a-zA-Z0-9._@-]/g, "_");
      const name = `${Date.now()}-${safeTo}-${message.subject.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40)}.eml`;
      const path = join(env.MAIL_CAPTURE_DIR, name);
      const eml = [
        `From: ${env.MAIL_FROM}`,
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        `Date: ${new Date().toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        message.text,
      ].join("\r\n");
      await writeFile(path, eml, "utf8");
      getLogger().info({ to: message.to, subject: message.subject, path }, "mail captured");
      return { ok: true, transport: "capture", path };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      getLogger().error({ to: message.to, subject: message.subject, detail }, "mail capture failed");
      return { ok: false, transport: "capture", error: `could not write to ${env.MAIL_CAPTURE_DIR}: ${detail}` };
    }
  }

  try {
    await getTransporter().sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    return { ok: true, transport: "smtp" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    getLogger().error({ to: message.to, subject: message.subject, detail }, "smtp send failed");
    return { ok: false, transport: "smtp", error: detail };
  }
}

/* --------------------------------------------------------------- templates */
/*
 * Small, hand-written, no template engine. The shell is 480px wide, system
 * fonts, one cyan rule. Every message ends with a sentence saying why the
 * recipient got it — the cheapest possible anti-phishing measure, and the
 * honest one.
 */

const ACCENT = "#0a7f92"; // cyan, darkened to pass AA on white
const INK = "#16181d";
const MUTED = "#5b616e";

function shell(heading: string, bodyHtml: string, whyLine: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ec;border-radius:12px;">
    <tr><td style="padding:24px 24px 8px;">
      <div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${ACCENT};font-weight:600;">XR</div>
    </td></tr>
    <tr><td style="padding:0 24px 8px;">
      <h1 style="margin:8px 0 0;font-size:19px;line-height:1.35;font-weight:600;">${heading}</h1>
    </td></tr>
    <tr><td style="padding:12px 24px 24px;font-size:14px;line-height:1.6;color:${INK};">
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 24px 24px;border-top:1px solid #eef0f3;font-size:12px;line-height:1.6;color:${MUTED};">
      ${whyLine}
    </td></tr>
  </table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0;"><a href="${href}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;font-size:14px;">${label}</a></p>
<p style="margin:0 0 4px;font-size:12px;color:${MUTED};">Or paste this into your browser:</p>
<p style="margin:0;font-size:12px;word-break:break-all;color:${ACCENT};">${href}</p>`;
}

export function magicLinkEmail(input: {
  link: string;
  minutesValid: number;
  isNewAccount: boolean;
}): MailMessage {
  const heading = input.isNewAccount ? "Finish setting up XR" : "Sign in to XR";
  const text = [
    heading,
    "",
    `Open this link to continue. It expires in ${input.minutesValid} minutes and can be used once:`,
    "",
    input.link,
    "",
    "If you did not request this, ignore this email — nothing happens without the link.",
    "",
    "— XR",
  ].join("\n");
  const html = shell(
    heading,
    `<p style="margin:0 0 4px;">Open this link to continue. It expires in ${input.minutesValid} minutes and works once.</p>
     ${button(input.link, "Continue")}`,
    "You received this because someone entered this address at XR. If that was not you, ignore this email — nothing happens without the link.",
  );
  return { to: "", subject: input.isNewAccount ? "Finish setting up XR" : "Your XR sign-in link", text, html };
}

export function inviteEmail(input: {
  orgName: string;
  inviterEmail: string;
  role: string;
  link: string;
  expiresInDays: number;
}): MailMessage {
  const heading = `You have been invited to ${input.orgName} on XR`;
  const text = [
    heading,
    "",
    `${input.inviterEmail} invited you as ${input.role}.`,
    "",
    `Accept here (expires in ${input.expiresInDays} days):`,
    input.link,
    "",
    "XR runs locally on your machine. Joining a team adds shared workspaces, shared memory and managed models — it does not move your local data anywhere.",
    "",
    "— XR",
  ].join("\n");
  const html = shell(
    heading,
    `<p style="margin:0 0 4px;"><strong>${input.inviterEmail}</strong> invited you to join as <strong>${input.role}</strong>.</p>
     ${button(input.link, "Accept invitation")}
     <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">XR runs locally on your machine. Joining a team adds shared workspaces, shared memory and managed models — it does not move your local data anywhere.</p>`,
    `Sent because ${input.inviterEmail} invited this address to ${input.orgName}. If that was unexpected, ignore this email; the invitation expires in ${input.expiresInDays} days.`,
  );
  return { to: "", subject: `Invitation to ${input.orgName} on XR`, text, html };
}

export function paymentFailedEmail(input: {
  orgName: string;
  portalUrl: string;
  amountLabel: string;
}): MailMessage {
  const heading = "Your last XR payment did not go through";
  const text = [
    heading,
    "",
    `Stripe could not charge ${input.amountLabel} for ${input.orgName}.`,
    "",
    "Team features keep working while Stripe retries. Update the payment method to stop the retries:",
    input.portalUrl,
    "",
    "Nothing on your team's machines has been turned off. If the subscription is cancelled later, local XR keeps working exactly as it does today — only the team features stop.",
    "",
    "— XR",
  ].join("\n");
  const html = shell(
    heading,
    `<p style="margin:0 0 4px;">Stripe could not charge <strong>${input.amountLabel}</strong> for ${input.orgName}.</p>
     <p style="margin:0 0 4px;">Team features keep working while Stripe retries.</p>
     ${button(input.portalUrl, "Update payment method")}
     <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">Nothing on your team's machines has been turned off. If the subscription is cancelled later, local XR keeps working exactly as it does today — only the team features stop.</p>`,
    "Billing notification for a team you administer. Manage billing in the XR admin console.",
  );
  return { to: "", subject: `XR payment failed for ${input.orgName}`, text, html };
}

export function trialEndingEmail(input: { orgName: string; daysLeft: number; portalUrl: string }): MailMessage {
  const heading = `Your XR Business trial ends in ${input.daysLeft} day${input.daysLeft === 1 ? "" : "s"}`;
  const text = [
    heading,
    "",
    "Add a payment method to keep team features. If you do nothing, the subscription stops at the end of the trial.",
    "",
    input.portalUrl,
    "",
    "If you do nothing: XR keeps running locally for every member, with every feature that works today. Only team features (shared workspaces, shared memory, managed models, relay, audit export) stop.",
    "",
    "— XR",
  ].join("\n");
  const html = shell(
    heading,
    `<p style="margin:0 0 4px;">Add a payment method to keep team features.</p>
     ${button(input.portalUrl, "Add payment method")}
     <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">If you do nothing: XR keeps running locally for every member, with every feature that works today. Only team features stop.</p>`,
    `Trial reminder for ${input.orgName}.`,
  );
  return { to: "", subject: `XR Business trial ends in ${input.daysLeft} day${input.daysLeft === 1 ? "" : "s"}`, text, html };
}
