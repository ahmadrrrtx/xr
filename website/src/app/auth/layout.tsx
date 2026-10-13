import Link from "next/link";

import { XrLogo } from "@/components/Logo";

/**
 * Shared shell for every `/auth/*` route.
 *
 * Deliberately not the marketing nav. Someone who is in the middle of a sign-in
 * flow — often arriving from an email link on a phone — should see one task and
 * one card, not a menu with seven items competing for the tap.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="native-bg flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-6xl px-6 py-6">
        {/* `XrLogo` renders the mark *and* the wordmark, so this is one element,
            not a mark plus a label. (It was two, and the page read "XR XR".) */}
        <Link href="/" className="inline-flex items-center">
          <XrLogo tone="cyan" size={26} />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pb-24 pt-8">
        <div className="w-full max-w-[440px]">{children}</div>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-native-text-dim">
          <Link href="/legal/privacy" className="hover:text-native-text-muted">
            Privacy
          </Link>
          <Link href="/legal/terms" className="hover:text-native-text-muted">
            Terms
          </Link>
          <Link href="/security" className="hover:text-native-text-muted">
            Security
          </Link>
          <span className="ml-auto">
            No analytics on this page. No third-party scripts.
          </span>
        </div>
      </footer>
    </div>
  );
}
