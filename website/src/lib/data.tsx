import {
  Terminal,
  Cpu,
  ShieldCheck,
  Workflow,
  Plug,
  MemoryStick,
  Database,
  Mic,
  Activity,
  BookOpen,
  GitBranch,
  Clock,
  Globe,
} from "lucide-react";
import { site } from "./site";

/* ────────────────────────────────────────────────────────────────────────────
   XR website content — every claim is backed by the repository.
   Sources: src/cli/catalog.ts (real commands), src/providers/presets.ts
   (real presets), skills/* (counted), CHANGELOG.md (real releases),
   docs/* (real documents). Nothing here is invented.
   ────────────────────────────────────────────────────────────────────────── */

export const features = [
  {
    icon: Terminal,
    title: "Terminal-native agent",
    desc: "Type a task, XR plans, uses tools and reports back — with an approval gate in front of every consequential action. Runs in your shell and a full-screen TUI.",
  },
  {
    icon: Cpu,
    title: "Bring your own model",
    desc: "26 provider presets: 10 local runtimes (Ollama, llama.cpp, LM Studio, vLLM…) and 16 hosted APIs (OpenAI, Anthropic, Gemini, Groq, DeepSeek, OpenRouter…). BYOK — keys stay in your environment.",
  },
  {
    icon: ShieldCheck,
    title: "Approvals, budgets, audit",
    desc: "Consequential actions pause for your decision. Per-task spend ceilings. Every event is SHA-256-linked into a local log you verify offline with `xr audit verify`.",
  },
  {
    icon: Database,
    title: "Local-first, no telemetry",
    desc: "One SQLite database on your machine. No mandatory cloud, no telemetry endpoints. XR works fully offline with local models.",
  },
  {
    icon: Workflow,
    title: "Skills, not prompts",
    desc: "65 bundled skills — code review, deep research, security audit, refactoring, writing, DevOps — each manifest-declared and permission-scoped. Inspect any with `xr skills inspect <id>`.",
  },
  {
    icon: Plug,
    title: "Plugins & MCP",
    desc: "A plugin API and a Model Context Protocol client with a signed, default-deny allowlist. Grant exact commands and network access per server — nothing loads until you enable it.",
  },
  {
    icon: MemoryStick,
    title: "Memory you control",
    desc: "Durable, inspectable memory with consent records. Add, recall, consolidate and export — or revoke anything, keeping lineage. `xr context explain` tells you exactly what XR knows and why.",
  },
  {
    icon: GitBranch,
    title: "Runs & sessions",
    desc: "Every run is a reviewable record: what you asked, what tools ran, what changed and whether it succeeded. List, inspect step-by-step, and export transcripts.",
  },
  {
    icon: Activity,
    title: "Automation & triggers",
    desc: "Scheduled work through a governed trigger table with a pause-all kill switch. Run agents on cron, webhooks or file events — always under the same policy gate.",
  },
  {
    icon: Globe,
    title: "Web & messaging surfaces",
    desc: "`xr serve` opens the local Control Center (dashboard + chat on 127.0.0.1:3141). An optional Telegram channel reaches the same engine. One runtime, every surface.",
  },
  {
    icon: Mic,
    title: "Voice (opt-in)",
    desc: "`xr voice setup` configures STT/TTS for hands-free sessions; speak, listen, interrupt and stop. Voice never runs without your consent.",
  },
  {
    icon: BookOpen,
    title: "Readable end to end",
    desc: "MIT-licensed TypeScript with 3,191 tests across 240 files, dependency boundaries enforced in CI, and docs that describe what the code actually does.",
  },
];

export const stats = [
  { value: String(site.skillCount), label: "Bundled skills", note: "manifest-declared & permission-scoped" },
  { value: String(site.providerCount), label: "Provider presets", note: `${site.localRuntimes} local · ${site.hostedProviders} hosted (BYOK)` },
  { value: "100%", label: "Local-first", note: "no mandatory cloud, no telemetry" },
  { value: "0", label: "Telemetry endpoints", note: "one SQLite database on your machine" },
];

// Real provider preset labels (src/providers/presets.ts) — marquee.
export const logos = [
  "Ollama",
  "LM Studio",
  "Jan",
  "LocalAI",
  "vLLM",
  "llama.cpp",
  "GPT4All",
  "KoboldCpp",
  "OpenAI",
  "Anthropic",
  "Google Gemini",
  "Groq",
  "DeepSeek",
  "Cerebras",
  "OpenRouter",
  "Together AI",
  "Mistral",
  "Fireworks AI",
  "SambaNova",
  "Hugging Face",
  "Cohere",
  "xAI Grok",
  "Perplexity",
  "AWS Bedrock",
];

