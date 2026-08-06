import {
  Code2,
  Terminal,
  GitBranch,
  Search,
  FileCode2,
  Cloud,
  Database,
  Cpu,
  ShieldCheck,
  Boxes,
  Zap,
  Workflow,
  Lock,
  LineChart,
  Palette,
  Globe,
  Wrench,
  BookOpen,
  Rocket,
} from "lucide-react";
import { site } from "./site";

export const features = [
  {
    icon: Cpu,
    title: "Agentic Runtime",
    desc: "A performant, sandboxed runtime that plans, executes, and iterates — with deterministic replays and full audit trails.",
  },
  {
    icon: Terminal,
    title: "Native Shell",
    desc: "XR lives inside your terminal. Native commands, pipes, and a ~36 ms cold start (measured p95). No browser required.",
  },
  {
    icon: Code2,
    title: "Editor Agnostic",
    desc: "A bundled VS Code extension, and a CLI that runs in any terminal. Your agent, every surface.",
  },
  {
    icon: Boxes,
    title: "Skill Graph",
    desc: "Compose the bundled skills into pipelines. Each skill is manifest-declared and permission-scoped.",
  },
  {
    icon: Cloud,
    title: "Any Model",
    desc: "Open-weight to frontier — GPT-5, Claude Opus, Gemini, DeepSeek, Qwen, Llama, Groq. Route by cost, latency, or task.",
  },
  {
    icon: ShieldCheck,
    title: "Security by Default",
    desc: "Capability-based security, human-in-the-loop confirmations, signed skills, and a hash-chained audit log.",
  },
  {
    icon: GitBranch,
    title: "Reproducible Workflows",
    desc: "Every run is a replayable trace. Share sessions, diff executions, and roll agents back like code.",
  },
  {
    icon: Workflow,
    title: "MCP Native",
    desc: "An MCP client with a signed, default-deny allowlist. Grant exact commands and network access per server.",
  },
  {
    icon: Zap,
    title: "Blazing Fast",
    desc: "TypeScript on Bun. Streaming by default. Local models keep tool calls on your machine.",
  },
];

export const stats = [
  { value: `${site.skillCount}`, label: "Bundled skills" },
  { value: "MIT", label: "License" },
  { value: "100%", label: "Local-first (no mandatory cloud)" },
  { value: "0", label: "Telemetry endpoints" },
];

// Provider/runtime integrations XR actually ships presets for (src/providers/presets.ts).
export const logos = [
  "Ollama",
  "LM Studio",
  "llama.cpp",
  "vLLM",
  "OpenAI",
  "Anthropic",
  "Google Gemini",
  "OpenRouter",
];

// Marketplace content is GENERATED from the real bundled inventory
// (skills/* and plugins/*) — see website/scripts/generate-marketplace.ts.
// It carries no fabricated popularity metrics (Constitution Art. XV.4).
export {
  marketplaceCategories,
  marketplaceItems,
  type MarketplaceItem,
  type ItemType,
} from "./marketplace.generated";

export const models = [
  {
    name: "XR Core 1",
    provider: "XR",
    tag: "Flagship",
    context: "1M tokens",
    speed: "Fastest",
    description: "Our in-house agentic model, tuned for tool use and long-horizon tasks.",
    featured: true,
  },
  {
    name: "Claude Opus 4.5",
    provider: "Anthropic",
    tag: "Reasoning",
    context: "2M tokens",
    speed: "Balanced",
    description: "Frontier reasoning for complex planning, code generation, and deep analysis.",
    featured: true,
  },
  {
    name: "GPT-5",
    provider: "OpenAI",
    tag: "General",
    context: "1M tokens",
    speed: "Fast",
    description: "Versatile frontier model with strong generalist performance.",
  },
  {
    name: "Gemini 2.5 Pro",
    provider: "Google",
    tag: "Multimodal",
    context: "1M tokens",
    speed: "Fast",
    description: "Strong multimodal reasoning across text, code, images, and video.",
  },
  {
    name: "DeepSeek V3",
    provider: "DeepSeek",
    tag: "Open-weight",
    context: "128K tokens",
    speed: "Very Fast",
    description: "High-performance open-weight coding model.",
  },
  {
    name: "Llama 4 Maverick",
    provider: "Meta",
    tag: "Open-weight",
    context: "1M tokens",
    speed: "Fast",
    description: "Open-weight model with native multimodal capabilities.",
  },
  {
    name: "Qwen 3 Max",
    provider: "Alibaba",
    tag: "Open-weight",
    context: "1M tokens",
    speed: "Fast",
    description: "Top-tier multilingual open-weight model.",
  },
  {
    name: "Groq Llama 405B",
    provider: "Groq",
    tag: "Ultra-low latency",
    context: "128K tokens",
    speed: "Realtime",
    description: "405B Llama served on Groq's LPU for sub-300ms latency.",
  },
];

