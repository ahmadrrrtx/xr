const categories = [
  ["Developer", "Full stack, React, Next.js, Python, Rust, DevOps, testing, debugging, performance, architecture."],
  ["Business", "Startup, marketing, SEO, sales, CRM, proposals, negotiation, support, project and product management."],
  ["Security", "SOC, malware, threat hunting, incident response, OSINT, pentest assistance, code audit, privacy."],
  ["Research", "Deep research, academic research, paper analysis, patents, market research, competitive intelligence."],
  ["Creative", "UI, UX, logo, brand, copywriting, video scripts, content, story, presentations, social media."],
];

const features = [
  "Browse, search, categories, collections, featured, trending, recent, installed, favorites",
  "Skill pages with docs, examples, dependencies, permissions, compatibility, versions, ratings, reviews",
  "Install, update, remove, enable, disable, clone, share, export, import, publish, fork, verify, pin, rollback",
  "Automatic runtime discovery with progressive disclosure and permission-aware context loading",
  "SDK commands: create, validate, package, publish, test, install, update, doctor",
  "Local-first registry with auditable permissions and no hidden behavior",
];

export default function SkillsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#070A12", color: "#EAF2FF", fontFamily: "Inter, ui-sans-serif, system-ui", padding: 32 }}>
      <section style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "inline-flex", gap: 8, border: "1px solid rgba(0,212,255,.35)", color: "#00D4FF", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>XR Stage 13 · Skills Marketplace</div>
        <h1 style={{ fontSize: 56, lineHeight: 1, margin: "22px 0 14px", letterSpacing: "-.04em" }}>Make XR smarter without writing code.</h1>
        <p style={{ maxWidth: 820, color: "#AAB7CF", fontSize: 18, lineHeight: 1.7 }}>
          XR Skills are professional capabilities: instructions, reasoning policy, knowledge, tools, MCP requirements, workflows, voice actions, UI panels, tests, examples, memory templates, settings, and auditable permissions.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
          <code style={pill}>xr skill browse</code>
          <code style={pill}>xr skill install react_expert</code>
          <code style={pill}>xr skill create "My Expert"</code>
          <code style={pill}>xr skill doctor</code>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16, marginTop: 40 }}>
          {categories.map(([name, text]) => (
            <article key={name} style={card}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{name}</h2>
              <p style={{ color: "#AAB7CF", lineHeight: 1.6 }}>{text}</p>
            </article>
          ))}
        </div>

        <section style={{ marginTop: 46, display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(280px,.9fr)", gap: 18 }}>
          <article style={card}>
            <h2 style={{ marginTop: 0 }}>Marketplace capability</h2>
            <ul style={{ color: "#B9C6DC", lineHeight: 1.9, paddingLeft: 20 }}>
              {features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
          </article>
          <article style={{ ...card, borderColor: "rgba(0,255,136,.28)", boxShadow: "0 0 40px rgba(0,255,136,.08)" }}>
            <h2 style={{ marginTop: 0 }}>Trust model</h2>
            <p style={{ color: "#B9C6DC", lineHeight: 1.8 }}>
              Every Skill declares permissions for filesystem, network, MCP, plugins, memory, providers, voice, and computer control. Dangerous permissions require explicit approval and remain auditable.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {["Official", "Verified", "Reviewed", "Community"].map((badge) => <span key={badge} style={badgeStyle}>{badge}</span>)}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

const pill: React.CSSProperties = {
  background: "rgba(0,212,255,.09)",
  border: "1px solid rgba(0,212,255,.25)",
  color: "#8DEAFF",
  borderRadius: 10,
  padding: "10px 12px",
};

const card: React.CSSProperties = {
  background: "linear-gradient(180deg,rgba(17,24,39,.96),rgba(13,17,23,.96))",
  border: "1px solid rgba(255,255,255,.09)",
  borderRadius: 18,
  padding: 22,
  boxShadow: "0 16px 60px rgba(0,0,0,.28)",
};

const badgeStyle: React.CSSProperties = {
  border: "1px solid rgba(0,255,136,.28)",
  color: "#00FF88",
  background: "rgba(0,255,136,.08)",
  borderRadius: 10,
  padding: "8px 10px",
  textAlign: "center",
  fontWeight: 700,
};
