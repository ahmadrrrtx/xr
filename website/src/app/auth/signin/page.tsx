"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, MailCheck, AlertTriangle } from "lucide-react";

import { CLOUD_API, CloudError, cloud, cloudConfigured } from "@/lib/cloud";

/**
 * `/auth/signin`.
 *
 * Magic-link first, because the people who sign in most often are inviting a
 * colleague who has never installed anything, and "type a password you will
 * immediately forget" is the wrong first impression. Password sign-in still
 * exists and is one disclosure away, for the far more common case of someone
 * returning on a machine where the email is already open.
 *
 * The `next` parameter is passed through to the API, which validates it against
 * the app origin and drops anything else. Dropping it client-side would be
 * theatre: the server is where the redirect actually happens.
 */
function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? undefined;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"link" | "password">("link");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ message: string; capturedTo?: string } | null>(null);
  const [problem, setProblem] = useState<{ message: string; repair: string | null } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (mode === "link") {
        setSent(await cloud.magicLink(email, next));
      } else {
        const res = await fetch(`${CLOUD_API}/auth/login`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; repair?: string } };
          throw new CloudError(res.status, "login_failed", body.error?.message ?? "Sign-in failed.", body.error?.repair ?? null);
        }
        // A full navigation, not a router push: the session cookie must be applied
        // before the console mounts, or the first request lands unauthenticated.
        window.location.href = next ?? "/dashboard";
      }
    } catch (error) {
      setProblem(
        error instanceof CloudError
          ? { message: error.message, repair: error.repair }
          : { message: "Could not reach the XR service.", repair: "Check your connection and try again." },
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-native-border bg-native-bg-elevated/70 p-7">
        <MailCheck className="h-5 w-5 text-native-cyan" />
        <h1 className="mt-4 text-[17px] font-semibold text-native-text">Check your email</h1>
        <p className="mt-2.5 text-[13px] leading-relaxed text-native-text-muted">{sent.message}</p>
        {sent.capturedTo ? (
          <p className="console-mono mt-4 break-all rounded-lg border border-native-border bg-native-bg p-3 text-[11px] text-native-text-dim">
            test mode — message written to {sent.capturedTo}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setSent(null)}
          className="mt-6 text-[12.5px] text-native-cyan hover:underline"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-native-border bg-native-bg-elevated/70 p-7">
      <h1 className="text-[17px] font-semibold text-native-text">Sign in to XR</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-native-text-muted">
        This is only for team features. XR on your own machine does not need an account and never asks for one.
      </p>

      {!cloudConfigured ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-native-warn/30 bg-native-warn/5 p-3.5 text-[12px] leading-relaxed text-native-text-muted">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-native-warn" />
          <span>
            No cloud API is configured for this deployment (<code className="console-mono text-[11px]">NEXT_PUBLIC_XR_CLOUD_API</code>),
            so sign-in cannot complete here. The local product is unaffected.
          </span>
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-[12px] font-medium text-native-text-muted">
            Work email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="console-focus mt-1.5 h-10 w-full rounded-lg border border-native-border bg-native-bg px-3 text-[13px] text-native-text placeholder:text-native-text-dim"
          />
        </div>

        {mode === "password" ? (
          <div>
            <label htmlFor="password" className="block text-[12px] font-medium text-native-text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="console-focus mt-1.5 h-10 w-full rounded-lg border border-native-border bg-native-bg px-3 text-[13px] text-native-text"
            />
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy || !cloudConfigured}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-native-cyan text-[13px] font-medium text-[#02222a] transition hover:bg-native-cyan-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {mode === "link" ? "Email me a sign-in link" : "Sign in"}
          {!busy ? <ArrowRight className="h-3.5 w-3.5" /> : null}
        </button>
      </form>

      {problem ? (
        <div className="mt-5 rounded-lg border border-native-danger/30 bg-native-danger/5 p-3.5">
          <p className="text-[12.5px] text-native-text">{problem.message}</p>
          {problem.repair ? <p className="mt-1 text-[11.5px] leading-relaxed text-native-text-muted">{problem.repair}</p> : null}
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between border-t border-native-border pt-5 text-[12px]">
        <button
          type="button"
          onClick={() => setMode(mode === "link" ? "password" : "link")}
          className="text-native-text-muted hover:text-native-cyan"
        >
          {mode === "link" ? "Use a password instead" : "Email me a link instead"}
        </button>
        <Link href="/auth/signup" className="text-native-cyan hover:underline">
          Create a team
        </Link>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-xl border border-native-border bg-native-bg-elevated/70" />}>
      <SignInForm />
    </Suspense>
  );
}