// XR has no hosted SaaS and no paid tier. These plans describe the single
// MIT-licensed, self-hosted product honestly: what individuals get, and what
// the optional, opt-in enterprise deployment profile adds (all operated
// locally — there is no XR cloud and no control plane to depend on).
export const pricingPlans = [
  {
    name: "XR",
    price: "$0",
    cadence: "forever · MIT-licensed",
    description: "Free and open source. XR is self-hosted software you run yourself.",
    cta: "Get XR",
    href: "/downloads",
    featured: true,
    features: [
      "CLI + dashboard",
      "Local-first — no mandatory cloud",
      "BYOK, or local models (Ollama, llama.cpp, vLLM)",
      "Per-task spend caps",
      "Tamper-evident audit log",
      "Plugins, MCP, skills",
      "Community support",
    ],
  },
  {
    name: "For teams & organizations",
    price: "Self-hosted",
    cadence: "you run it",
    description: "Deploy XR on your own infrastructure. Enterprise controls are operated locally and opt-in per deployment.",
    cta: "Deployment docs",
    href: "/enterprise",
    featured: false,
    features: [
      "Layered org/workspace policy (most-restrictive-wins)",
      "Hash-chained audit export with retention schedules & legal hold",
      "Incident workflow with evidence-bound states",
      "SLO definitions with honest measurability",
      "Backup verification and restore drills",
      "No hosted control plane required",
    ],
  },
];

export const faqs = [
  {
    q: "Is XR open-source?",
    a: "Yes. XR is fully MIT-licensed. There is no commercial tier and no cloud-only product — the same software runs for individuals and organizations.",
  },
  {
    q: "Which editors are supported?",
    a: "VS Code, Neovim, JetBrains IDEs, Zed, Cursor, and Windsurf all have first-party extensions. The CLI works anywhere.",
  },
  {
    q: "Can I run XR locally?",
    a: "Absolutely. The runtime is designed for local-first operation with Ollama, Llama.cpp, vLLM, and any OpenAI-compatible endpoint.",
  },
  {
    q: "What is a skill?",
    a: "A skill is a typed, versioned, capability-scoped unit of work — think of it as a better tool. Skills compose into agents.",
  },
  {
    q: "How is XR different from coding agents?",
    a: "Coding agents are one feature of XR. XR is a full runtime: shell, editor, skills, models, security, and deployment in one coherent system.",
  },
  {
    q: "Do you support MCP?",
    a: "Yes. XR is MCP-native — you can use any MCP server without an adapter. We also extend MCP with typed streams and state.",
  },
];

export const changelog = [
  {
    version: "3.1.0",
    date: "July 8, 2026",
    title: "XR 3.1 — The Agentic Runtime",
    highlights: [
      "Runtime performance work across the agent loop",
      "New skill graph with typed compositions",
      "MCP-native server architecture",
      "Redesigned Dashboard",
      "First-class models marketplace",
      "New official skills",
    ],
  },
  {
    version: "3.0.4",
    date: "June 2, 2026",
    title: "Security & performance patch",
    highlights: [
      "Capability tokens for skills",
      "Improved streaming latency (-18%)",
      "JetBrains extension v2",
      "Support for GPT-5 and Claude Opus 4.5",
    ],
  },
  {
    version: "3.0.0",
    date: "April 14, 2026",
    title: "XR 3.0 — Release",
    highlights: [
      "Stable runtime API",
      "Skill marketplace scaffolding",
    ],
  },
];

