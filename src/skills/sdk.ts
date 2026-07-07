/**
 * XR 2.1B — Skill SDK.
 *
 * The SDK turns Skill creation into a five-minute workflow while staying local,
 * auditable, and compatible with the XR 2.1A Unified Skill Runtime.  It borrows
 * proven extension ergonomics from VS Code/Raycast manifests, Claude/OpenClaw
 * SKILL.md folders, and Obsidian-style documentation-first plugin packages.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { SkillMarketplace } from "./marketplace.ts";
import { packageCacheDir } from "./marketplace-store.ts";
import { hashSkillTree, readSkillManifest, skillDirName } from "./manifest.ts";
import {
  SKILL_CATEGORIES,
  SkillManifestSchema,
  type SkillCategory,
  type SkillManifest,
  type SkillPermissionScope,
} from "./schema.ts";

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "new-skill";
}

function title(input: string): string {
  return input.split(/[-_\s]+/).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeSafe(path: string, content: string, force: boolean): "created" | "updated" | "skipped" {
  ensureDir(dirname(path));
  if (existsSync(path) && !force) return "skipped";
  const existed = existsSync(path);
  writeFileSync(path, content);
  return existed ? "updated" : "created";
}

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if ([".git", "node_modules"].includes(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) visit(p);
      else out.push(p);
    }
  };
  if (existsSync(root)) visit(root);
  return out.sort();
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function iconSvg(name: string): string {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "X").join("") || "XR";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${name} icon">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#00D4FF"/>
      <stop offset="1" stop-color="#00FF88"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#070A12"/>
  <rect x="28" y="28" width="456" height="456" rx="92" fill="none" stroke="url(#g)" stroke-width="18"/>
  <circle cx="256" cy="256" r="154" fill="url(#g)" opacity="0.16"/>
  <text x="256" y="288" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="126" font-weight="800" fill="#EAF2FF">${initials}</text>
</svg>
`;
}

export interface SkillCreateOptions {
  id?: string;
  name: string;
  category?: SkillCategory;
  publisher?: string;
  dir?: string;
  description?: string;
  force?: boolean;
  template?: "professional" | "developer" | "research" | "security" | "business" | "creative";
}

export interface SkillInitOptions extends Omit<SkillCreateOptions, "dir"> {
  dir: string;
}

export interface SkillFileResult {
  path: string;
  status: "created" | "updated" | "skipped";
}

export interface SkillScaffoldResult {
  dir: string;
  id: string;
  manifest: SkillManifest;
  files: SkillFileResult[];
}

export interface SkillTestResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  cases: Array<{ file: string; ok: boolean; reason: string }>;
}

export interface SkillBuildResult {
  ok: boolean;
  skillId?: string;
  version?: string;
  packagePath?: string;
  reportPath?: string;
  treeSha256?: string;
  validation: ReturnType<SkillMarketplace["validate"]>;
  tests: SkillTestResult;
  errors: string[];
  warnings: string[];
}

export interface SkillDoctorCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface SkillDoctorReport {
  ok: boolean;
  dir: string;
  checks: SkillDoctorCheck[];
}

function defaultPermissions(category: SkillCategory): Array<{ scope: SkillPermissionScope; reason: string; dangerous: boolean }> {
  if (category === "developer") {
    return [
      { scope: "fs:read", reason: "Inspect project files when the user asks this Skill to work on a codebase.", dangerous: false },
      { scope: "fs:write", reason: "Write generated artifacts only after XR approval.", dangerous: true },
      { scope: "shell", reason: "Run local validation commands only after XR approval.", dangerous: true },
    ];
  }
  if (category === "research") {
    return [
      { scope: "net", reason: "Use XR-approved research/search egress for source discovery.", dangerous: true },
      { scope: "fs:write", reason: "Save research reports only after XR approval.", dangerous: true },
    ];
  }
  if (category === "security") {
    return [
      { scope: "fs:read", reason: "Inspect user-provided artifacts within authorized scope.", dangerous: false },
      { scope: "net", reason: "Perform defensive, authorized enrichment only through XR egress controls.", dangerous: true },
    ];
  }
  return [{ scope: "fs:write", reason: "Save generated deliverables only after XR approval.", dangerous: true }];
}

function manifestFor(options: SkillCreateOptions): SkillManifest {
  const id = options.id ? slugify(options.id) : slugify(options.name);
  const category = options.category ?? "productivity";
  const template = options.template ?? (SKILL_CATEGORIES.includes(category) ? category : "professional");
  const description = options.description ?? `${options.name} is a production-ready XR Skill that packages professional instructions, workflows, prompts, examples, tests, documentation, memory templates, settings, permissions, and validation metadata.`;
  return SkillManifestSchema.parse({
    schemaVersion: 1,
    id,
    name: options.name,
    version: "1.0.0",
    description,
    longDescription: `${description}\n\nGenerated by the XR 2.1B Skill SDK using the ${template} template.`,
    publisher: options.publisher ?? "local",
    license: "MIT",
    icon: "assets/icon.svg",
    categories: [category],
    tags: [slugify(options.name), category, "xr-skill", template],
    keywords: [slugify(options.name), category, template, "agent-skill", "xr"],
    compatibility: { xr: ">=1.0.0", os: ["any"], providers: [], modes: ["agent", "plan", "ask"] },
    activation: { phrases: [options.name, id, ...title(id).split(" ")], intents: [id], fileGlobs: [], slashCommands: [id], auto: true },
    content: {
      instructions: "SKILL.md",
      reasoning: "docs/reasoning.md",
      knowledge: ["knowledge/reference.md"],
      promptTemplates: ["prompts/default.md", "templates/output.md"],
      examples: ["examples/basic.md", "examples/advanced.md"],
      tests: ["tests/selection.md", "tests/permissions.md", "tests/workflow.md"],
      docs: ["README.md", "docs/development.md", "docs/permissions.md"],
      assets: ["assets/icon.svg"],
    },
    contributions: {
      commands: [{ name: id, title: options.name, description: `Run the ${options.name} Skill.`, prompt: `Use the ${options.name} Skill to complete the user's task professionally.` }],
      voiceIntents: [{ id, utterances: [`use ${options.name.toLowerCase()}`, `start ${options.name.toLowerCase()}`, `switch to ${options.name.toLowerCase()}`], action: id, confirmation: "risky" }],
      chatActions: [{ id, title: options.name, description: `Apply ${options.name} expertise to the active conversation.`, prompt: `Apply the ${options.name} Skill.`, requiredPermissions: [] }],
      slashCommands: [{ name: id, title: `/${id}`, description: `Invoke ${options.name}.`, prompt: `Invoke the ${options.name} Skill.` }],
      computerActions: [],
      researchModes: category === "research" ? [{ id: `${id}:research`, title: `${options.name} Research Mode`, description: `Run ${options.name} as a research mode.`, prompt: `Use careful source-aware research for ${options.name}.`, requiredPermissions: ["net"] }] : [],
      planners: [{ id: `${id}:planner`, title: `${options.name} Planner`, description: `Plan work for ${options.name}.`, prompt: "Create a concise plan with risks and validation steps before execution.", requiredPermissions: [] }],
      agentBehaviors: [{ id: `${id}:behavior`, title: `${options.name} Behavior`, description: `Professional behavior profile for ${options.name}.`, prompt: `Operate as a careful, safety-aware ${options.name} expert.`, requiredPermissions: [] }],
      workflows: [{ id: `${id}:workflow`, title: `${options.name} Workflow`, description: `Default production workflow for ${options.name}.`, steps: [
        { id: "intake", title: "Intake", instruction: "Clarify objective, audience, constraints, inputs, risk tolerance, and acceptance criteria.", expectedOutput: "Task brief" },
        { id: "plan", title: "Plan", instruction: "Create a minimal professional plan with assumptions, dependencies, permissions, and validation strategy.", expectedOutput: "Execution plan" },
        { id: "execute", title: "Execute", instruction: "Produce the requested artifact using the standards in SKILL.md and the declared output template.", expectedOutput: "Work product" },
        { id: "validate", title: "Validate", instruction: "Check correctness, completeness, safety, edge cases, and acceptance criteria.", expectedOutput: "Validation notes" },
        { id: "handoff", title: "Handoff", instruction: "Summarize decisions, outputs, residual risks, and next steps.", expectedOutput: "Handoff summary" },
      ] }],
      uiPanels: [{ id: `${id}:panel`, surface: "dashboard", title: options.name, description: `Documentation, permissions, dependencies, and examples for ${options.name}.`, markdown: `# ${options.name}\n\n${description}` }],
      dashboardWidgets: [{ id: `${id}:health`, surface: "dashboard", title: `${options.name} Health`, description: "Shows validation, permissions, dependencies, and package readiness." }],
    },
    tools: [],
    mcp: [],
    plugins: [],
    memoryTemplates: [{ id: `${id}:preferences`, category: "workflow", contentTemplate: `When using ${options.name}, remember the user's preferred standards, output format, and recurring constraints.`, scope: "project", importance: 3 }],
    dependencies: [],
    permissions: defaultPermissions(category),
    settings: [
      { key: "output-depth", title: "Output depth", description: "Controls how detailed the Skill's deliverables should be.", type: "enum", required: false, default: "professional", options: ["concise", "professional", "deep"] },
      { key: "ask-before-side-effects", title: "Ask before side effects", description: "Require confirmation before write/network/shell/computer actions.", type: "boolean", required: false, default: true, options: [] },
    ],
    verification: { level: "unverified" },
  });
}

export class SkillSDK {
  constructor(private readonly marketplace = new SkillMarketplace()) {}

  create(options: SkillCreateOptions): string {
    return this.scaffold(options).dir;
  }

  init(options: SkillInitOptions): SkillScaffoldResult {
    return this.scaffold({ ...options, dir: options.dir });
  }

  scaffold(options: SkillCreateOptions): SkillScaffoldResult {
    const force = options.force ?? false;
    const manifest = manifestFor(options);
    const dir = options.dir ?? join(process.cwd(), manifest.id);
    ensureDir(dir);
    for (const sub of ["assets", "docs", "examples", "knowledge", "prompts", "templates", "tests"]) ensureDir(join(dir, sub));

    const files: SkillFileResult[] = [];
    const put = (rel: string, content: string) => {
      const path = join(dir, rel);
      files.push({ path, status: writeSafe(path, content, force) });
    };

    put("xr-skill.json", JSON.stringify(manifest, null, 2));
    put("SKILL.md", `---\nid: ${manifest.id}\nname: ${manifest.name}\nversion: ${manifest.version}\ndescription: ${manifest.description}\ncategories: [${manifest.categories.join(", ")}]\ntags: [${manifest.tags.join(", ")}]\n---\n\n# ${manifest.name}\n\n## Professional Identity\nYou are the ${manifest.name} XR Skill. You package reusable professional expertise for AI agents.\n\n## Mission\n${manifest.description}\n\n## Operating Principles\n- Understand the user's real objective before optimizing details.\n- Prefer safe, auditable, reversible actions.\n- Explain assumptions, trade-offs, and validation evidence.\n- Produce reusable artifacts, not vague advice.\n- Respect XR approvals before dangerous filesystem, network, shell, memory, voice, provider, MCP, plugin, or computer-control actions.\n\n## Workflow\n1. Intake: collect objective, constraints, inputs, and acceptance criteria.\n2. Plan: identify approach, dependencies, permissions, and risks.\n3. Execute: produce the work product using the templates in this Skill.\n4. Validate: check correctness, completeness, safety, and edge cases.\n5. Handoff: summarize output, decisions, residual risks, and next steps.\n\n## Output Standard\nUse clear headings, concrete steps, and validation notes. If the task is unsafe, out of scope, or missing critical information, stop and ask for clarification.\n`);
    put("README.md", `# ${manifest.name}\n\n${manifest.description}\n\n## Quick start\n\n\`xr skills install-local .\`\n\n## Development\n\n\`xr skill validate .\`\n\`xr skill test .\`\n\`xr skill build .\`\n\`xr skill package .\`\n\n## Structure\n\n- \`xr-skill.json\` — manifest\n- \`SKILL.md\` — primary runtime instructions\n- \`docs/\` — development, reasoning, permission docs\n- \`prompts/\` and \`templates/\` — reusable prompt/output templates\n- \`examples/\` — usage examples\n- \`tests/\` — validation scenarios\n- \`assets/icon.svg\` — icon\n\n## Versioning\n\nCurrent version: \`${manifest.version}\`\n\nUpdate \`xr-skill.json.version\` and \`CHANGELOG.md\` for each release.\n`);
    put("CHANGELOG.md", `# Changelog\n\n## ${manifest.version} - ${new Date().toISOString().slice(0, 10)}\n\n- Initial production Skill generated by XR 2.1B Skill SDK.\n`);
    put("LICENSE", `MIT License\n\nCopyright (c) ${new Date().getFullYear()} ${manifest.publisher}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the software, subject to the MIT license terms.\n`);
    put("assets/icon.svg", iconSvg(manifest.name));
    put("docs/reasoning.md", `# Reasoning Policy\n\nUse structured professional reasoning internally. Surface concise rationale, assumptions, alternatives, risks, and validation evidence without exposing private chain-of-thought.\n`);
    put("docs/permissions.md", `# Permissions\n\n${manifest.permissions.map((p) => `- \`${p.scope}\`${p.dangerous ? " **dangerous**" : ""}: ${p.reason}`).join("\n")}\n\nDangerous permissions are declarations only. XR still asks for approval before side effects.\n`);
    put("docs/development.md", `# Development\n\n## Validate\n\n\`xr skill validate .\`\n\n## Test\n\n\`xr skill test .\`\n\n## Build\n\n\`xr skill build .\`\n\n## Package\n\n\`xr skill package .\`\n\n## Publish preparation\n\n\`xr skill publish .\`\n`);
    put("knowledge/reference.md", `# Reference Knowledge\n\nAdd compact, sourceable, durable domain references here. Keep facts separated from preferences and examples.\n`);
    put("prompts/default.md", `# Default Prompt Template\n\nUse the ${manifest.name} Skill to complete the user's task.\n\nContext:\n- Objective:\n- Constraints:\n- Inputs:\n- Acceptance criteria:\n\nReturn:\n- Summary\n- Work product\n- Validation\n- Risks\n- Next steps\n`);
    put("templates/output.md", `# Output Template\n\n## Summary\n\n## Work Product\n\n## Validation\n\n## Risks\n\n## Next Steps\n`);
    put("examples/basic.md", `# Basic Example\n\nUser: Use ${manifest.name} to help with a realistic task.\n\nXR: Selects the Skill, follows SKILL.md, asks for approvals if needed, produces a professional artifact, and validates it.\n`);
    put("examples/advanced.md", `# Advanced Example\n\nUser provides constraints, dependencies, and a desired deliverable.\n\nXR should:\n1. Restate the objective.\n2. Identify missing inputs.\n3. Use the workflow.\n4. Produce output using templates/output.md.\n5. Validate against acceptance criteria.\n`);
    put("tests/selection.md", `# Selection Test\n\n## Given\nA user task matching: ${manifest.activation.phrases.join(", ")}\n\n## Expected\nXR ranks \`${manifest.id}\` as relevant and loads SKILL.md.\n`);
    put("tests/permissions.md", `# Permission Test\n\n## Expected\nDangerous permissions are declared with reasons and require XR approval before side effects.\n\n${manifest.permissions.map((p) => `- ${p.scope}: ${p.reason}`).join("\n")}\n`);
    put("tests/workflow.md", `# Workflow Test\n\n## Expected\nXR follows intake, plan, execute, validate, and handoff stages before final output.\n`);
    put(".xrskillignore", `.git\nnode_modules\n.DS_Store\n.env\n*.secret\n*.key\n.xrskill/out\n`);
    put("xr-skill.lock", JSON.stringify({ version: 1, skillId: manifest.id, skillVersion: manifest.version, manifestSha256: sha256Text(JSON.stringify(manifest)), generatedAt: new Date().toISOString(), generator: "xr-2.1b-sdk" }, null, 2));

    return { dir, id: manifest.id, manifest, files };
  }

  validate(dir: string) { return this.marketplace.validate(dir); }

  package(dir: string, outFile?: string) { return this.marketplace.package(dir, outFile); }

  publish(dir: string, outDir?: string) {
    const build = this.build(dir);
    if (!build.ok) throw new Error(`skill is not publishable: ${build.errors.join("; ")}`);
    return this.marketplace.publish(dir, outDir);
  }

  build(dir: string, outDir?: string): SkillBuildResult {
    const validation = this.validate(dir);
    const tests = this.test(dir);
    const errors = [...validation.errors, ...tests.errors];
    const warnings = [...validation.warnings, ...tests.warnings];
    const loaded = readSkillManifest(dir);
    if (!validation.ok || !validation.manifest || !loaded.dir || !tests.ok) {
      return { ok: false, validation, tests, errors, warnings };
    }
    const manifest = validation.manifest;
    const root = loaded.dir;
    const targetDir = outDir ?? join(packageCacheDir(), "builds", skillDirName(manifest.id));
    ensureDir(targetDir);
    const packagePath = join(targetDir, `${skillDirName(manifest.id)}-${manifest.version}.xrs`);
    const builtPackage = this.package(dir, packagePath);
    const treeSha256 = hashSkillTree(root);
    const report = {
      schemaVersion: 1,
      type: "xr.skill.build.report",
      skillId: manifest.id,
      version: manifest.version,
      packagePath: builtPackage,
      treeSha256,
      validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings },
      tests,
      files: walk(root).map((file) => relative(root, file).replace(/\\/g, "/")),
      builtAt: new Date().toISOString(),
    };
    const reportPath = join(targetDir, `${skillDirName(manifest.id)}-${manifest.version}.build.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return { ok: true, skillId: manifest.id, version: manifest.version, packagePath: builtPackage, reportPath, treeSha256, validation, tests, errors, warnings };
  }

  test(dir: string): SkillTestResult {
    const validation = this.validate(dir);
    const errors = [...validation.errors];
    const warnings = [...validation.warnings];
    const cases: SkillTestResult["cases"] = [];
    const loaded = readSkillManifest(dir);
    if (!validation.manifest || !loaded.dir) return { ok: false, errors, warnings, cases };
    const root = loaded.dir;
    const manifest = validation.manifest;

    const checkFile = (rel: string, label: string) => {
      const p = join(root, rel);
      const ok = existsSync(p) && statSync(p).size > 0;
      cases.push({ file: rel, ok, reason: ok ? `${label} exists` : `${label} missing or empty` });
      if (!ok) errors.push(`${label} missing or empty: ${rel}`);
    };

    checkFile(manifest.content.instructions, "instructions");
    for (const rel of manifest.content.docs) checkFile(rel, "documentation");
    for (const rel of manifest.content.examples) checkFile(rel, "example");
    for (const rel of manifest.content.tests) checkFile(rel, "test scenario");
    if (manifest.icon) checkFile(manifest.icon, "icon");
    if (!existsSync(join(root, "CHANGELOG.md"))) warnings.push("CHANGELOG.md missing; version history should be documented");
    if (!manifest.contributions.workflows.length) errors.push("manifest must declare at least one workflow");
    if (!manifest.contributions.commands.length && !manifest.contributions.slashCommands.length) warnings.push("no command or slash-command contribution declared");
    for (const permission of manifest.permissions) {
      if (!permission.reason.trim()) errors.push(`permission ${permission.scope} lacks reason`);
    }
    return { ok: errors.length === 0 && cases.every((c) => c.ok), errors, warnings, cases };
  }

  doctor(dir = process.cwd()): SkillDoctorReport {
    const validation = this.validate(dir);
    const loaded = readSkillManifest(dir);
    const root = loaded.dir ?? dir;
    const tests = this.test(dir);
    const checks: SkillDoctorCheck[] = [
      { id: "manifest", ok: validation.ok && Boolean(validation.manifest), detail: validation.ok ? `valid manifest ${validation.manifest?.id}@${validation.manifest?.version}` : validation.errors.join("; ") },
      { id: "instructions", ok: Boolean(validation.manifest && existsSync(join(root, validation.manifest.content.instructions))), detail: "SKILL.md/instructions file is present" },
      { id: "readme", ok: existsSync(join(root, "README.md")), detail: "README.md is present" },
      { id: "changelog", ok: existsSync(join(root, "CHANGELOG.md")), detail: "CHANGELOG.md is present for versioning" },
      { id: "icon", ok: Boolean(validation.manifest?.icon && existsSync(join(root, validation.manifest.icon))), detail: "icon asset is present" },
      { id: "tests", ok: tests.ok, detail: tests.ok ? `${tests.cases.length} test checks passed` : tests.errors.join("; ") },
      { id: "package", ok: validation.ok && tests.ok, detail: validation.ok && tests.ok ? "ready to build/package" : "fix validation/test errors before packaging" },
    ];
    return { ok: checks.every((c) => c.ok), dir, checks };
  }
}
