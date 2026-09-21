import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/icons";

/* File tree data — demo for Phase 1. Will wire to real project tree via API later. */
type Node = { name: string; type: "file" | "dir"; children?: Node[]; ext?: string; status?: "M" | "A" | "D"; open?: boolean };

const DEMO_TREE: Node[] = [
  {
    name: "src", type: "dir", open: true, children: [
      {
        name: "core", type: "dir", open: true, children: [
          { name: "agent.ts", type: "file", ext: "ts", status: "M" },
          { name: "runner.ts", type: "file", ext: "ts" },
          { name: "planner.ts", type: "file", ext: "ts" },
        ],
      },
      { name: "tools", type: "dir", children: [
        { name: "fs.ts", type: "file", ext: "ts" },
        { name: "shell.ts", type: "file", ext: "ts" },
      ]},
      { name: "utils", type: "dir", children: [
        { name: "retry.ts", type: "file", ext: "ts", status: "A" },
      ]},
      { name: "index.ts", type: "file", ext: "ts" },
    ]
  },
  { name: "skills", type: "dir", children: [] },
  { name: "test", type: "dir", children: [] },
  { name: "README.md", type: "file", ext: "md" },
  { name: "package.json", type: "file", ext: "json" },
  { name: "tsconfig.json", type: "file", ext: "json" },
];

type FileTab = { id: string; name: string; path: string; ext?: string; dirty?: boolean; active?: boolean; content?: string };

const SAMPLE_CODE: Record<string, string> = {
  "src/core/agent.ts": `// XR Agent Core — V2.1 Operator
import { Runner } from "./runner";
import { Planner } from "./planner";

export interface AgentConfig {
  model: string;
  maxRetries: number;
  trustMode: "locked" | "balanced" | "autonomous";
}

export class Agent {
  private runner: Runner;
  private planner: Planner;

  constructor(private config: AgentConfig) {
    this.runner = new Runner(config);
    this.planner = new Planner(config);
  }

  async execute(task: string): Promise<Result> {
    const plan = await this.planner.construct(task);
    // XR proposes: exponential backoff with jitter
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await this.runner.run(plan, task);
      } catch (err) {
        const backoff = Math.min(1000 * 2 ** attempt, 30000);
        const jitter = backoff * 0.2 * Math.random();
        await sleep(backoff + jitter);
      }
    }
    throw new Error(\`Task failed after \${this.config.maxRetries} attempts\`);
  }
}

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}`,
  "README.md": `# XR

The AI Agent You Can Actually Trust.

## Getting Started
\`\`\`
bun install
bun run dev
\`\`\`

See \`src/core/agent.ts\` for the main agent loop.`,
  "package.json": `{
  "name": "@rrrtx/xr",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts"
  }
}`,
};

const EXT_COLORS: Record<string, string> = {
  ts: "#3178C6", tsx: "#3178C6", js: "#F7DF1E", jsx: "#F7DF1E",
  json: "#FFB547", md: "#6048F8", css: "#00D4FF", html: "#FF4D5E",
  py: "#00FF88", rs: "#FF4D5E", go: "#4DA3FF",
};

function extColor(ext?: string) { return ext ? (EXT_COLORS[ext] ?? "var(--xr-text-dim)") : "var(--xr-text-dim)"; }