/* Real hosted provider presets (src/providers/presets.ts) — shown on /models. */
export const hostedProviders = [
  { id: "openai", label: "OpenAI", auth: "Bearer key (env)", defaultModel: "gpt-4o-mini", docs: "https://platform.openai.com" },
  { id: "anthropic", label: "Anthropic", auth: "Bearer key (env)", defaultModel: "claude-3-5-sonnet", docs: "https://anthropic.com" },
  { id: "google", label: "Google Gemini", auth: "Google AI key (env)", defaultModel: "gemini-1.5-pro", docs: "https://ai.google.dev" },
  { id: "groq", label: "Groq", auth: "Bearer key (env)", defaultModel: "llama-3.3-70b-versatile", docs: "https://groq.com" },
  { id: "deepseek", label: "DeepSeek", auth: "Bearer key (env)", defaultModel: "deepseek-chat", docs: "https://deepseek.com" },
  { id: "cerebras", label: "Cerebras", auth: "Bearer key (env)", defaultModel: "llama-3.3-70b", docs: "https://cerebras.ai" },
  { id: "openrouter", label: "OpenRouter", auth: "Bearer key (env)", defaultModel: "openrouter/auto", docs: "https://openrouter.ai" },
  { id: "together", label: "Together AI", auth: "Bearer key (env)", defaultModel: "Meta-Llama-3.1-70B-Instruct", docs: "https://together.ai" },
  { id: "mistral", label: "Mistral", auth: "Bearer key (env)", defaultModel: "open-mixtral-8x7b", docs: "https://mistral.ai" },
  { id: "fireworks", label: "Fireworks AI", auth: "Bearer key (env)", defaultModel: "llama-3.1-70b", docs: "https://fireworks.ai" },
  { id: "sambanova", label: "SambaNova", auth: "Bearer key (env)", defaultModel: "Meta-Llama-3.1-70B-Instruct", docs: "https://sambanova.ai" },
  { id: "huggingface", label: "Hugging Face", auth: "Bearer key (env)", defaultModel: "meta-llama/llama-3.1-70b", docs: "https://huggingface.co" },
  { id: "cohere", label: "Cohere", auth: "Bearer key (env)", defaultModel: "command-r-plus", docs: "https://cohere.com" },
  { id: "xai", label: "xAI (Grok)", auth: "Bearer key (env)", defaultModel: "grok-2-latest", docs: "https://x.ai" },
  { id: "perplexity", label: "Perplexity", auth: "Bearer key (env)", defaultModel: "llama-3.1-sonar-large-128k-online", docs: "https://perplexity.ai" },
  { id: "bedrock", label: "AWS Bedrock", auth: "AWS credentials", defaultModel: "claude-3-sonnet", docs: "https://aws.amazon.com/bedrock" },
];

/* Real local runtime presets (src/providers/presets.ts) — shown on /models. */
export const localRuntimes = [
  { id: "ollama", label: "Ollama", auth: "none — localhost", defaultModel: "qwen2.5:7b" },
  { id: "lmstudio", label: "LM Studio", auth: "none — localhost", defaultModel: "Meta-Llama-3.1-8B-Instruct-GGUF" },
  { id: "jan", label: "Jan", auth: "none — localhost", defaultModel: "jan" },
  { id: "localai", label: "LocalAI", auth: "none — localhost", defaultModel: "localai" },
  { id: "vllm", label: "vLLM", auth: "none — localhost", defaultModel: "llama3.1-8b" },
  { id: "llamacpp", label: "llama.cpp", auth: "none — localhost", defaultModel: "llama-3.1-8b" },
  { id: "gpt4all", label: "GPT4All", auth: "none — localhost", defaultModel: "gpt4all" },
  { id: "koboldcpp", label: "KoboldCpp", auth: "none — localhost", defaultModel: "koboldcpp" },
  { id: "textgenwebui", label: "text-generation-webui", auth: "none — localhost", defaultModel: "textgenwebui" },
  { id: "sglang", label: "SGLang", auth: "none — localhost", defaultModel: "sglang" },
];

