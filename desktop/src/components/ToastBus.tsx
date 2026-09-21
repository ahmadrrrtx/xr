import { useCallback, useEffect, useState } from "react";
import { Icon } from "./icons";

type Toast = { id: number; kind: "ok" | "warn" | "err" | "info"; title: string; msg?: string; action?: { label: string; run: () => void } };
let PUSH: ((t: Omit<Toast, "id">) => void) | null = null;
let nid = 0;

export function pushToast(kind: Toast["kind"], title: string, msg?: string, action?: Toast["action"]) {
  PUSH?.({ kind, title, msg, action });
}

export function ToastBus() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setToasts((cur) => cur.filter((t) => t.id !== id)), []);

  useEffect(() => {
    PUSH = (t) => {
      const id = ++nid;
      setToasts((cur) => [...cur, { id, ...t }]);
      setTimeout(() => remove(id), 4200);
    };
    return () => { PUSH = null; };
  }, [remove]);

  return (
    <div className="xr-toast-host" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`xr-toast xr-toast--${t.kind}`}>
          <div style={{ flex: 1 }}>
            <strong>{t.title}</strong>
            {t.msg && <span>{t.msg}</span>}
          </div>
          {t.action && (
            <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={(e) => { e.stopPropagation(); t.action?.run(); remove(t.id); }}>
              {t.action.label}
            </button>
          )}
          <button className="xr-btn xr-btn--icon xr-btn--sm" onClick={(e) => { e.stopPropagation(); remove(t.id); }} style={{ marginLeft: 4 }}>
            <Icon.X width={12} height={12}/>
          </button>
        </div>
      ))}
    </div>
  );
}
