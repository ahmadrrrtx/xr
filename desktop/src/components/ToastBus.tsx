import { useEffect, useRef, useState } from "react";
import { api, asList, type Approval, type SessionSummary } from "../api/client";

export interface Toast { id: number; kind: "ok" | "warn" | "bad" | "info"; title: string; body?: string }
let nextId = 1;

/** Local code (onboarding, palette…) can push toasts without prop-drilling. */
export function pushToast(kind: Toast["kind"], title: string, body?: string): void {
  window.dispatchEvent(new CustomEvent("xr-toast", { detail: { kind, title, body } }));
}

/**
 * Phase 1 · ToastBus — change-detection over REAL engine state only:
 * new pending approvals and session status transitions become toasts.
 * Polls /approvals + /sessions (same vocabulary every screen already uses);
 * never invents events, never computes policy.
 */
export function ToastBus() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenAppr = useRef<Set<string> | null>(null);
  const seenSess = useRef<Map<string, string> | null>(null);

  const push = (kind: Toast["kind"], title: string, body?: string) => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-4), { id, kind, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
  };

  useEffect(() => {
    const onLocal = (e: Event) => {
      const d = (e as CustomEvent<Partial<Toast>>).detail ?? {};
      push((d.kind as Toast["kind"]) ?? "info", String(d.title ?? ""), d.body);
    };
    window.addEventListener("xr-toast", onLocal);

    let live = true;
    const poll = () => {
      api.approvals().then((v) => {
        if (!live) return;
        const pending = asList<Approval>(v, "pending", "approvals");
        if (seenAppr.current === null) { seenAppr.current = new Set(pending.map((p) => p.id)); return; }
        for (const p of pending) {
          if (!seenAppr.current.has(p.id)) {
            seenAppr.current.add(p.id);
            push("warn", "Approval needed", String(p.tool ?? p.action ?? p.reason ?? "agent action").slice(0, 90));
          }
        }
      }).catch(() => {});
      api.sessions().then((v) => {
        if (!live) return;
        const sessions = asList<SessionSummary>(v, "sessions", "items");
        if (seenSess.current === null) { seenSess.current = new Map(sessions.map((s) => [s.id, String(s.status ?? "?")])); return; }
        for (const s of sessions) {
          const prev = seenSess.current.get(s.id);
          const now = String(s.status ?? "?");
          if (prev !== undefined && prev !== now) {
            seenSess.current.set(s.id, now);
            const name = (s.title || s.prompt?.slice(0, 60) || s.id) as string;
            if (/fail|error/.test(now)) push("bad", "Run failed", name);
            else if (/complet|done/.test(now)) push("ok", "Run completed", name);
            else if (/stop|cancel/.test(now)) push("info", "Run stopped", name);
          } else if (prev === undefined) {
            seenSess.current.set(s.id, now);
          }
        }
      }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { live = false; clearInterval(t); window.removeEventListener("xr-toast", onLocal); };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <i className="toast-dot" aria-hidden="true" />
          <div>
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-body">{t.body}</div>}
          </div>
          <button className="toast-x" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
