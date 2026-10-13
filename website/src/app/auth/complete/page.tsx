"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Loader2 } from "lucide-react";

/**
 * `/auth/complete` — where a magic link lands.
 *
 * The API consumes the token and redirects here with the session cookie already
 * set. This page's whole job is to hand control back to the right place:
 *
 *   - If the person came from the desktop app, they are handed off to `xr://…`
 *     and land back in a running application with a session, rather than being
 *     told to go find their own way back.
 *   - Otherwise they go to the console.
 *
 * The desktop handoff is *offered*, never forced. Automatically navigating a
 * browser to a custom scheme is a trick that makes a web page look like it is
 * doing something it is not; a button labelled with what it will do is honest and
 * works the same on every platform.
 */
function CompleteInner() {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const explicit = params.get("desktop");
  const desktopDeepLink = explicit ? explicit : next.startsWith("xr://") ? next : null;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!desktopDeepLink) {
      // A short beat so the redirect does not flash a spinner on a fast connection.
      const timer = setTimeout(() => {
        window.location.href = next.startsWith("/") ? next : "/dashboard";
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [desktopDeepLink, next]);

  if (desktopDeepLink) {
    return (
      <div className="rounded-xl border border-native-border bg-native-bg-elevated/70 p-7">
        <Check className="h-5 w-5 text-native-ok" />
        <h1 className="mt-4 text-[17px] font-semibold text-native-text">Signed in</h1>
        <p className="mt-2.5 text-[13px] leading-relaxed text-native-text-muted">
          Your browser is signed in. To finish in the desktop app, open it from here — the link carries you
          back into the running application.
        </p>
        <a
          href={desktopDeepLink}
          className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-native-cyan text-[13px] font-medium text-[#02222a] transition hover:bg-native-cyan-soft"
        >
          Open XR desktop
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(desktopDeepLink).catch(() => undefined);
            setCopied(true);
          }}
          className="mt-3 w-full text-[12px] text-native-text-dim hover:text-native-text-muted"
        >
          {copied ? "Link copied" : "Or copy the link"}
        </button>
        <Link href="/dashboard" className="mt-6 block text-[12.5px] text-native-cyan hover:underline">
          Continue in the browser instead
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-native-border bg-native-bg-elevated/70 p-7">
      <div className="flex items-center gap-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-native-cyan" />
        <h1 className="text-[15px] font-medium text-native-text">Taking you in…</h1>
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-native-text-muted">
        If nothing happens,{" "}
        <Link href="/dashboard" className="text-native-cyan hover:underline">
          open the console
        </Link>
        .
      </p>
    </div>
  );
}

export default function AuthCompletePage() {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl border border-native-border bg-native-bg-elevated/70" />}>
      <CompleteInner />
    </Suspense>
  );
}
