"use client";

import Link from "next/link";
import { AlertTriangle, Info, Loader2, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Console primitives.
 *
 * ## Why this is a separate vocabulary from the marketing components
 *
 * The marketing site is allowed to be cinematic: orbs, glow, slow floats. An
 * administrative console is not. It is a surface someone stares at for twenty
 * minutes trying to answer "who has access to what, and when did it change" — so
 * every choice here is made for legibility under fatigue rather than for a
 * screenshot:
 *
 *   - 13px body, 12px secondary, 11px for metadata. Nothing smaller, nothing
 *     bigger except page titles.
 *   - Identifiers in mono with ligatures off, so `0` and `O` are distinguishable
 *     when someone is reading an id back over a call.
 *   - Status is a 6px dot, not a badge with a gradient. A dot can be scanned in a
 *     column; a badge makes every row a little louder than the last.
 *   - No animation except a spinner, which is information.
 *   - Colour carries meaning and nothing else. The only saturated hues on the page
 *     are ok / warning / danger / cyan-for-interactive.
 */

export function StatusDot({
  tone,
  label,
  pulse,
}: {
  tone: "ok" | "warn" | "danger" | "neutral" | "info";
  label: string;
  pulse?: boolean;
}) {
  const colour = {
    ok: "bg-native-ok",
    warn: "bg-native-warn",
    danger: "bg-native-danger",
    info: "bg-native-cyan",
    neutral: "bg-native-text-dim",
  }[tone];

  return (
    // Block-level by design. As an inline-flex these stacked into one line when
    // several were placed in a `space-y-3` container, so two unrelated facts ran
    // together — "1 member disabled — local XR still works for them• 3 providers
    // allowed by policy" — which reads as one sentence and is wrong. `w-fit` keeps
    // a row from stretching, and the label is allowed to wrap because some of
    // these are a full sentence and nowrap would push them out of the panel.
    <span className="flex w-fit max-w-full items-start gap-2">
      <span className={cn("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", colour, pulse && "animate-pulse")} />
      <span className="text-[12px] leading-relaxed text-native-text-muted">{label}</span>
    </span>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("console-panel overflow-hidden", className)}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-native-border px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-native-text">{title}</h2>
            {description ? (
              <p className="mt-0.5 max-w-2xl text-[11.5px] leading-relaxed text-native-text-dim">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function ConsoleButton({
  children,
  onClick,
  href,
  variant = "default",
  disabled,
  busy,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  title?: string;
}) {
  /**
   * A disabled control keeps its own label.
   *
   * Nine pages originally swapped their caption for "Read-only" in demo mode,
   * which produced screens where two neighbouring buttons read "Read-only" and
   * the thing being disabled could not be identified. The label describes the
   * action; the disabled state describes whether it can run here, and the title
   * says why.
   */
  const cls = cn(
    "console-focus inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
    variant === "primary" && "bg-native-cyan text-[#02222a] hover:bg-native-cyan-soft",
    variant === "default" && "border border-native-border-strong text-native-text hover:border-native-cyan/50 hover:text-native-cyan",
    variant === "danger" && "border border-native-danger/40 text-native-danger hover:bg-native-danger/10",
  );

  const body = (
    <>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {children}
    </>
  );

  const hint = disabled ? (title ?? "Read-only: this console is showing example data, not a live team.") : title;

  if (href) {
    return (
      <Link href={href} className={cls} title={hint}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={cls} title={hint}>
      {body}
    </button>
  );
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-native-border">
            {head.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-wider text-native-text-dim"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn("console-row align-top hover:bg-white/[0.015]", className)}>{children}</tr>;
}

export function Cell({
  children,
  mono,
  dim,
  className,
}: {
  children: React.ReactNode;
  mono?: boolean;
  dim?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-4 py-3 text-[12px] leading-relaxed",
        mono && "console-mono text-[11.5px]",
        dim ? "text-native-text-dim" : "text-native-text-muted",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-[13px] text-native-text-muted">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[11.5px] leading-relaxed text-native-text-dim">{body}</p>
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger";
  title: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "info" ? Info : tone === "warn" ? AlertTriangle : ShieldAlert;
  const border = {
    info: "border-native-border",
    warn: "border-native-warn/35",
    danger: "border-native-danger/35",
  }[tone];
  const icon = {
    info: "text-native-cyan",
    warn: "text-native-warn",
    danger: "text-native-danger",
  }[tone];

  return (
    <div className={cn("rounded-lg border bg-native-bg-elevated/60 p-4", border)}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", icon)} />
        <div>
          <p className="text-[12.5px] font-medium text-native-text">{title}</p>
          <div className="mt-1.5 text-[11.5px] leading-relaxed text-native-text-muted">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Meta({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-native-text-dim">{label}</div>
      <div className={cn("mt-1 text-[12.5px] text-native-text", mono && "console-mono text-[11.5px]")}>{value}</div>
    </div>
  );
}

/** The banner that tells the truth when the API is not reachable. */
export function DemoBanner({ reason }: { reason: string }) {
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-native-warn/35 bg-native-warn/[0.06] px-4 py-3">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-native-warn" />
      <div>
        <p className="text-[12.5px] font-medium text-native-text">Showing example data</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-native-text-muted">
          {reason} The layout, labels and states below are real; the rows are not. Every value here is
          read-only until the console is connected to a live cloud service.
        </p>
      </div>
    </div>
  );
}

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-native-text">{title}</h1>
        <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-native-text-muted">{subtitle}</p>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
