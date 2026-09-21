import { useCallback, useEffect, useState } from "react";

type Toast = { id: number; kind: "ok" | "warn" | "err" | "info"; title: string; msg?: string };
let PUSH: ((t: Omit<Toast, "id">) => void) | null = null;
let nid = 0;

export function pushToast(kind: Toast["kind"], title: string, msg?: string) {
  PUSH?.({ kind, title, msg });
}

export function ToastBus() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setToasts((cur) => cur.filter((t) => t.id !== id)), []);

  useEffect(() => {
    PUSH = (t) => {
      const id = ++nid;
      setToasts((cur) => [...cur, { id, ...t }]);
      setTimeout(() => remove(id), 3200);
    };
    return () => { PUSH = null; };
  }, [remove]);

  return (
    <div className="xr-toast-host" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`xr-toast xr-toast--${t.kind}`} onClick={() => remove(t.id)}>
          <div>
            <strong>{t.title}</strong>
            {t.msg && <span>{t.msg}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