// Marketplace content is GENERATED from the real bundled inventory
// (skills/* and plugins/*) — see website/scripts/generate-marketplace.ts.
// It carries no fabricated popularity metrics.
export {
  marketplaceCategories,
  marketplaceItems,
  type MarketplaceItem,
  type ItemType,
} from "./marketplace.generated";

export const pricingPlans = [
  {
    name: "XR",
    price: "$0",
    cadence: "forever · MIT",
    description: "Free and open source. XR is self-hosted software you run yourself — there is no paid tier and no cloud lock-in.",
    cta: "Get XR",
    href: "/downloads",
    featured: true,
    features: [
      "Terminal shell + local Control Center",
      "Local-first — no mandatory cloud, no telemetry",
      "BYOK, or local models (Ollama, llama.cpp, vLLM…)",
      "Approvals + per-task spend ceilings",
      "Tamper-evident audit log, verifiable offline",
      "65 bundled skills, plugins, MCP, memory, research, voice",
      "Community support on GitHub",
    ],
  },
  {
    name: "For teams & organizations",
    price: "Self-hosted",
    cadence: "you run it",
    description: "Deploy XR on your own infrastructure. Everything below ships in the MIT codebase today and is operated locally — there is no hosted control plane.",
    cta: "Enterprise overview",
    href: "/enterprise",
    featured: false,
    features: [
      "Deterministic policy gate, approvals, spend caps",
      "Hash-chained audit with offline verification",
      "Layered policy for shared machines",
      "Works fully air-gapped",
      "Docker, systemd, cross-platform binaries",
      "No sales process — MIT code, open issues",
    ],
  },
];

export const faqs = [
  {
    q: "Is XR open source?",
    a: "Yes — fully MIT-licensed and readable end to end. There is no commercial tier and no cloud-only product: individuals and organizations run the same software on their own machines.",
  },
  {
    q: "Do I need an API key?",
    a: "No. XR ships with no key and no cloud account. Use one of the 16 hosted provider presets with your own key (BYOK — keys are read from your environment and never logged), or run fully offline against a local runtime like Ollama, llama.cpp or vLLM.",
  },
  {
    q: "What runtimes does it need?",
    a: "The compiled binaries need nothing — they are standalone executables. Installing from npm runs TypeScript sources and needs Bun ≥ 1.3. In every case your data lives in one local SQLite database under your state directory.",
  },
  {
    q: "Which editors can I use?",
    a: "XR is terminal-native, so it works in any editor or IDE. A VS Code extension ships in the repository, and `xr serve` opens a local web Control Center in your browser. There is no separate cloud dashboard.",
  },
  {
    q: "What is a skill?",
    a: "A skill is a manifest-declared, permission-scoped unit of capability (id, version, publisher, permissions, description). XR ships 65 bundled skills; each can be inspected, enabled or disabled with the CLI.",
  },
  {
    q: "How is XR different from a coding agent?",
    a: "Coding assistants are chat windows around one model. XR is a governed runtime: it plans, uses tools, spends within caps, asks before consequential actions and writes every event to a tamper-evident log — over whichever model you choose, cloud or local.",
  },
  {
    q: "Does XR support MCP?",
    a: "Yes — an MCP client with a signed, default-deny allowlist. You register servers with `xr mcp add`, grant exact permissions, and inspect health and tools with `xr mcp list` and `xr mcp tools`.",
  },
  {
    q: "Is it safe to let an agent act on my machine?",
    a: "XR is governed, not magical: consequential actions pause for your approval, denial is enforced in the execution path (not suggested in a prompt), spend ceilings are checked during the loop, and everything lands in an audit log you can verify. XR is in-process policy — read the security model and decide for yourself.",
  },
];

