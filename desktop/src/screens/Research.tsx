import { useState } from "react";
import { Icon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";
import { CodeEditor } from "../components/Editor";

type Source = {
  id: string; domain: string; title: string; snippet: string; url: string;
  favicon?: string; cited?: boolean;
};

const SAMPLE_SOURCES: Source[] = [
  { id: "s1", domain: "cursor.com/blog", title: "How Cursor's agent mode does per-hunk diff review", snippet: "Cursor 0.45 introduced composer-style multi-file edits, allowing the user to accept or reject each individual hunk before it's applied…", url: "#", cited: true },
  { id: "s2", domain: "code.visualstudio.com", title: "Copilot Chat in VS Code — Edit Sessions", snippet: "The inline chat (⌘K) lets users see proposed changes in the editor with colored gutter markers, then apply or discard per-chunk…", url: "#", cited: true },
  { id: "s3", domain: "arxiv.org/abs/2503.12345", title: "SWE-bench multi-agent: 74% pass rate with planner-verifier teams", snippet: "Recent work shows that splitting coding tasks across specialized agents (planner, coder, tester, reviewer) improves success by 22% over single-agent baselines…", url: "#" },
  { id: "s4", domain: "vercel.com/blog", title: "v0: Generating production React from natural language", snippet: "v0 uses shadcn/ui primitives and a preview-on-the-right layout to let users iterate visually on components before exporting…", url: "#", cited: true },
  { id: "s5", domain: "arxiv.org/abs/2507.07120", title: "Trust by default? A study of AI IDE approval interfaces", snippet: "Users approve 91% of tool-use requests in AI IDEs when the countdown is less than 10 seconds, suggesting urgency bias…", url: "#" },
  { id: "s6", domain: "zed.dev/blog", title: "Building collaboration-first AI assistants", snippet: "Zed's assistant panel pins to the right and always shows the current plan as an outline, rather than a chat transcript…", url: "#" },
];

const SAMPLE_REPORT = `# Q3 AI IDE Landscape — Summary

The AI coding-assistant market consolidated sharply in Q3. Three patterns dominate the best products today:

## 1. Editor is primary, chat is secondary
Every top tool treats the editor as the source of truth and chat as a side panel — not a chat window that happens to have an editor attached. Cursor, Zed, and the latest Copilot all keep the cursor in the file and stream proposed changes directly as inline diffs [1][2].

## 2. Plan → Approve → Apply is the new default
Instead of immediately editing files, modern agents show a step-by-step plan first, pause for approval, then apply changes hunk-by-hunk with per-change review [1][3]. This reduces "surprise edits" and is now the UX baseline for trust.

## 3. Multi-agent teams outperform single agents
Planner/Coder/Tester/Reviewer teams are hitting 74% on SWE-bench vs ~52% for single-agent baselines. The cost overhead is ~2×, but the success-rate gain justifies it for non-trivial tasks [3].

## Risks & open questions
- **Urgency bias**: 91% of approval requests with <10s countdowns get approved without reading — a safety problem XR should avoid by defaulting to longer timeouts or manual-approve for high-risk actions [5].
- **Preview-first UIs**: v0 and Bolt put a live preview on the right side; XR should consider a split layout for front-end tasks [4].
- **Cost transparency**: Users consistently prefer per-run cost ($0.04 · 34k tokens) over monthly totals only; XR already shows both.

## Recommendation
Ship Phase 2 with plan-first, per-hunk diffs, longer approval TTLs by default (30s low-risk / 60s high-risk), and explicit "always allow per project" rules. Reserve multi-agent for longer tasks (>2min ETA) to keep the simple path fast.
`;

type Tab = "report" | "findings" | "sources";

export function Research() {
  const [tab, setTab] = useState<Tab>("report");
  const [query, setQuery] = useState("Q3 AI IDE landscape — competitors, UX patterns, trust");
  const [phase, setPhase] = useState<"idle"|"searching"|"reading"|"writing"|"done">("done");

  return (
    <div className="xr-page" style={{ display: "flex", flexDirection: "column" }}>
      <div className="xr-page-head" style={{ paddingBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Research</h1>
          <p className="xr-subtitle">XR reads sources, cites evidence, and writes a report you can trust.</p>
        </div>
      </div>

      <div style={{ padding: "0 24px 12px", display: "flex", gap: 8 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Icon.Search width={15} height={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--xr-muted)" }}/>
          <input className="xr-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Ask a research question…" style={{ paddingLeft: 36, fontFamily: "var(--xr-font-mono)", fontSize: 13 }}/>
        </div>
        <button className="xr-btn xr-btn--primary" onClick={() => { setPhase("searching"); setTimeout(() => setPhase("reading"), 1500); setTimeout(() => setPhase("writing"), 3500); setTimeout(() => setPhase("done"), 5500); }}>
          {phase === "done" ? <><Icon.RotateCw width={13} height={13}/> Re-research</> : <><Icon.Sparkles width={13} height={13}/> Research</>}
        </button>
      </div>

      {phase !== "idle" && phase !== "done" && (
        <div style={{ padding: "0 24px 12px" }}>
          <div className="xr-alert" style={{ background: "var(--xr-surface)", border: "1px solid var(--xr-border)" }}>
            <StatusDot kind="info" pulse size={10}/>
            <span style={{ fontSize: 12.5 }}>
              {phase === "searching" && "Searching the web for sources…"}
              {phase === "reading" && `Reading ${SAMPLE_SOURCES.length} sources…`}
              {phase === "writing" && "Writing report with citations…"}
            </span>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "320px 1fr 360px", minHeight: 0 }}>
        {/* Sources column */}
        <div style={{ borderRight: "1px solid var(--xr-border)", overflowY: "auto", padding: 12 }}>
          <div className="xr-section-header" style={{ padding: "4px 4px 10px" }}><h3>Sources <span style={{ color: "var(--xr-muted)", fontWeight: 400, fontSize: 12 }}>({SAMPLE_SOURCES.length})</span></h3></div>
          {SAMPLE_SOURCES.map(s => (
            <div key={s.id} className="xr-source-card">
              <div className="domain">{s.domain}</div>
              <div className="title">{s.title}{s.cited && <span className="xr-citation-chip">[{SAMPLE_SOURCES.indexOf(s)+1}]</span>}</div>
              <div className="snippet">{s.snippet}</div>
            </div>
          ))}
        </div>

        {/* Center: report / findings */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="xr-tabs xr-tabs--sub" style={{ padding: "0 20px" }}>
            <button className={"xr-tab" + (tab === "report" ? " active" : "")} aria-selected={tab === "report"} onClick={() => setTab("report")}>Report</button>
            <button className={"xr-tab" + (tab === "findings" ? " active" : "")} aria-selected={tab === "findings"} onClick={() => setTab("findings")}>Findings</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
            {tab === "report" && (
              <div className="xr-report-view">
                <CodeEditor value={SAMPLE_REPORT} ext="md" readOnly/>
              </div>
            )}
            {tab === "findings" && (
              <div className="xr-finding-list">
                {[
                  { t: "Plan-first UX is now table stakes", c: "Every top AI IDE in Q3 shows a plan before editing. Users distrust agents that immediately start writing files." },
                  { t: "Per-hunk diff review converts 2× better", c: "Cursor and Copilot report higher acceptance rates when users can reject individual hunks rather than entire files." },
                  { t: "Urgency bias is real at <10s TTLs", c: "91% of approvals are rubber-stamped when the countdown is below 10 seconds. XR defaults to 30s for low-risk, 60s for high-risk." },
                  { t: "Multi-agent wins on hard tasks only", c: "2× cost overhead is hard to justify for sub-2min tasks. Reserve planner/coder/tester split for tasks estimated >2 minutes." },
                ].map((f, i) => (
                  <div key={i} className="xr-finding">
                    <div className="xr-finding-n">{String(i+1).padStart(2,"0")}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{f.t}</div>
                      <div className="xr-dim" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{f.c}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: outline + citations */}
        <div style={{ borderLeft: "1px solid var(--xr-border)", padding: 16, overflowY: "auto", background: "var(--xr-bg-2)" }}>
          <div className="xr-section-header" style={{ padding: "0 0 10px" }}><h3>Outline</h3></div>
          <ul className="xr-outline" style={{ listStyle: "none", padding: 0, margin: "0 0 20px", fontSize: 12 }}>
            <li style={{ padding: "4px 0", color: "var(--xr-primary)" }}>Summary</li>
            <li style={{ padding: "4px 0 4px 12px" }} className="xr-dim">1. Editor primary, chat secondary</li>
            <li style={{ padding: "4px 0 4px 12px" }} className="xr-dim">2. Plan → Approve → Apply</li>
            <li style={{ padding: "4px 0 4px 12px" }} className="xr-dim">3. Multi-agent teams</li>
            <li style={{ padding: "4px 0" }} className="xr-dim">Risks & open questions</li>
            <li style={{ padding: "4px 0" }} className="xr-dim">Recommendation</li>
          </ul>

          <div className="xr-section-header" style={{ padding: "0 0 10px" }}><h3>Cited works</h3></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {SAMPLE_SOURCES.filter(s => s.cited).map((s, i) => (
              <div key={s.id} style={{ fontSize: 11.5 }}>
                <span className="xr-citation-chip">[{i+1}]</span> <a style={{ color: "var(--xr-text)", textDecoration: "none" }}>{s.title}</a>
                <div className="xr-dim" style={{ fontSize: 10.5 }}>{s.domain}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
            <button className="xr-btn xr-btn--sm xr-btn--primary" style={{ flex: 1 }}><Icon.Copy width={12} height={12}/> Copy report</button>
            <button className="xr-btn xr-btn--sm xr-btn--ghost">Export MD</button>
          </div>
        </div>
      </div>
    </div>
  );
}
