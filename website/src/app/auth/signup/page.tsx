"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, Check, AlertTriangle } from "lucide-react";

import { CloudError, cloud, cloudConfigured } from "@/lib/cloud";
import { businessPricing } from "@/lib/native";

/**
 * `/auth/signup` — create an organization and start the trial.
 *
 * The form asks for a team name rather than a company name, because a large share
 * of XR teams are three people who never named anything. Requiring a legal entity
 * name here would be a form field that exists to make a database column look
 * tidy.
 *
 * `?intent=business` changes the surrounding copy only. It does not change the
 * request, and it does not pre-select anything: the trial starts because a person
 * is creating a team, which is unambiguous. A query parameter that silently
 * enrols someone in a paid plan is the kind of dark pattern this release is
 * explicitly against.
 */
function SignupForm() {
  const intent = useSearchParams().get("intent");
  const businessIntent = intent === "business";

  const [form, setForm] = useState({ orgName: "", name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; repair: string | null } | null>(null);
  const [done, setDone] = useState<{ orgName: string; slug: string; trialDays: number } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const result = await cloud.signup({
        email: form.email,
        name: form.name || undefined,
        orgName: form.orgName,
        password: form.password || undefined,
      });
      setDone({ orgName: result.org.name, slug: result.org.slug, trialDays: result.trialEndsInDays });
      // Full navigation so the httpOnly session cookie is applied before the
      // console mounts.
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 900);
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

  if (done) {
    return (
      <div className="rounded-xl border border-native-cyan/30 bg-native-bg-elevated/70 p-7">
        <div className="flex items-center gap-2.5">
          <Check className="h-4 w-4 text-native-ok" />
          <h1 className="text-[17px] font-semibold text-native-text">{done.orgName} is ready</h1>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-native-text-muted">
          Your {done.trialDays}-day Business trial has started — no card, {businessPricing.trialMaxSeats} seats
          maximum. Taking you to the console…
        </p>
        <p className="console-mono mt-4 text-[11px] text-native-text-dim">{done.slug}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-native-border bg-native-bg-elevated/70 p-7">
      <h1 className="text-[17px] font-semibold text-native-text">
        {businessIntent ? "Start your Business trial" : "Create a team"}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-native-text-muted">
        {businessIntent
          ? `${businessPricing.trialDays} days, up to ${businessPricing.trialMaxSeats} seats, no payment method. XR on each person's machine keeps working whether or not you convert.`
          : "Adds shared workspaces, SSO and an audit trail for a group of people. Everything local stays free."}
      </p>

      {!cloudConfigured ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-native-warn/30 bg-native-warn/5 p-3.5 text-[12px] leading-relaxed text-native-text-muted">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-native-warn" />
          <span>
            No cloud API is configured for this deployment, so this form cannot submit. Everything you can
            download and run is unaffected.
          </span>
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field
          id="orgName"
          label="Team name"
          placeholder="Acme Labs"
          value={form.orgName}
          onChange={(v) => setForm({ ...form, orgName: v })}
          required
          hint="You can change this later. Two teams with the same name is fine."
        />
        <Field
          id="name"
          label="Your name"
          placeholder="Optional"
          value={form.name}
          onChange={(v) => setForm({ ...form, name: v })}
        />
        <Field
          id="email"
          type="email"
          label="Work email"
          placeholder="you@company.com"
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
          required
        />
        <Field
          id="password"
          type="password"
          label="Password"
          placeholder="At least 12 characters"
          value={form.password}
          onChange={(v) => setForm({ ...form, password: v })}
          hint="Optional. Without one you sign in by email link, which is what most people do."
        />

        <button
          type="submit"
          disabled={busy || !cloudConfigured}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-native-cyan text-[13px] font-medium text-[#02222a] transition hover:bg-native-cyan-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Create team and start trial
          {!busy ? <ArrowRight className="h-3.5 w-3.5" /> : null}
        </button>
      </form>

      {problem ? (
        <div className="mt-5 rounded-lg border border-native-danger/30 bg-native-danger/5 p-3.5">
          <p className="text-[12.5px] text-native-text">{problem.message}</p>
          {problem.repair ? <p className="mt-1 text-[11.5px] leading-relaxed text-native-text-muted">{problem.repair}</p> : null}
        </div>
      ) : null}

      <p className="mt-5 text-[11.5px] leading-relaxed text-native-text-dim">
        By creating a team you agree to the{" "}
        <Link href="/legal/terms" className="text-native-text-muted hover:text-native-cyan">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className="text-native-text-muted hover:text-native-cyan">
          privacy policy
        </Link>
        . We send one confirmation email and nothing else unless you ask.
      </p>

      <div className="mt-6 border-t border-native-border pt-5 text-[12px]">
        <Link href="/auth/signin" className="text-native-cyan hover:underline">
          Already have a team? Sign in
        </Link>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-medium text-native-text-muted">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="console-focus mt-1.5 h-10 w-full rounded-lg border border-native-border bg-native-bg px-3 text-[13px] text-native-text placeholder:text-native-text-dim"
      />
      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-native-text-dim">{hint}</p> : null}
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="h-96 rounded-xl border border-native-border bg-native-bg-elevated/70" />}>
      <SignupForm />
    </Suspense>
  );
}
