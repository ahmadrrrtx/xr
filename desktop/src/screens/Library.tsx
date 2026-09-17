import { useEffect, useState } from "react";
import { api, asList, type ProviderInfo } from "../api/client";

const TABS = ["Skills", "MCP", "Plugins", "Models"] as const;

export function Library() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Models");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "Models") return;
    api.providers().then((v) => {
      setProviders(asList<ProviderInfo>(v, "providers"));
      setActive(typeof (v as { active?: string }).active === "string" ? (v as { active: string }).active : null);
    }).catch(() => setProviders([]));
  }, [tab]);

  return (
    <div className="lib">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "Models" && (
        <>
          <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
            Model Center — connect providers, test models, set primary. Keys go to the OS keyring (engine-side only).
          </p>
          {note && <div className="errline mono" style={{ borderColor: "var(--xr-border)" }}>{note}</div>}
          <div className="cards">
            {providers.map((p) => (
              <div key={p.id} className="card prov">
                <div className="t">
                  {p.id}
                  {active === p.id && <span className="chip green">primary</span>}
                  {p.local && <span className="chip">local</span>}
                </div>
                <div className="meta mono faint">{(p.capabilities ?? []).slice(0, 4).join(" · ") || "—"}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="btn"
                    onClick={() => api.providersSet(p.id).then(() => { setActive(p.id); setNote(`primary → ${p.id}`); }).catch((e) => setNote(String(e)))}
                  >
                    Set primary
                  </button>
                  <button
                    className="btn"
                    onClick={() => api.modelsTest(p.id, String((p.models ?? [])[0] ?? "")).then((r) => setNote(`${p.id}: ${r.ok === false ? "FAILED" : "ok"}`)).catch((e) => setNote(`${p.id}: ${e}`))}
                  >
                    Test
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "Skills" && (
        <div className="empty">Skills library — 65 bundled skills become a discoverable library in Phase 3 (search, categories, permission badges, run/configure).</div>
      )}
      {tab === "MCP" && (
        <div className="empty">MCP connections — connect/grants/health/pinning land in Phase 3–4 (SEC-01 rug-pull defense).</div>
      )}
      {tab === "Plugins" && (
        <div className="empty">Plugins — signed install + sandbox status land in Phase 3.</div>
      )}
    </div>
  );
}
