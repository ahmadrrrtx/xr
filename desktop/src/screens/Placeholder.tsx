import { Icon } from "../components/icons";

export function Placeholder({ title, subtitle, comingSoon }: { title: string; subtitle: string; comingSoon?: boolean }) {
  return (
    <div className="xr-page" style={{ display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <img src="/src/assets/xr-logo.png" alt="XR" style={{ width: 64, height: 64, objectFit: "contain", margin: "0 auto 20px", filter: "drop-shadow(0 0 18px rgba(0,212,255,0.4))" }}/>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, fontFamily: "var(--xr-font-display)" }}>{title}</h1>
        <p style={{ color: "var(--xr-text-dim)", marginTop: 8, fontSize: 13 }}>{subtitle}</p>
        {comingSoon && (
          <div style={{ marginTop: 20 }}>
            <span className="xr-pill xr-pill--cyan" style={{ fontSize: 11 }}>
              <Icon.Layers width={11} height={11}/> Phase 1 shell · screen arriving in later phase
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