/* ── Changelog: REAL entries from the repository CHANGELOG.md ─────────────── */
export const changelog = [
  {
    version: "main (next)",
    date: "In development",
    title: "Phase 12 — Honesty pass: real data behind every panel",
    highlights: [
      "Dashboard MCP panel wired to the real registry (previously a silent 'no connections')",
      "Approvals queue rendered in the browser for the first time — decisions release waiting CLI runs",
      "Home rebuilt honest: active model, needs-your-attention strip, real KPIs",
      "Deleted five fake panels (fabricated metrics, 'Listening' webhooks, alerts hub)",
      "Tool approvals now carry the real arguments they will execute",
      "Audit timestamps fixed (was rendering Invalid Date)",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-08-13",
    title: "1.0.0 (Truth) — the first stable line",
    highlights: [
      "Deliberate version rebaseline: the 7.1.0 codebase re-identified as the stable 1.0.0 line",
      "Single release manifest stamps every surface — CI fails on any drift",
      "Fixed a tamper-evidence race that could flag untampered runs as invalid",
      "SECURITY.md corrected to describe the real posture (in-process policy, OS isolation as the boundary)",
      "Vulnerability reports moved to GitHub Security Advisories (old address had no DNS record)",
      "Cross-platform parity fixes: SQLite write-gate retries, Windows-safe plugin filesystem primitives",
    ],
  },
  {
    version: "7.1.0",
    date: "2026-08-05",
    title: "7.1.0 — engineering & packaging wave",
    highlights: [
      "Packaging & release-engineering core (binaries, installers, channels)",
      "UX, accessibility, observability & DX pass with an a11y CI gate",
      "Measured, explainable routing quality (Phase 5 intelligence)",
      "Security & trust hardening: isolation lattice, egress proxy, credential brokering",
      "One execution engine, one context store, one routing authority",
      "Memory, knowledge & context quality: progressive lifecycle, hybrid retrieval",
    ],
  },
  {
    version: "7.0.0",
    date: "2026-07",
    title: "XR 7.0.0 — 'Supremacy' (Phase 13)",
    highlights: [
      "Capability ecosystem with provenance graph and evidence-based trust",
      "Signed per-target default distribution",
      "Versioned public API with generated client contract",
    ],
  },
  {
    version: "6.1.0",
    date: "2026-07",
    title: "XR 6.1 Enterprise — trust & operations",
    highlights: [
      "Enterprise trust architecture: layered policy, incident workflow, SLO observability",
      "Backup verification and restore drills",
    ],
  },
  {
    version: "6.0.0",
    date: "2026-07",
    title: "XR 6.0 Hybrid — local, cloud & hybrid operating plane",
    highlights: [
      "Unified local/cloud operating plane with honest readiness",
      "Fallback chains between local and hosted models",
    ],
  },
];

/* ── Blog: engineering notes rooted in the repository ────────────────────── */
export const posts = [
  {
    slug: "xr-1-0-truth",
    title: "XR 1.0 (Truth) — what the stable line actually means",
    excerpt:
      "A version number reset, a single release manifest, and a hardening pass that fixed a tamper-evidence race in the audit chain.",
    author: "XR Engineering",
    date: "2026-08-13",
    tag: "Release",
    readTime: "5 min read",
    body: [
      "1.0.0 (Truth) is a re-identification of the 7.1.0 codebase as the first stable line — no features were added or removed in the rebaseline. Every surface (package.json, runtime version module, README, installers, website) is stamped from one release.manifest.json, and CI fails the build if any of them drift.",
      "The hardening pass fixed a genuinely subtle bug: run integrity no longer depends on clock timing. EvaluationRunner read Date.now() twice — once for stored provenance and once for the digest input — so a millisecond boundary between the two reads made every read-back report integrityValid: false on untampered data. A tamper-evidence signal that fires on untouched data is worse than none; there is now one clock read and one frozen provenance object.",
      "SECURITY.md was corrected to stop contradicting the implementation: it no longer calls XR a 'secure AI Operating System' and no longer treats the node:vm realm as a security boundary. The real posture is in-process policy, with OS isolation as the boundary.",
      "Vulnerability reports now go through GitHub Security Advisories — the previous address pointed at a domain with no DNS record, so reports would have bounced.",
      "Measured state at release: 3,191 tests across 240 files, ~36 ms p95 fast-path cold start, and local-first operation with no telemetry endpoints.",
    ],
  },
  {
    slug: "honest-dashboard",
    title: "Designing a dashboard that cannot fake its data",
    excerpt:
      "The Control Center redesign deleted five fake panels and wired every remaining surface to the real registry, store and approval queue.",
    author: "XR Engineering",
    date: "2026-09",
    tag: "Engineering",
    readTime: "7 min read",
    body: [
      "The dashboard once rendered panels that looked alive but were not: an MCP area that called an endpoint which did not exist and silently showed 'No MCP connections registered' forever, an automation card that was a static 'no jobs' placeholder, and an agents route that returned three hardcoded instances with a made-up status string.",
      "The honesty pass deleted the fabricated surfaces — a Business OS CRM with invented metrics, a 'Listening' webhook indicator, devices, downloads and an alerts hub — and wired the rest to real data: the same MCP registry the CLI persists, the live trigger registry, and the durable approvals queue where a decision made in the browser releases a waiting CLI run.",
      "Design rule that survived: if a panel cannot be backed by a real store or route, it does not exist. Home shows four real KPIs and a needs-your-attention strip that only renders when there is something to attend to.",
      "Tool approvals now carry the real arguments they will execute, so the browser shows what will be written, deleted or run — not a hash. And audit timestamps render correctly (they previously read the wrong field and displayed Invalid Date for every row).",
    ],
  },
  {
    slug: "security-model",
    title: "XR's capability-based security model",
    excerpt:
      "How XR separates authority from intelligence: a deterministic policy gate, human approval, spend ceilings, and a hash-chained audit log.",
    author: "Security",
    date: "2026-08",
    tag: "Security",
    readTime: "9 min read",
    body: [
      "XR's security model separates authority from intelligence: a model proposes, but policy, identity, isolation and approval grant.",
      "Every consequential action flows through one execution envelope: intent, plan, policy decision, placement, action, observation, evidence, outcome. Policy is evaluated in-process before any tool call; denial is enforced in the path, not suggested in the prompt.",
      "Isolation follows risk. In-process policy is a data boundary, not a security boundary — OS isolation is the enforcement boundary for high-risk actions.",
      "The reviewer is fail-closed: it requires strict JSON, and anything unparseable is changes_requested, never silently approved.",
      "The audit log is SHA-256 hash-chained and can be verified offline with one command. XR is not certified by any third party and makes no SOC 2, ISO 27001 or HIPAA claim — read SECURITY.md and decide for yourself.",
    ],
  },
  {
    slug: "local-first",
    title: "Local-first agents: Ollama to air-gapped",
    excerpt:
      "Running XR entirely offline with open-weight models — no cloud, no telemetry, no keys.",
    author: "DX",
    date: "2026-08",
    tag: "Tutorial",
    readTime: "6 min read",
    body: [
      "XR is designed to run entirely on your machine: shell, Control Center, memory, audit and model access all work offline.",
      "Ten local inference engines are first-class presets — Ollama, LM Studio, Jan, LocalAI, vLLM, llama.cpp, GPT4All, KoboldCpp, text-generation-webui and SGLang. `xr providers set ollama qwen2.5:7b` is enough to switch.",
      "Bring your own keys if you prefer cloud models; keys stay in your environment and are never logged. There is no XR cloud and no mandatory control plane; the only outbound call the runtime makes is to a model provider you configured.",
      "The audit log, memory, sessions and workflow records all live in your local state directory. You can verify this yourself: run XR with no network and finish a local task end to end.",
    ],
  },
];

/* ── Research: real write-ups that ship inside docs/ ─────────────────────── */
export const research = [
  {
    title: "The XR Execution Fabric",
    authors: "XR Engineering",
    year: 2026,
    tag: "Architecture",
    doc: "docs/EXECUTION_FABRIC.md",
  },
  {
    title: "XR Security Model — separation of authority and intelligence",
    authors: "XR Engineering",
    year: 2026,
    tag: "Security",
    doc: "docs/security/SECURITY_MODEL.md",
  },
  {
    title: "Memory & Context Engine",
    authors: "XR Engineering",
    year: 2026,
    tag: "Memory",
    doc: "docs/architecture/PHASE_09_MEMORY_CONTEXT_ENGINE.md",
  },
  {
    title: "Repository Intelligence",
    authors: "XR Engineering",
    year: 2026,
    tag: "Intelligence",
    doc: "docs/architecture/PHASE_11_REPO_INTELLIGENCE.md",
  },
  {
    title: "Privacy-first Observability (OTLP)",
    authors: "XR Engineering",
    year: 2026,
    tag: "Observability",
    doc: "docs/observability/MODEL.md",
  },
  {
    title: "The Capability Ecosystem — provenance, trust scoring, MCP allowlist",
    authors: "XR Engineering",
    year: 2026,
    tag: "Ecosystem",
    doc: "docs/CAPABILITIES.md",
  },
  {
    title: "Skills & Marketplace — authoring and distribution",
    authors: "XR Engineering",
    year: 2026,
    tag: "Skills",
    doc: "docs/SKILLS-MARKETPLACE.md",
  },
];
