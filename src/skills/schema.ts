/**
 * XR Stage 13 — Professional Skill schema.
 *
 * A Skill is a reusable professional capability for AI agents.  It is intentionally
 * richer than a prompt: it may declare instructions, reasoning policy, tools,
 * MCP requirements, workflow templates, voice/computer actions, UI panels,
 * tests, examples, memory templates, dependencies, settings and permissions.
 */
import { z } from "zod";
import { PERMISSION_SCOPES } from "../plugins/types.ts";

const Identifier = z
  .string()
  .min(2)
  .max(120)
  .regex(/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?$/i, "invalid identifier");

const Slug = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i, "invalid slug");

const RelPath = z
  .string()
  .min(1)
  .max(300)
  .refine((p) => !p.startsWith("/") && !p.startsWith("\\") && !p.split(/[\\/]/).includes(".."), "must be a contained relative path");

const Semver = z.string().min(1).max(40).regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "must be semver");
const SemverRange = z.string().min(1).max(80).regex(/^[\d.\sxX*<>=~^|-]+$/, "invalid semver range");

export const SKILL_SCHEMA_VERSION = 1;

export const SKILL_CATEGORIES = [
  "developer",
  "business",
  "security",
  "research",
  "creative",
  "productivity",
  "data",
  "operations",
  "voice",
  "ui",
  "workflow",
  "memory",
  "mcp",
  "agent",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SKILL_PERMISSION_SCOPES = [
  ...PERMISSION_SCOPES,
  "skill:install",
  "skill:update",
  "skill:publish",
  "skill:execute",
  "workflow:run",
  "computer:read-screen",
  "computer:act",
  "analytics:write",
] as const;
export type SkillPermissionScope = (typeof SKILL_PERMISSION_SCOPES)[number];

export const SkillPermissionSchema = z.object({
  scope: z.enum(SKILL_PERMISSION_SCOPES),
  reason: z.string().min(1).max(800),
  optional: z.boolean().default(false),
  dangerous: z.boolean().default(false),
  paths: z.array(RelPath).default([]),
  domains: z.array(z.string().min(1).max(240)).default([]),
});
export type SkillPermission = z.infer<typeof SkillPermissionSchema>;

export const SkillDependencySchema = z.object({
  kind: z.enum(["skill", "plugin", "mcp", "provider", "binary", "npm", "python", "model", "memory-template"]),
  id: z.string().min(1).max(160),
  version: z.string().min(1).max(120).optional(),
  optional: z.boolean().default(false),
  reason: z.string().max(800).optional(),
});
export type SkillDependency = z.infer<typeof SkillDependencySchema>;

export const SkillCommandSchema = z.object({
  name: Slug,
  title: z.string().min(1).max(120),
  description: z.string().max(800).default(""),
  usage: z.string().max(300).optional(),
  prompt: z.string().max(4000).optional(),
});
export type SkillCommand = z.infer<typeof SkillCommandSchema>;

export const SkillVoiceIntentSchema = z.object({
  id: Slug,
  utterances: z.array(z.string().min(1).max(200)).min(1).max(40),
  action: z.string().min(1).max(160),
  confirmation: z.enum(["never", "risky", "always"]).default("risky"),
});
export type SkillVoiceIntent = z.infer<typeof SkillVoiceIntentSchema>;

export const SkillActionSchema = z.object({
  id: Slug,
  title: z.string().min(1).max(120),
  description: z.string().max(800).default(""),
  prompt: z.string().max(4000).optional(),
  requiredPermissions: z.array(z.enum(SKILL_PERMISSION_SCOPES)).default([]),
});
export type SkillAction = z.infer<typeof SkillActionSchema>;

export const SkillWorkflowSchema = z.object({
  id: Slug,
  title: z.string().min(1).max(140),
  description: z.string().max(1000).default(""),
  steps: z.array(z.object({
    id: Slug,
    title: z.string().min(1).max(160),
    instruction: z.string().min(1).max(2000),
    expectedOutput: z.string().max(1000).optional(),
  })).min(1).max(40),
});
export type SkillWorkflow = z.infer<typeof SkillWorkflowSchema>;

export const SkillUiPanelSchema = z.object({
  id: Slug,
  surface: z.enum(["dashboard", "sidebar", "settings", "command-palette", "chat", "report"]),
  title: z.string().min(1).max(140),
  description: z.string().max(800).default(""),
  markdown: z.string().max(8000).optional(),
});
export type SkillUiPanel = z.infer<typeof SkillUiPanelSchema>;

export const SkillMemoryTemplateSchema = z.object({
  id: Slug,
  category: z.enum(["preference", "project", "workflow", "fact", "exclusion"]),
  contentTemplate: z.string().min(1).max(1000),
  scope: z.enum(["global", "project"]).default("project"),
  importance: z.number().int().min(1).max(5).default(3),
});
export type SkillMemoryTemplate = z.infer<typeof SkillMemoryTemplateSchema>;

export const SkillManifestSchema = z.object({
  schemaVersion: z.literal(SKILL_SCHEMA_VERSION).default(SKILL_SCHEMA_VERSION),
  id: Identifier,
  name: z.string().min(1).max(180),
  version: Semver,
  description: z.string().min(1).max(2400),
  longDescription: z.string().max(12000).optional(),
  publisher: z.string().min(1).max(160).default("xr"),
  license: z.string().min(1).max(80).default("MIT"),
  homepage: z.string().max(800).optional(),
  repository: z.string().max(800).optional(),
  icon: RelPath.optional(),
  categories: z.array(z.enum(SKILL_CATEGORIES)).min(1).max(6),
  tags: z.array(z.string().min(1).max(48)).default([]),
  keywords: z.array(z.string().min(1).max(48)).default([]),
  compatibility: z.object({
    xr: SemverRange.default(">=1.0.0"),
    os: z.array(z.enum(["linux", "darwin", "win32", "any"])).default(["any"]),
    providers: z.array(z.string().min(1).max(120)).default([]),
    modes: z.array(z.enum(["agent", "plan", "ask"])).default(["agent", "plan", "ask"]),
  }).default({}),
  activation: z.object({
    phrases: z.array(z.string().min(1).max(160)).default([]),
    intents: z.array(Slug).default([]),
    fileGlobs: z.array(z.string().min(1).max(160)).default([]),
    slashCommands: z.array(Slug).default([]),
    auto: z.boolean().default(true),
  }).default({}),
  content: z.object({
    instructions: RelPath.default("SKILL.md"),
    reasoning: RelPath.optional(),
    knowledge: z.array(RelPath).default([]),
    promptTemplates: z.array(RelPath).default([]),
    examples: z.array(RelPath).default([]),
    tests: z.array(RelPath).default([]),
    docs: z.array(RelPath).default(["README.md"]),
    assets: z.array(RelPath).default([]),
  }).default({}),
  contributions: z.object({
    commands: z.array(SkillCommandSchema).default([]),
    voiceIntents: z.array(SkillVoiceIntentSchema).default([]),
    chatActions: z.array(SkillActionSchema).default([]),
    slashCommands: z.array(SkillCommandSchema).default([]),
    computerActions: z.array(SkillActionSchema).default([]),
    researchModes: z.array(SkillActionSchema).default([]),
    planners: z.array(SkillActionSchema).default([]),
    agentBehaviors: z.array(SkillActionSchema).default([]),
    workflows: z.array(SkillWorkflowSchema).default([]),
    uiPanels: z.array(SkillUiPanelSchema).default([]),
    dashboardWidgets: z.array(SkillUiPanelSchema).default([]),
  }).default({}),
  tools: z.array(z.string().min(1).max(120)).default([]),
  mcp: z.array(z.object({
    id: z.string().min(1).max(120),
    required: z.boolean().default(false),
    tools: z.array(z.string().min(1).max(120)).default([]),
    reason: z.string().max(800).optional(),
  })).default([]),
  plugins: z.array(z.object({
    id: z.string().min(1).max(120),
    required: z.boolean().default(false),
    reason: z.string().max(800).optional(),
  })).default([]),
  memoryTemplates: z.array(SkillMemoryTemplateSchema).default([]),
  dependencies: z.array(SkillDependencySchema).default([]),
  permissions: z.array(SkillPermissionSchema).default([]),
  settings: z.array(z.object({
    key: Slug,
    title: z.string().min(1).max(140),
    description: z.string().max(800).default(""),
    type: z.enum(["string", "number", "boolean", "enum", "secret"]),
    required: z.boolean().default(false),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    options: z.array(z.string()).default([]),
  })).default([]),
  verification: z.object({
    level: z.enum(["unverified", "community", "reviewed", "verified", "official"]).default("unverified"),
    checksum: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    signature: z.string().max(4000).optional(),
    reviewedBy: z.string().max(160).optional(),
    reviewedAt: z.string().max(80).optional(),
  }).default({}),
});
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export const PublisherSchema = z.object({
  id: Identifier,
  name: z.string().min(1).max(180),
  description: z.string().max(2000).default(""),
  website: z.string().max(800).optional(),
  verified: z.boolean().default(false),
  trustLevel: z.enum(["unknown", "community", "reviewed", "verified", "official"]).default("unknown"),
});
export type Publisher = z.infer<typeof PublisherSchema>;

export const ReviewSchema = z.object({
  id: z.string().min(1).max(120),
  skillId: Identifier,
  version: Semver,
  author: z.string().min(1).max(160),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(160).default(""),
  body: z.string().max(5000).default(""),
  createdAt: z.number().int(),
});
export type SkillReview = z.infer<typeof ReviewSchema>;

export const InstallationSchema = z.object({
  id: Identifier,
  version: Semver,
  source: z.enum(["bundled", "local", "git", "url", "package", "marketplace"]),
  sourceUrl: z.string().max(1000).optional(),
  dir: z.string().min(1).max(1200),
  enabled: z.boolean().default(true),
  pinned: z.boolean().default(false),
  favorite: z.boolean().default(false),
  grantedPermissions: z.array(z.enum(SKILL_PERMISSION_SCOPES)).default([]),
  installedAt: z.number().int(),
  updatedAt: z.number().int(),
  lastUsedAt: z.number().int().optional(),
  rollback: z.array(z.object({ version: Semver, dir: z.string().min(1).max(1200), at: z.number().int() })).default([]),
});
export type SkillInstallation = z.infer<typeof InstallationSchema>;

export interface SkillLoadResult {
  ok: boolean;
  manifest?: SkillManifest;
  dir?: string;
  errors: string[];
}
