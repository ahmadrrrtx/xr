"use client";

import { usePathname } from "next/navigation";

import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";

/**
 * Marketing chrome, applied conditionally.
 *
 * The root layout cannot ask which route it is rendering for — a layout is
 * deliberately pathname-blind in the App Router — so the choice of whether the
 * public navigation and footer belong on a page is made here, where `usePathname`
 * is available and works during server rendering as well as after hydration.
 *
 * Two route families opt out:
 *
 *   `/dashboard/*` — the admin console. Marketing chrome above an audit log
 *     makes an operations surface look like a brochure, and the footer's "Pricing"
 *     and "Download" links sit in the one place a customer is trying to read a
 *     bill. The console has its own shell.
 *
 *   `/auth/*` — sign-in, sign-up, handoff and error pages. Their whole job is to
 *     be a single unambiguous action; a navigation bar is an exit, and an exit is
 *     the last thing a page in the middle of an authentication flow should offer.
 *
 * Both families still render inside the root layout, so the design tokens, the
 * fonts and the `<html>` document are shared — only the chrome is withheld.
 */
export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const bare = pathname.startsWith("/dashboard") || pathname.startsWith("/auth");

  if (bare) return <main className="min-h-screen">{children}</main>;

  return (
    <>
      <Nav />
      <main>{children}</main>
      <Footer />
    </>
  );
}
