"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  Brain,
  CreditCard,
  Gauge,
  KeyRound,
  Layers,
  ListTree,
  Shield,
  Terminal,
  Users,
  Loader2,
  ExternalLink,
} from "lucide-react";

import { ConsoleProvider, useConsole } from "@/components/console/data";
import { ConsoleButton, StatusDot } from "@/components/console/kit";
import { consoleNav } from "@/lib/native";
import { cn } from "@/lib/utils";

const ICONS = {
  gauge: Gauge,
  users: Users,
  key: KeyRound,
  shield: Shield,
  layers: Layers,
  brain: Brain,
  card: CreditCard,
  list: ListTree,
  badge: BadgeCheck,
  terminal: Terminal,
} as const;

/**
 * The console shell.
 *
 * Density notes, because they are the whole point of this surface:
 *
 *   - The sidebar is 216px and does not collapse. Ten items fit; a hamburger on a
 *     desktop admin tool is a way to make someone click twice for every navigation.
 *   - The org switcher is a plain row, not a modal. Most teams have exactly one
 *     organization and a modal for the single-team case is a dialog nobody closes.
 *   - Names come before email addresses everywhere, because "who is this" is
 *     answered by a name and "which account" by the address.
 *   - The subscription state is in the sidebar footer rather than a top banner.
 *     A past-due notice belongs where the money lives, not on top of the audit log
 *     someone is in the middle of reading.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleProvider>
      <Shell>{children}</Shell>
    </ConsoleProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { status, me, team, entitlement, demo } = useConsole();
  const pathname = usePathname();

  if (status === "loading") {
    return (
      <div className="console-shell flex min-h-screen items-center justify-center gap-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-native-cyan" />
        <span className="text-[13px] text-native-text-muted">Loading console…</span>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="console-shell flex min-h-screen items-center justify-center px-6">
        <div className="console-panel w-full max-w-md p-7">
          <h1 className="text-[15px] font-semibold text-native-text">Sign in to continue</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-native-text-muted">
            The console is part of the Business tier. XR on your own machine does not need an account and this
            page does not affect it.
          </p>
          <div className="mt-5 flex gap-2">
            <ConsoleButton href="/auth/signin" variant="primary">
              Sign in
            </ConsoleButton>
            <ConsoleButton href="/pricing">See what Business includes</ConsoleButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="console-shell min-h-screen">
      <div className="flex min-h-screen">
        {/* ── sidebar ───────────────────────────────────────────────────── */}
        <aside className="hidden w-[216px] shrink-0 border-r border-native-border lg:block">
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2.5 px-4 py-4">
              <Link href="/" className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-native-cyan/20 ring-1 ring-inset ring-native-cyan/40" />
                <span className="text-[13px] font-medium text-native-text">XR</span>
              </Link>
              <span className="console-mono ml-auto text-[10px] text-native-text-dim">v1.0.0</span>
            </div>

            <div className="border-y border-native-border px-4 py-3">
              <div className="text-[10.5px] uppercase tracking-wider text-native-text-dim">Organization</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="truncate text-[12.5px] text-native-text">{team?.name ?? "No team"}</span>
                {team?.role ? (
                  <span className="console-mono shrink-0 rounded border border-native-border px-1 py-0.5 text-[9.5px] uppercase tracking-wide text-native-text-dim">
                    {team.role}
                  </span>
                ) : null}
              </div>
              {demo ? <div className="mt-1.5 text-[10.5px] text-native-warn">example data</div> : null}
            </div>

            <nav className="flex-1 overflow-y-auto py-2">
              {consoleNav.map((item) => {
                const Icon = ICONS[item.icon];
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-1.5 text-[12.5px] transition",
                      active
                        ? "bg-native-cyan/[0.08] text-native-cyan"
                        : "text-native-text-muted hover:bg-white/[0.03] hover:text-native-text",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-native-border px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] uppercase tracking-wider text-native-text-dim">Plan</span>
                <StatusDot
                  tone={entitlement?.businessActive ? "ok" : "neutral"}
                  label={entitlement?.businessActive ? "Business" : "Personal"}
                />
              </div>
              {entitlement?.trial?.active ? (
                <div className="mt-1.5 text-[10.5px] text-native-text-dim">
                  trial · {entitlement.trial.daysLeft} days left
                </div>
              ) : null}
              {entitlement?.isPastDue ? (
                <div className="mt-1.5 text-[10.5px] text-native-warn">payment retrying</div>
              ) : null}
              <Link
                href="/dashboard/billing"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-native-cyan hover:underline"
              >
                Billing <ExternalLink className="h-2.5 w-2.5" />
              </Link>
              <div className="mt-3 border-t border-native-border pt-3">
                <div className="truncate text-[11px] text-native-text-dim">{me?.user.email ?? "—"}</div>
                <Link
                  href="/auth/signin"
                  className="mt-1 inline-block text-[11px] text-native-text-dim hover:text-native-text-muted"
                >
                  Switch account
                </Link>
              </div>
            </div>
          </div>
        </aside>

        {/* ── main ──────────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <MobileNav pathname={pathname} />
          <main className="mx-auto max-w-[1100px] px-5 py-7 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

/** A horizontally scrolling strip on narrow screens rather than a drawer. */
function MobileNav({ pathname }: { pathname: string }) {
  return (
    <div className="border-b border-native-border lg:hidden">
      <div className="flex gap-1 overflow-x-auto px-3 py-2">
        {consoleNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px]",
                active ? "bg-native-cyan/[0.1] text-native-cyan" : "text-native-text-muted",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