export const posts = [
  {
    slug: "xr-3-1-ga",
    title: "XR 3.1 — the agentic runtime",
    excerpt:
      "Notes on the agentic runtime: the skill layer, the model router, and the security gate.",
    author: "The XR Team",
    date: "July 8, 2026",
    tag: "Release",
    readTime: "6 min read",
    body: [
      "XR 3.1 is the agentic runtime release: a typed skill layer, an explainable model router, and a fail-closed security gate.",
      "The skill layer is manifest-governed: every skill declares its id, version, publisher, permissions, and categories, so what you install is what you audit.",
      "The model router explains why a model was chosen — capability, cost, latency, and locality are all inputs, and sensitive work never silently routes to the cloud.",
      "The security gate canonicalizes policy decisions first, then evaluates them, and denies what it cannot canonicalize. Unparseable reviewer output is treated as a request for changes, never as approval.",
      "Measured baseline: CLI fast path cold start ~36 ms p95, doctor readiness ~456 ms p95, retrieval over 100k items ~33 ms p95. Budgets and regression gates are enforced in CI.",
      "Next: faster local models, richer multi-agent orchestration, and deeper editor integrations.",
    ],
  },
  {
    slug: "skill-graph",
    title: "Designing the XR skill graph",
    excerpt:
      "Skills are the primitive of agentic software. Here is how the manifest-governed skill layer is designed.",
    author: "Engineering",
    date: "June 22, 2026",
    tag: "Engineering",
    readTime: "12 min read",
    body: [
      "Skills are the primitive of agentic software: packaged capabilities that travel with their own provenance, permissions, and tests.",
      "Every skill in the repository ships a manifest (xr-skill.json) declaring id, version, publisher, license, categories, tags, and a description. Skills are typed: executable, connector, prompt-pack, knowledge-pack, or experimental.",
      "Bundled skills ship with XR and are discovered automatically; you can inspect any skill with `xr skills inspect <id>`.",
      "Skills execute through the same execution envelope as everything else: policy is evaluated before any tool call, and every consequential action is recorded in the hash-chained audit log.",
      "The capability ecosystem adds a provenance graph, an evidence-based trust scorer (popularity contributes at most a 5% nudge), and a signed MCP allowlist that is default-deny.",
    ],
  },
  {
    slug: "security-model",
    title: "XR's capability-based security model",
    excerpt:
      "How we think about agent security, from sandboxing to human-in-the-loop confirmations, signed skills, and audit trails.",
    author: "Security",
    date: "May 30, 2026",
    tag: "Security",
    readTime: "9 min read",
    body: [
      "XR's security model separates authority from intelligence: a model proposes, but policy, identity, isolation, and approval grant.",
      "Every consequential action flows through one execution envelope: intent, plan, policy decision, placement, action, observation, evidence, outcome.",
      "Isolation follows risk. Low-risk work runs in-process; high-risk actions — shell, code, secrets, external writes — are placed in restricted or container isolation. In-process policy is a data boundary, not a security boundary.",
      "The reviewer is fail-closed: it requires strict JSON, and anything unparseable is changes_requested, never silently approved.",
      "The audit log is hash-chained and serialized, and can be verified with one command. XR is not certified by any third party and makes no SOC 2, ISO 27001, or HIPAA claim.",
    ],
  },
  {
    slug: "local-first",
    title: "Local-first agents with Ollama",
    excerpt:
      "A guide to running XR entirely offline with open-weight models — no cloud, no telemetry, no keys.",
    author: "DX",
    date: "May 12, 2026",
    tag: "Tutorial",
    readTime: "7 min read",
    body: [
      "XR is designed to run entirely on your machine: CLI, dashboard, and model access all work offline.",
      "Local inference engines — Ollama, llama.cpp, LM Studio, vLLM — are first-class provider presets. Bring your own API keys if you prefer cloud models; keys stay in your environment and are never logged.",
      "There is no XR cloud and no mandatory control plane. Telemetry is off by default; the only outbound call the runtime makes is to a model provider you configured.",
      "The audit log, memory, sessions, and workflow records all live in your local state directory.",
      "You can verify this yourself: run XR with no network and finish a local task end to end.",
    ],
  },
];

// Research = engineering write-ups that actually ship inside the repository.
// Each entry points at a real docs/ artifact; nothing here is a peer-reviewed
// paper and no fabricated study is presented as one.
export const research = [
  {
    title: "The XR Execution Fabric",
    authors: "XR Engineering",
    year: 2026,
    tag: "Architecture",
    doc: "docs/EXECUTION_FABRIC.md",
  },
  {
    title: "Privacy-first Observability (OTLP)",
    authors: "XR Engineering",
    year: 2026,
    tag: "Observability",
    doc: "docs/observability/MODEL.md",
  },
  {
    title: "XR Security Model",
    authors: "XR Engineering",
    year: 2026,
    tag: "Security",
    doc: "docs/security/SECURITY_MODEL.md",
  },
  {
    title: "Capability Ecosystem: provenance, trust scoring, MCP allowlist",
    authors: "XR Engineering",
    year: 2026,
    tag: "Ecosystem",
    doc: "docs/phase7-ecosystem/",
  },
  {
    title: "Outcome Benchmark Methodology",
    authors: "XR Engineering",
    year: 2026,
    tag: "Evaluation",
    doc: "docs/phase13/BENCHMARK_METHODOLOGY.md",
  },
];
