"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";

/**
 * `/auth/error`.
 *
 * Every failure path in the auth flow lands here with a *reason* and, where one
 * exists, a *repair*. Two rules:
 *
 *   - The reason never distinguishes "no such account" from "wrong password".
 *     Both arrive as the same code, and both render the same sentence.
 *   - The repair is always an action, never an apology. "Request a new link" beats
 *     "something went wrong" in every case, including when the honest answer is
 *     "we cannot tell you why".
 */

const REASONS: Record<string, { title: string; body: string; action?: { label: string; href: string } }> = {
  expired: {
    title: "That link has expired",
    body: "Sign-in links are valid for 10 minutes and work exactly once. Request a new one and it will arrive in a few seconds.",
    action: { label: "Send a new link", href: "/auth/signin" },
  },
  used: {
    title: "That link was already used",
    body: "If this was you, you are probably already signed in on the device that opened it first. Otherwise, request a fresh link.",
    action: { label: "Send a new link", href: "/auth/signin" },
  },
  sso: {
    title: "Your identity provider refused the sign-in",
    body: "The organization requires SSO, and the provider did not confirm your identity. This is usually a group or app-assignment issue on the provider's side, not something you can fix here.",
    action: { label: "Ask an admin, or sign in another way", href: "/auth/signin" },
  },
  not_a_member: {
    title: "Your identity was confirmed, but you are not on this team",
    body: "XR does not add people to an organization automatically just because their email domain matches — that would let anyone with a company address read the team's memory. An admin needs to invite you.",
    action: { label: "Sign in to a different team", href: "/auth/signin" },
  },
  seat_limit: {
    title: "The trial is at its seat limit",
    body: "A Business trial is capped at 5 seats and no payment method. Add a payment method to raise the limit, or remove a member who has left.",
    action: { label: "Open billing", href: "/dashboard/billing" },
  },
  default: {
    title: "That sign-in did not complete",
    body: "The link may have been truncated by your mail client, or the request expired before it arrived. Requesting a new one fixes both.",
    action: { label: "Try again", href: "/auth/signin" },
  },
};

function ErrorInner() {
  const params = useSearchParams();
  const code = params.get("code") ?? "default";
  const reason = REASONS[code] ?? REASONS.default;
  const detail = params.get("message");

  return (
    <div className="rounded-xl border border-native-border bg-native-bg-elevated/70 p-7">
      <AlertTriangle className="h-5 w-5 text-native-warn" />
      <h1 className="mt-4 text-[17px] font-semibold text-native-text">{reason.title}</h1>
      <p className="mt-2.5 text-[13px] leading-relaxed text-native-text-muted">{reason.body}</p>

      {detail ? (
        <p className="console-mono mt-4 rounded-lg border border-native-border bg-native-bg p-3 text-[11px] leading-relaxed text-native-text-dim">
          {detail}
        </p>
      ) : null}

      {reason.action ? (
        <Link
          href={reason.action.href}
          className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg bg-native-cyan text-[13px] font-medium text-[#02222a] transition hover:bg-native-cyan-soft"
        >
          {reason.action.label}
        </Link>
      ) : null}

      <p className="mt-5 text-[11.5px] leading-relaxed text-native-text-dim">
        None of this affects XR on your machine. A failed sign-in only means team features are out of reach
        from this browser.
      </p>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-xl border border-native-border bg-native-bg-elevated/70" />}>
      <ErrorInner />
    </Suspense>
  );
}
