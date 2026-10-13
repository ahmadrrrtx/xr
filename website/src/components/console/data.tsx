"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { CloudError, cloud, cloudConfigured, type Entitlement, type Me, type Team } from "@/lib/cloud";
import { demoEntitlement, demoTeam } from "@/lib/console-demo";

/**
 * Console data context.
 *
 * One fetch of `me` + `teams` + `license/me` feeds the entire console, because
 * those three answers are what every page needs in order to render its own state:
 * which org, what role, and whether the subscription is live.
 *
 * ## The role gating decision
 *
 * `role` here decides what the console *shows*. It never decides what the API
 * *allows* — every mutating route re-reads membership from the database on the
 * request. That redundancy is intentional and it is worth being explicit about
 * why the client bothers at all: hiding a control someone cannot use is a
 * courtesy, not a security control. A member who crafts the request anyway gets a
 * 403 with a repair string, and an audit entry recording that they tried.
 *
 * `can()` returns false for `member` on every administrative action, including
 * ones a member might reasonably expect (reading the audit log). That matches the
 * server, which requires owner-or-admin for reads as well as writes.
 */

interface ConsoleState {
  status: "loading" | "ready" | "unauthenticated" | "unavailable" | "demo";
  me: Me | null;
  team: Team | null;
  entitlement: Entitlement | null;
  /** True when the rows on screen are examples rather than live data. */
  demo: boolean;
  demoReason: string | null;
  role: "owner" | "admin" | "member" | null;
  can: (action: "admin" | "owner" | "billing") => boolean;
  reload: () => void;
  error: CloudError | null;
}

const ConsoleContext = createContext<ConsoleState | null>(null);

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConsoleState["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [demoReason, setDemoReason] = useState<string | null>(null);
  const [error, setError] = useState<CloudError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!cloudConfigured) {
        if (cancelled) return;
        setMe(null);
        setTeam(demoTeam);
        setEntitlement(demoEntitlement);
        setDemoReason("This deployment has no cloud API configured, so there is nothing live to read.");
        setState("demo");
        return;
      }

      try {
        const whoami = await cloud.me();
        if (cancelled) return;
        setMe(whoami);

        const teams = await cloud.teams();
        if (cancelled) return;
        const first = teams.teams[0] ?? null;
        setTeam(first);

        if (!first) {
          // Signed in, but in no organization. A real and unremarkable state.
          setState("ready");
          return;
        }

        const entitlements = await cloud.entitlement();
        if (cancelled) return;
        setEntitlement(entitlements);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CloudError && err.status === 401) {
          setState("unauthenticated");
          return;
        }
        // Anything else — network, DNS, a 500 — is shown as example data with the
        // reason stated. Rendering an empty console would hide a real outage, and
        // rendering a crash would be useless in a screenshot.
        setError(err instanceof CloudError ? err : null);
        setTeam(demoTeam);
        setEntitlement(demoEntitlement);
        setDemoReason(
          err instanceof CloudError && err.status !== 0
            ? `The cloud service answered ${err.status}.`
            : "The cloud service could not be reached from this browser.",
        );
        setState("demo");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const role = team?.role ?? null;

  const can = useCallback(
    (action: "admin" | "owner" | "billing") => {
      if (!role) return false;
      if (action === "owner") return role === "owner";
      if (action === "billing") return role === "owner" || role === "admin";
      return role === "owner" || role === "admin";
    },
    [role],
  );

  const value = useMemo<ConsoleState>(
    () => ({
      status: state,
      me,
      team,
      entitlement,
      demo: state === "demo",
      demoReason,
      role,
      can,
      reload: () => setNonce((n) => n + 1),
      error,
    }),
    [state, me, team, entitlement, demoReason, role, can, error],
  );

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}

export function useConsole(): ConsoleState {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error("useConsole must be used inside ConsoleProvider");
  return ctx;
}

/**
 * Load a page-level resource with the same demo fallback as the shell.
 *
 * `fallback` is required rather than optional on purpose: if a caller cannot
 * supply plausible example data, that is a sign the page has not been designed
 * against a real response yet.
 */
export function useResource<T>(
  key: string,
  load: (orgId: string) => Promise<T>,
  fallback: T,
): { data: T; live: boolean; loading: boolean; error: string | null; setData: (next: T) => void } {
  const { team, demo, status } = useConsole();
  /**
   * `fallback` is read through a ref, and this is load-bearing.
   *
   * Callers pass an object literal — `{ members: demoMembers }` — which is a new
   * reference on every render. When the effect below listed `fallback` as a
   * dependency it therefore re-ran after every render, and because the demo
   * branch calls `setData(fallback)` with that new reference, state changed every
   * time: an infinite render loop that pegged a core and never fired `load`.
   *
   * The live path had the same shape with a worse symptom — a refetch per render,
   * forever, against a real server.
   *
   * The ref keeps "use the newest example data" without making object identity a
   * trigger. What actually changes what this hook should do is the key, the team,
   * the demo flag and the shell's status, and those are the dependencies.
   */
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const [data, setData] = useState<T>(fallback);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    if (demo || !team) {
      setData(fallbackRef.current);
      setLive(false);
      setLoading(status === "loading");
      return () => {
        cancelled = true;
      };
    }

    load(team.id)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLive(true);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(fallbackRef.current);
        setLive(false);
        setError(err instanceof CloudError ? err.message : "Could not load this view.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `load` and `fallback` are both intentionally excluded: callers pass an
    // inline closure and an inline object literal, so depending on either would
    // refetch (or re-render) on every render. See the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, team?.id, demo, status]);

  return { data, live, loading, error, setData };
}