export function Workbench({ seed, onConsumed, defaultChatOpen = true }: { seed?: string | null; onConsumed?: () => void; defaultChatOpen?: boolean }) {
  const [tree] = useState<Node[]>(DEMO_TREE);
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set(["src", "src/core"]));
  const [tabs, setTabs] = useState<FileTab[]>([
    { id: "src/core/agent.ts", name: "agent.ts", path: "src/core/agent.ts", ext: "ts", active: true, dirty: true, content: SAMPLE_CODE["src/core/agent.ts"] },
    { id: "README.md", name: "README.md", path: "README.md", ext: "md", content: SAMPLE_CODE["README.md"] },
  ]);
  const [chatTab, setChatTab] = useState<"chat" | "plan" | "diffs">("chat");
  const [followsCursor, setFollowsCursor] = useState(true);
  const [composerValue, setComposerValue] = useState("");
  const [messages, setMessages] = useState<Array<{ who: "user" | "xr" | "system"; text: string; tools?: string[]; artifact?: { kind: string; name: string } }>>([
    { who: "system", text: "XR is ready. Open a file or tell XR what to do." },
  ]);
  const [thinking, setThinking] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeTab = useMemo(() => tabs.find(t => t.active) ?? tabs[0], [tabs]);

  // Seed from Home
  useEffect(() => {
    if (seed) { setComposerValue(seed); textareaRef.current?.focus(); onConsumed?.(); }
  }, [seed, onConsumed]);

  // Auto-scroll chat
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }); }, [messages, thinking]);

  const toggleDir = useCallback((path: string) => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const openFile = useCallback((path: string, node: Node) => {
    setTabs((cur) => {
      if (cur.find(t => t.id === path)) return cur.map(t => ({ ...t, active: t.id === path }));
      return [...cur.map(t => ({ ...t, active: false })), {
        id: path, name: node.name, path, ext: node.ext, content: SAMPLE_CODE[path] ?? `// ${node.name}\n// (demo content — file will load via engine API)\n\nexport {};\n`, active: true,
      }];
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((cur) => {
      const idx = cur.findIndex(t => t.id === id);
      const next = cur.filter(t => t.id !== id);
      if (cur[idx]?.active && next.length > 0) {
        const neighborIdx = Math.max(0, idx - 1);
        next[neighborIdx] = { ...next[neighborIdx], active: true };
      }
      return next;
    });
  }, []);

  const activateTab = useCallback((id: string) => {
    setTabs((cur) => cur.map(t => ({ ...t, active: t.id === id })));
  }, []);

  const send = useCallback(() => {
    const text = composerValue.trim();
    if (!text) return;
    setMessages((m) => [...m, { who: "user", text }]);
    setComposerValue("");
    setThinking(true);
    setChatTab("plan");
    setTimeout(() => {
      setThinking(false);
      setMessages((m) => [...m, {
        who: "xr",
        text: `Got it. I'll help with "${text.slice(0, 80)}". Review the plan I drafted and hit Start executing when you're ready.`,
        tools: ["Read files", "Edit files", "Run commands"],
        artifact: { kind: "plan", name: "execution-plan.md" },
      }]);
    }, 1100);
  }, [composerValue]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  const renderTree = (nodes: Node[], parentPath = "", depth = 0) => nodes.map((n) => {
    const path = parentPath ? `${parentPath}/${n.name}` : n.name;
    if (n.type === "dir") {
      const isOpen = openDirs.has(path);
      return (
        <div key={path}>
          <div className={`xr-tree-node ${isOpen ? "open" : ""}`} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => toggleDir(path)}>
            <Icon.ChevronRight width={12} height={12} className="chevron"/>
            <Icon.Folder width={14} height={14} className="ic" style={{ color: "var(--xr-warning)" }}/>
            <span className="name">{n.name}</span>
          </div>
          {isOpen && n.children && renderTree(n.children, path, depth + 1)}
        </div>
      );
    }
    return (
      <div key={path}
        className={`xr-tree-node ${activeTab?.id === path ? "active" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 + 20 }}
        onClick={() => openFile(path, n)}
        title={path}>
        <Icon.File width={14} height={14} className="ic" style={{ color: extColor(n.ext) }}/>
        <span className="name">{n.name}</span>
        {n.status && <span style={{
          marginLeft: 6, fontSize: 10, fontWeight: 700,
          color: n.status === "M" ? "var(--xr-warning)" : n.status === "A" ? "var(--xr-success)" : "var(--xr-error)",
        }}>{n.status}</span>}
      </div>
    );
  });

  return (
    <>
      {/* Explorer */}
      <div className="xr-explorer">
        <div className="xr-explorer-header">
          <span>Explorer</span>
          <div className="actions">
            <button className="xr-btn xr-btn--icon xr-btn--sm" title="New file"><Icon.Plus width={13} height={13}/></button>
            <button className="xr-btn xr-btn--icon xr-btn--sm" title="Collapse"><Icon.ChevronDown width={13} height={13}/></button>
          </div>
        </div>
        <input className="xr-search-files xr-input" placeholder="Search files…"/>
        <div className="xr-tree">{renderTree(tree)}</div>
        <div className="xr-explorer-section">
          <div className="xr-explorer-header"><span>Source Control</span></div>
          <div style={{ padding: "0 12px 8px", fontSize: 11.5, color: "var(--xr-muted)" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
              <Icon.GitBranch width={12} height={12}/>
              <span>main</span>
              <span className="xr-pill xr-pill--amber" style={{ marginLeft: "auto" }}>12 changes</span>
            </div>
            <div style={{ fontSize: 11, padding: "2px 18px" }}><span style={{ color: "var(--xr-warning)" }}>M</span> src/core/agent.ts</div>
            <div style={{ fontSize: 11, padding: "2px 18px" }}><span style={{ color: "var(--xr-success)" }}>A</span> src/utils/retry.ts</div>
          </div>
        </div>
      </div>

      {/* Editor area */}
      <div className="xr-editor-area">
        <div className="xr-tabbar">
          {tabs.map((t) => (
            <button key={t.id} className={`xr-editor-tab ${t.active ? "active" : ""}`} onClick={() => activateTab(t.id)}>
              <Icon.File width={13} height={13} style={{ color: extColor(t.ext), flexShrink: 0 }}/>
              <span className="tab-name">{t.name}</span>
              {t.dirty && <span className="dirty">●</span>}
              <span className="close" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><Icon.X width={12} height={12}/></span>
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 2, paddingRight: 6 }}>
            <button className="xr-btn xr-btn--icon xr-btn--sm" title="Split editor"><Icon.PanelRight width={14} height={14}/></button>
            <button className="xr-btn xr-btn--icon xr-btn--sm" onClick={() => setTerminalOpen(v => !v)} title="Toggle terminal (⌘J)">
              <Icon.PanelBottom width={14} height={14}/>
            </button>
          </div>
        </div>

        {activeTab && (
          <div className="xr-breadcrumbs">
            <span className="crumb">{activeTab.path}</span>
            <span className="spacer"/>
            <span>XR follows cursor</span>
          </div>
        )}

        <div className="xr-editor-pane">
          <CodeView content={activeTab?.content ?? ""} ext={activeTab?.ext}/>
        </div>

        {/* Terminal */}
        {terminalOpen && (
          <div className="xr-terminal-wrap">
            <div className="xr-terminal-head">
              <div className="tabs">
                <div className="term-tab active">zsh — xr</div>
                <div className="term-tab">output</div>
                <div className="term-tab">problems</div>
              </div>
              <div style={{ marginLeft: 8, color: "var(--xr-muted)" }}>+</div>
              <div className="actions">
                <button className="xr-btn xr-btn--icon xr-btn--sm" title="New terminal"><Icon.Plus width={12} height={12}/></button>
                <button className="xr-btn xr-btn--icon xr-btn--sm" onClick={() => setTerminalOpen(false)} title="Hide (⌘J)"><Icon.X width={12} height={12}/></button>
              </div>
            </div>
            <div className="xr-terminal-body">
              <div>
                <span className="prompt">xr@xr</span>
                <span style={{ color: "var(--xr-muted)" }}>:</span>
                <span className="path">~/xr</span>
                <span style={{ color: "var(--xr-muted)" }}>$ </span>
                <span>npm run typecheck</span>
              </div>
              <div style={{ color: "var(--xr-success)" }}>✓ 0 errors · 0 warnings · 12 files checked</div>
              <div style={{ marginTop: 4 }}>
                <span className="prompt">xr@xr</span>
                <span style={{ color: "var(--xr-muted)" }}>:</span>
                <span className="path">~/xr</span>
                <span style={{ color: "var(--xr-muted)" }}>$ </span>
                <span className="cursor"/>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* XR Chat panel */}
      <div className="xr-chat">
        <div className="xr-chat-head">
          <button
            className={`xr-follows-chip ${followsCursor ? "" : "off"}`}
            onClick={() => setFollowsCursor(v => !v)}
            title="XR follows your cursor / selection in the editor"
          >
            <span className="dot"/>
            {followsCursor ? "XR follows cursor" : "Pinned to file"}
          </button>
          <div className="xr-tabs xr-tab-list">
            {(["chat","plan","diffs"] as const).map(t => (
              <button key={t} className="xr-tab" aria-selected={chatTab === t} onClick={() => setChatTab(t)}>
                {t === "chat" ? "Chat" : t === "plan" ? "Plan" : "Diffs"}
              </button>
            ))}
          </div>
        </div>

        {chatTab === "chat" && (
          <>
            <div className="xr-chat-body" ref={chatRef}>
              {messages.map((m, i) => {
                if (m.who === "system") return (
                  <div key={i} className="xr-msg system"><div className="bubble">{m.text}</div></div>
                );
                return (
                  <div key={i} className={`xr-msg ${m.who}`}>
                    <div className="avatar">{m.who === "xr" ? "XR" : "You"}</div>
                    <div className="bubble">
                      {m.text}
                      {m.tools && m.tools.map(tc => (
                        <div key={tc} className="xr-tool-call">
                          <Icon.Sparkles width={13} height={13} className="ic"/>
                          <span className="tool-name">{tc}</span>
                          <span className="target"/>
                        </div>
                      ))}
                      {m.artifact && (
                        <div className="xr-artifact-chip">
                          <div className="art-icon"><Icon.File width={14} height={14}/></div>
                          <div className="meta">
                            <div className="title">{m.artifact.name}</div>
                            <div className="desc">{m.artifact.kind === "plan" ? "Execution plan" : "Artifact"} · preview</div>
                          </div>
                          <Icon.ChevronRight width={14} height={14} className="xr-dim"/>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {thinking && (
                  <div className="xr-msg xr">
                    <div className="avatar" style={{ padding: 0, overflow: "hidden" }}><img src="/src/assets/xr-avatar.png" alt="XR" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "var(--xr-radius-md)" }}/></div>
                  <div className="bubble"><span className="xr-streaming"><span/><span/><span/></span></div>
                </div>
              )}
            </div>
            <div className="xr-composer">
              <div className="xr-composer-inner">
                <textarea
                  ref={textareaRef}
                  className="xr-textarea"
                  rows={1}
                  value={composerValue}
                  onChange={(e) => { setComposerValue(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
                  onKeyDown={onKeyDown}
                  placeholder={activeTab ? `Ask XR about ${activeTab.name}…` : "Tell XR what to do…"}
                />
                <div className="xr-composer-foot">
                  <button className="xr-btn xr-btn--sm xr-btn--ghost" title="Attach"><Icon.Paperclip width={14} height={14}/></button>
                  <button className="xr-model-pill">
                    <span className="dot"/>
                    Claude Opus
                    <Icon.ChevronDown width={10} height={10}/>
                  </button>
                  <div className="spacer"/>
                  <span className="xr-keycap" title="Send (⌘↵)">↵</span>
                  <button className="xr-send-btn" onClick={send} disabled={!composerValue.trim()} title="Send message">
                    <Icon.Send width={13} height={13}/>
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 6, fontSize: 10.5, color: "var(--xr-muted)" }}>
                XR may produce inaccurate information. Press <span className="xr-keycap" style={{ margin: "0 3px" }}>⌘L</span> to focus chat.
              </div>
            </div>
          </>
        )}

        {chatTab === "plan" && (
          <PlanPanel onStart={() => { setChatTab("chat"); setMessages(m => [...m, { who: "system", text: "Executing plan…" }]); setThinking(true); setTimeout(() => { setThinking(false); setMessages(m => [...m, { who: "xr", text: "Done. Refactored the retry loop with exponential backoff + jitter. See diffs tab to review changes." }]); }, 1400); }}/>
        )}

        {chatTab === "diffs" && (
          <DiffsPanel/>
        )}
      </div>
    </>
  );
}

/* Simple code viewer with line numbers and basic token coloring */
function CodeView({ content, ext }: { content: string; ext?: string }) {
  const lines = content.split("\n");
  const diffAdd = new Set([13, 14, 15]); // demo — lines added by XR
  const diffDel = new Set<number>();
  return (
    <div style={{ display: "flex", height: "100%", overflow: "auto", fontFamily: "var(--xr-font-mono)", fontSize: 13, lineHeight: "21px" }}>
      <div style={{ padding: "10px 10px 10px 14px", color: "var(--xr-muted)", textAlign: "right", userSelect: "none", borderRight: "1px solid var(--xr-border)", minWidth: 52 }}>
        {lines.map((_, i) => (
          <div key={i} style={{ position: "relative" }}>
            {diffAdd.has(i) && <span style={{ position: "absolute", left: -14, top: 0, bottom: 0, width: 3, background: "var(--xr-success)" }}/>}
            {diffDel.has(i) && <span style={{ position: "absolute", left: -14, top: 0, bottom: 0, width: 3, background: "var(--xr-error)" }}/>}
            {i + 1}
          </div>
        ))}
      </div>
      <pre style={{ margin: 0, padding: "10px 16px", flex: 1, minWidth: 0, overflowX: "auto" }}>
        {lines.map((line, i) => {
          let cls = "";
          if (diffAdd.has(i)) cls = "xr-line-add";
          else if (diffDel.has(i)) cls = "xr-line-del";
          return (
            <div key={i} className={cls} style={{ position: "group-hunk" }}>
              <CodeLine text={line} ext={ext}/>
              {diffAdd.has(i) && <span style={{ position: "absolute", right: 14, display: "none", gap: 4 }} className="hunk-actions-inline">
                <button style={{ width: 20, height: 20, border: 0, borderRadius: 4, background: "rgba(0,255,136,0.2)", color: "var(--xr-success)", cursor: "pointer" }}>✓</button>
                <button style={{ width: 20, height: 20, border: 0, borderRadius: 4, background: "rgba(255,77,94,0.2)", color: "var(--xr-error)", cursor: "pointer" }}>✕</button>
              </span>}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function CodeLine({ text, ext }: { text: string; ext?: string }) {
  // Very lightweight token coloring for demo. Phase 2 swaps in Monaco/CodeMirror.
  if (ext === "ts" || ext === "tsx" || ext === "js") {
    const parts = text.split(/(\/\/.*$|import |from |export |async |await |class |function |const |let |var |return |if |else |for |while |throw |new |private |public |return |interface |type |true|false|null|undefined|void|"[^"]*"|'[^']*'|`[^`]*`|\b\d+\b)/g);
    return <>{parts.map((p, i) => {
      if (!p) return null;
      if (/^\/\/.*/.test(p)) return <span key={i} style={{ color: "#6B7A99", fontStyle: "italic" }}>{p}</span>;
      if (/^(import|from|export|async|await|class|function|const|let|var|return|if|else|for|while|throw|new|private|public|interface|type|void)$/.test(p)) return <span key={i} style={{ color: "#C792EA" }}>{p}</span>;
      if (/^(true|false|null|undefined)$/.test(p)) return <span key={i} style={{ color: "#FFB547" }}>{p}</span>;
      if (/^["'`]/.test(p)) return <span key={i} style={{ color: "#00FF88" }}>{p}</span>;
      if (/^\d+$/.test(p)) return <span key={i} style={{ color: "#FFB547" }}>{p}</span>;
      return <span key={i} style={{ color: "#E6EAF5" }}>{p}</span>;
    })}</>;
  }
  if (ext === "json") {
    return <span style={{ color: "#E6EAF5" }} dangerouslySetInnerHTML={{ __html: text
      .replace(/"([^"]+)":/g, '<span style="color:#6048F8">"$1"</span>:')
      .replace(/: "([^"]+)"/g, ': <span style="color:#00FF88">"$1"</span>')
      .replace(/: (true|false)/g, ': <span style="color:#FFB547">$1</span>')
    }}/>;
  }
  if (ext === "md") {
    if (text.startsWith("#")) return <span style={{ color: "var(--xr-primary)", fontWeight: 700 }}>{text}</span>;
    if (text.startsWith("```")) return <span style={{ color: "var(--xr-muted)" }}>{text}</span>;
    if (text.startsWith("##")) return <span style={{ color: "var(--xr-secondary)", fontWeight: 600 }}>{text}</span>;
  }
  return <span style={{ color: "#E6EAF5" }}>{text}</span>;
}

/* Plan tab */
function PlanPanel({ onStart }: { onStart: () => void }) {
  const [steps, setSteps] = useState([
    { id: 1, text: "Read src/core/agent.ts to understand the current retry logic", checked: true },
    { id: 2, text: "Refactor the execute loop to use exponential backoff with jitter", checked: true },
    { id: 3, text: "Add a sleep utility with cancellation support", checked: true },
    { id: 4, text: "Update imports and add type annotations for backoff params", checked: true },
    { id: 5, text: "Run typecheck to verify no errors", checked: true },
  ]);
  const [autoRun, setAutoRun] = useState(false);
  const toggle = (id: number) => setSteps(s => s.map(st => st.id === id ? { ...st, checked: !st.checked } : st));
  const edit = (id: number, text: string) => setSteps(s => s.map(st => st.id === id ? { ...st, text } : st));
  const addStep = () => setSteps(s => [...s, { id: Date.now(), text: "New step…", checked: false }]);
  const del = (id: number) => setSteps(s => s.filter(st => st.id !== id));

  return (
    <div className="xr-plan">
      <div className="xr-plan-intro">
        XR proposes this plan for your task. You can <b>add, reorder, uncheck, edit, or delete</b> steps before execution begins.
      </div>
      <div className="xr-plan-steps">
        {steps.map((s) => (
          <div key={s.id} className="xr-plan-step">
            <Icon.Grip width={12} height={12} className="drag" style={{ marginTop: 3 }}/>
            <input type="checkbox" checked={s.checked} onChange={() => toggle(s.id)}/>
            <div className="step-text">
              <input value={s.text} onChange={(e) => edit(s.id, e.target.value)}/>
            </div>
            <button className="del" onClick={() => del(s.id)} title="Remove step"><Icon.X width={12} height={12}/></button>
          </div>
        ))}
        <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={addStep} style={{ alignSelf: "flex-start" }}>
          <Icon.Plus width={12} height={12}/> Add step
        </button>
      </div>
      <div className="xr-plan-side">
        <h4>Overview</h4>
        <div className="kv"><span className="k">Tools</span><span className="xr-mono xr-dim" style={{ fontSize: 11 }}>Read, Edit, Shell</span></div>
        <div className="kv"><span className="k">Estimated cost</span><span className="xr-mono">~$0.03 · ~1.2k tokens</span></div>
        <div className="kv"><span className="k">Files to touch</span><span className="xr-mono">2 files (1 edit, 1 new)</span></div>
        <div className="kv"><span className="k">Network</span><span className="xr-dim">None</span></div>
        <div className="kv"><span className="k">Risk</span><span className="risk-low">Low — local edits only</span></div>
      </div>
      <div className="xr-plan-actions">
        <label className="autorun-label">
          <button className="xr-toggle" role="switch" aria-checked={autoRun} onClick={() => setAutoRun(v => !v)}/>
          Always auto-run for this kind of task
        </label>
        <div className="spacer"/>
        <button className="xr-btn xr-btn--secondary xr-btn--sm">Cancel</button>
        <button className="xr-btn xr-btn--primary" onClick={onStart}>
          Start executing <span className="xr-keycap">↵</span>
        </button>
      </div>
    </div>
  );
}

/* Diffs tab */
function DiffsPanel() {
  return (
    <div className="xr-diffs">
      <div style={{ fontSize: 12, color: "var(--xr-text-dim)", marginBottom: 12 }}>
        XR modified <b style={{ color: "var(--xr-text)" }}>2 files</b>. Review per hunk; accept ✓ or reject ✕.
      </div>
      <div className="xr-diff-file">
        <div className="xr-diff-file-header">
          <Icon.File width={13} height={13} style={{ color: "#3178C6" }}/>
          <span>src/core/agent.ts</span>
          <div className="stats">
            <span className="add">+8</span>
            <span className="del">-2</span>
          </div>
        </div>
        <div className="xr-hunk">
          <div className="hunk-actions">
            <button className="accept" title="Accept hunk">✓</button>
            <button className="reject" title="Reject hunk">✕</button>
          </div>
          <div className="hunk-code">
            <span className="ctx-line">  async execute(task: string): Promise&lt;Result&gt; {"{"}</span>
            <span className="ctx-line">    const plan = await this.planner.construct(task);</span>
            <span className="del-line">-   for (let attempt = 0; attempt &lt; this.config.maxRetries; attempt++) {"{"}</span>
            <span className="add-line">+   // XR proposes: exponential backoff with jitter</span>
            <span className="add-line">+   for (let attempt = 0; attempt &lt; this.config.maxRetries; attempt++) {"{"}</span>
            <span className="add-line">+     const backoff = Math.min(1000 * 2 ** attempt, 30000);</span>
            <span className="add-line">+     const jitter = backoff * 0.2 * Math.random();</span>
            <span className="ctx-line">      try {"{"}</span>
            <span className="ctx-line">        return await this.runner.run(plan, task);</span>
            <span className="ctx-line">      {"}"} catch (err) {"{"}</span>
            <span className="del-line">-       await sleep(1000);</span>
            <span className="add-line">+       await sleep(backoff + jitter);</span>
            <span className="ctx-line">      {"}"}</span>
          </div>
        </div>
      </div>
      <div className="xr-diff-file">
        <div className="xr-diff-file-header">
          <Icon.File width={13} height={13} style={{ color: "#3178C6" }}/>
          <span>src/utils/retry.ts <span className="xr-pill xr-pill--green" style={{ marginLeft: 6 }}>new file</span></span>
          <div className="stats">
            <span className="add">+14</span>
            <span className="del">-0</span>
          </div>
        </div>
        <div className="xr-hunk">
          <div className="hunk-actions">
            <button className="accept">✓</button>
            <button className="reject">✕</button>
          </div>
          <div className="hunk-code">
            <span className="add-line">+ export async function sleep(ms: number, signal?: AbortSignal) {"{"}</span>
            <span className="add-line">+   return new Promise((resolve, reject) =&gt; {"{"}</span>
            <span className="add-line">+     const t = setTimeout(resolve, ms);</span>
            <span className="add-line">+     signal?.addEventListener("abort", () =&gt; {"{"}</span>
            <span className="add-line">+       clearTimeout(t);</span>
            <span className="add-line">+       reject(new Error("Cancelled"));</span>
            <span className="add-line">+     {"}"});</span>
            <span className="add-line">+   {"};"}</span>
            <span className="add-line">+ {"}"}</span>
          </div>
        </div>
      </div>
      <div className="xr-diff-actions">
        <button className="xr-btn xr-btn--primary xr-btn--sm">Accept all</button>
        <button className="xr-btn xr-btn--secondary xr-btn--sm">Reject all</button>
        <button className="xr-btn xr-btn--ghost xr-btn--sm" style={{ marginLeft: "auto" }}>Edit manually</button>
      </div>
    </div>
  );
}
