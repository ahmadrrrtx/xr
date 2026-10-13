/**
 * XR Cloud — mailer façade.
 *
 * `lib/mailer.ts` knows how to send bytes. This knows *what* XR sends, and — more
 * importantly — it is the single place that decides what happens when a send
 * fails.
 *
 * A magic-link endpoint that silently fails to send is indistinguishable from one
 * that works, and the user is left staring at "check your email" for a message
 * that will never arrive. That is the worst possible failure mode for a login
 * flow, so:
 *
 *   - `sendSignInLink` returns a result the route inspects.
 *   - In a deployment where mail is not configured at all, the route answers
 *     `503` with a repair string naming the missing variables, rather than
 *     pretending.
 *   - In development, the link is also written to the log *at debug level* so a
 *     developer is not locked out of their own service — and that only happens
 *     when `NODE_ENV !== "production"`.
 */

import type { CloudEnv } from "../env.ts";
import { getLogger } from "../lib/logger.ts";
import { sendMail, inviteEmail, magicLinkEmail, paymentFailedEmail, trialEndingEmail, type MailResult } from "../lib/mailer.ts";

export interface Mailer {
  readonly ready: boolean;
  readonly transport: "smtp" | "capture";
  sendSignInLink(input: {
    to: string;
    link: string;
    minutesValid: number;
    isNewAccount: boolean;
  }): Promise<MailResult>;
  sendInvite(input: {
    to: string;
    orgName: string;
    inviterEmail: string;
    role: string;
    link: string;
    expiresInDays: number;
  }): Promise<MailResult>;
  sendPaymentFailed(input: { to: string; orgName: string; portalUrl: string; amountLabel: string }): Promise<MailResult>;
  sendTrialEnding(input: { to: string; orgName: string; daysLeft: number; portalUrl: string }): Promise<MailResult>;
}

export function createMailer(env: CloudEnv): Mailer {
  const ready = env.capabilities.mail.state === "ready";
  const transport = env.MAIL_TRANSPORT;

  function devEcho(kind: string, to: string, link: string): void {
    if (env.NODE_ENV === "production") return;
    // Deliberately debug level. A developer running locally needs this; a
    // production log must never contain a live sign-in link.
    getLogger().debug({ kind, to, link }, "dev: outbound link (not sent to a real inbox)");
  }

  return {
    ready,
    transport,

    async sendSignInLink(input) {
      if (!ready && transport === "smtp") {
        return {
          ok: false,
          transport: "smtp",
          error: `mail is not configured (${env.capabilities.mail.detail})`,
        };
      }
      const message = magicLinkEmail(input);
      message.to = input.to;
      devEcho("magic-link", input.to, input.link);
      return await sendMail(message);
    },

    async sendInvite(input) {
      if (!ready && transport === "smtp") {
        return { ok: false, transport: "smtp", error: `mail is not configured (${env.capabilities.mail.detail})` };
      }
      const message = inviteEmail(input);
      message.to = input.to;
      return await sendMail(message);
    },

    async sendPaymentFailed(input) {
      const message = paymentFailedEmail(input);
      message.to = input.to;
      return await sendMail(message);
    },

    async sendTrialEnding(input) {
      const message = trialEndingEmail(input);
      message.to = input.to;
      return await sendMail(message);
    },
  };
}
