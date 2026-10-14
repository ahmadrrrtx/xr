"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Cookie acknowledgement banner (Phase 31 · Bucket B · B5).
 *
 * XR sets essential cookies only, so there is nothing to configure and no
 * Accept/Reject theatre: one sentence, one link, one acknowledgement. The
 * acknowledgement is `localStorage.xr_cookie_ack` (declared in the cookie
 * policy — it is storage, not a cookie, and never leaves the browser).
 *
 * Rendering rules: nothing on the server and nothing before the localStorage
 * check resolves (a flash of banner for returning visitors is worse than a
 * late banner), nothing once acknowledged, and it floats over the page
 * footer without reserving layout space or blocking content. Chrome only
 * mounts it in the marketing branch — never over the console or auth flows.
 */
export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("xr_cookie_ack") !== "1") setVisible(true);
    } catch {
      // Storage unavailable (private mode, locked-down browser): show the
      // banner; dismissing it just won't persist, which is fail-visible
      // rather than fail-silent.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const accept = () => {
    try {
      window.localStorage.setItem("xr_cookie_ack", "1");
    } catch {
      /* see above — hide for this page view regardless */
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto flex min-h-[60px] max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2 md:min-h-12">
        <p className="text-[13px] leading-snug text-zinc-300">
          We use essential cookies only to keep you signed in and the site working.{" "}
          <Link href="/cookies" className="text-violet-300 hover:underline">
            Cookie Policy
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={accept}
          className="ml-auto rounded-lg bg-white px-3.5 py-1.5 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-zinc-200"
        >
          Accept &amp; continue
        </button>
      </div>
    </div>
  );
}
