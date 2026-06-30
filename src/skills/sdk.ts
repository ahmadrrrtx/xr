/** XR Stage 13 — Skill SDK helpers used by CLI and tests. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SkillMarketplace } from "./marketplace.ts";
import { type SkillCategory, type SkillManifest } from "./schema.ts";

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "new-skill";
}

function title(input: string): string {
  return input.split(/[-_\s]+/).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

export interface SkillCreateOptions {
  id?: string;
  name: string;
  category?: SkillCategory;
  publisher?: string;
  dir?: string;
  description?: string;
}

export class SkillSDK {
  constructor(private readonly marketplace = new SkillMarketplace()) {}

  create(options: SkillCreateOptions): string {
    const id = options.id ?? slugify(options.name);
    const dir = options.dir ?? join(process.cwd(), id);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const sub of ["docs", "examples", "tests", "knowledge", "templates", "assets"]) mkdirSync(join(dir, sub), { recursive: true });

    const manifest: SkillManifest = {
      schemaVersion: 1,
      id,
      name: options.name,
      version: "1.0.0",
      description: options.description ?? `${options.name} is a reusable XR professional capability with instructions, examples, tests, permissions, and documentation.`,
      publisher: options.publisher ?? "local",
      license: "MIT",
      categories: [options.category ?? "productivity"],
      tags: [slugify(options.name), options.category ?? "productivity"],
      keywords: [slugify(options.name), "xr-skill"],
      compatibility: { xr: ">=1.0.0", os: ["any"], providers: [], modes: ["agent", "plan", "ask"] },
      activation: { phrases: [options.name, id], intents: [], fileGlobs: [], slashCommands: [id], auto: true },
      content: { instructions: "SKILL.md", reasoning: "docs/reasoning.md", knowledge: ["knowledge/reference.md"], promptTemplates: ["templates/default.md"], examples: ["examples/basic.md"], tests: ["tests/skill.test.md"], docs: ["README.md"], assets: [] },
      contributions: {
        commands: [{ name: id, title: options.name, description: `Run the ${options.name} skill.`, prompt: `Use the ${options.name} skill to complete the user's task professionally.` }],
        voiceIntents: [{ id, utterances: [`use ${options.name.toLowerCase()}`, `start ${options.name.toLowerCase()}`], action: id, confirmation: "risky" }],
        chatActions: [{ id, title: options.name, description: `Apply ${options.name} to the current task.`, prompt: `Apply the ${options.name} skill.`, requiredPermissions: [] }],
        slashCommands: [{ name: id, title: `/${id}`, description: `Invoke ${options.name}.`, prompt: `Invoke ${options.name}.` }],
        computerActions: [],
        researchModes: [],
        planners: [],
        agentBehaviors: [{ id: `${id}:behavior`, title: `${options.name} behavior`, description: `Adopt the professional standards of ${options.name}.`, prompt: `Behave as a careful ${options.name} expert.`, requiredPermissions: [] }],
        workflows: [{ id: `${id}:workflow`, title: `${options.name} workflow`, description: `Default ${options.name} workflow.`, steps: [
          { id: "intake", title: "Intake", instruction: "Clarify the user's objective, constraints, inputs, risk tolerance, and desired output format.", expectedOutput: "A concise task brief." },
          { id: "execute", title: "Execute", instruction: "Perform the work using the standards in SKILL.md and cite assumptions explicitly.", expectedOutput: "A high-quality result." },
          { id: "validate", title: "Validate", instruction: "Check the result against the acceptance criteria and identify remaining risks.", expectedOutput: "Validation notes and next steps." },
        ] }],
        uiPanels: [{ id: `${id}:panel`, surface: "dashboard", title: options.name, description: `Status and documentation for ${options.name}.`, markdown: `# ${options.name}\n\nInstalled as an XR Skill.` }],
        dashboardWidgets: [],
      },
      tools: [],
      mcp: [],
      plugins: [],
      memoryTemplates: [{ id: `${id}:preference`, category: "workflow", contentTemplate: `When using ${options.name}, remember the user's preferred standards and output format.`, scope: "project", importance: 3 }],
      dependencies: [],
      permissions: [],
      settings: [],
      verification: { level: "unverified" },
    };

    writeFileSync(join(dir, "xr-skill.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(join(dir, "SKILL.md"), `---\nid: ${id}\nname: ${options.name}\nversion: 1.0.0\ndescription: ${manifest.description}\ncategories: [${manifest.categories.join(", ")}]\ntags: [${manifest.tags.join(", ")}]\n---\n\n# ${options.name}\n\n## Role\nYou are operating this XR Skill as a professional ${title(options.category ?? "specialist")}.\n\n## Operating Principles\n- Understand the user's real objective before optimizing details.\n- Prefer safe, auditable, reversible actions.\n- Explain important assumptions and trade-offs.\n- Produce artifacts that a professional teammate can reuse.\n- Ask for approval before dangerous file, network, shell, memory, voice, provider, or computer-control actions.\n\n## Workflow\n1. Intake: collect objective, constraints, context, and acceptance criteria.\n2. Plan: choose a minimal effective path and identify risks.\n3. Execute: deliver the requested artifact or guidance.\n4. Validate: check correctness, completeness, safety, and maintainability.\n5. Handoff: summarize what changed and what should happen next.\n`);
    writeFileSync(join(dir, "README.md"), `# ${options.name}\n\n${manifest.description}\n\n## Install\n\n\`xr skill install ${dir}\`\n\n## Validate\n\n\`xr skill validate ${dir}\`\n\n## Package\n\n\`xr skill package ${dir}\`\n`);
    writeFileSync(join(dir, "docs", "reasoning.md"), `# Reasoning Policy\n\nUse structured, professional reasoning internally. Surface concise rationale, assumptions, risks, and validation evidence without exposing private chain-of-thought.`);
    writeFileSync(join(dir, "knowledge", "reference.md"), `# Reference\n\nAdd durable domain references here. Keep them factual, sourceable, and concise.`);
    writeFileSync(join(dir, "templates", "default.md"), `# Output Template\n\n## Summary\n\n## Work Product\n\n## Validation\n\n## Risks / Next Steps\n`);
    writeFileSync(join(dir, "examples", "basic.md"), `# Example\n\nUser: Use ${options.name} to improve this workflow.\n\nXR: Applies the skill workflow, validates output, and lists next steps.`);
    writeFileSync(join(dir, "tests", "skill.test.md"), `# Skill Test\n\n## Scenario\nA user asks for help in the skill's domain.\n\n## Expected\n- XR selects this skill when relevant.\n- XR follows SKILL.md operating principles.\n- XR asks for approval before dangerous actions.\n- XR produces a reusable professional artifact.`);
    return dir;
  }

  validate(dir: string) { return this.marketplace.validate(dir); }
  package(dir: string, outFile?: string) { return this.marketplace.package(dir, outFile); }
  publish(dir: string, outDir?: string) { return this.marketplace.publish(dir, outDir); }
  test(dir: string): { ok: boolean; errors: string[]; warnings: string[] } {
    const validation = this.validate(dir);
    const errors = [...validation.errors];
    const warnings = [...validation.warnings];
    if (!validation.manifest) return { ok: false, errors, warnings };
    if (validation.manifest.permissions.some((p) => p.dangerous && !p.reason.trim())) errors.push("dangerous permission lacks a reason");
    if (validation.manifest.contributions.workflows.length === 0) warnings.push("no workflow contribution declared");
    return { ok: errors.length === 0, errors, warnings };
  }
}
