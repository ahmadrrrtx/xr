/*
 * Skills Store (Phase 20) — PURE wire types + mappers. No React, no fetch.
 *
 * The engine (src/skills/ + src/daemon/skills-api.ts) is the source of truth
 * for listings, trust, permissions and quarantine; everything here only
 * translates its shapes into screen vocabulary (chips, badges, categories,
 * copy). Unit-tested from test/desktop/skills-core.test.ts.
 */

// ─── Wire shapes (mirror skills-api.ts publicRecord) ─────────────────────────

export interface WirePermission {
  scope: string;
  reason: string;
  optional: boolean;
  dangerous: boolean;
  paths: string[];
  domains: string[];
}

export interface WireDependency {
  kind: string;
  id: string;
  version?: string;
  optional: boolean;
  reason?: string;
}

export interface WireSetting {
  key: string;
  title: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'secret';
  required: boolean;
  default?: string | number | boolean;
  options: string[];
}

export interface WireCommand {
  name: string;
  title: string;
  description: string;
  usage?: string;
}

export interface QuarantineInfo {
  quarantined: boolean;
  until: number | null;
  remainingMs: number;
  pendingGrants: string[];
  reason: string | null;
}

export interface SkillRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  longDescription: string | null;
  categories: string[];
  tags: string[];
  publisher: string;
  verification: string;
  signed: boolean;
  signingKeyId: string | null;
  homepage: string | null;
  repository: string | null;
  kind: string;
  skillType: string | null;
  source: string;
  enabled: boolean;
  installed: boolean;
  health: string;
  permissions: WirePermission[];
  dependencies: WireDependency[];
  commands: WireCommand[];
  slashCommands: WireCommand[];
  voiceIntents: unknown[];
  workflows: unknown[];
  activation: { phrases: string[]; slashCommands: string[]; auto: boolean };
  settings: WireSetting[];
  rating: { average: number; count: number };
  downloads: number;
  runs: number;
  favorite: boolean;
  pinned: boolean;
  grantedPermissions: string[];
  installedAt: number | null;
  updatedAt: number | null;
  sourceUrl: string | null;
  quarantine: QuarantineInfo;
  settingsValues: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  updateAvailable: boolean;
  /** Online rows only. */
  changelog?: string | null;
  yanked?: boolean;
  registryId?: string | null;
  packageSha256?: string | null;
}

export interface SkillUpdate {
  id: string;
  currentVersion: string;
  latestVersion: string;
  registryId: string;
  packageUrl: string;
  changelog?: string;
}

export interface RegistryEndpoint {
  id: string;
  url: string;
  enabled: boolean;
  trustLevel: string;
  lastSyncAt?: number;
  lastError?: string;
}

export interface MarketplaceResponse {
  health: Record<string, unknown>;
  registries: RegistryEndpoint[];
  updates: SkillUpdate[];
  featuredId: string | null;
  featuredSource?: 'registry' | 'bundled';
  quarantineCopy: { summary: string; limits: string[]; promoteHint: string };
  stats: { installed: number; verified: number; updates: number };
  skills: SkillRecord[];
}

export interface PermissionDecision {
  scope: string;
  declared: boolean;
  granted: boolean;
  dangerous: boolean;
  reason: string;
  needsApproval: boolean;
}

export interface PermissionReport {
  skillId: string;
  safe: PermissionDecision[];
  dangerous: PermissionDecision[];
  missingApproval: PermissionDecision[];
}

export interface DependencyReport {
  skillId: string;
  statuses: Array<{ dependency: WireDependency; satisfied: boolean }>;
  requiredMissing: Array<{ dependency: WireDependency }>;
  optionalMissing: Array<{ dependency: WireDependency }>;
}

export interface InstallResultSummary {
  ok: boolean;
  skillId: string | null;
  version: string | null;
  installed: Array<{ id: string; version: string }>;
  warnings: string[];
  errors: string[];
  quarantineForced: boolean;
  quarantined: boolean;
  quarantineReason: string | null;
}

export interface InstallEvent {
  type: 'step' | 'progress' | 'done' | 'error';
  jobId: string;
  step: 'download' | 'verify' | 'install' | 'validate' | 'ready' | 'error';
  pct: number;
  message: string;
  error?: string;
  result?: InstallResultSummary;
  at: number;
}

export interface McpServer {
  id: string;
  name: string;
  version: string;
  transport: 'stdio' | 'sse' | 'http' | 'streamable-http';
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
  health: string;
  trust: string;
  lifecycleState: string;
  tools: boolean;
  installedAt: number;
}

export interface McpPinDrift {
  status: 'unpinned' | 'match' | 'drift';
  changed: Array<{ tool: string; before: string; after: string }>;
  added: string[];
  removed: string[];
}

export interface FromUrlPreview {
  ok: boolean;
  kind: 'local-dir' | 'package' | 'git' | 'remote' | 'catalog';
  manifest: SkillManifestLite | null;
  warnings: string[];
  errors: string[];
  decision: { forced: boolean; reason: string; detail: string };
  packageSha256?: string;
}

export interface SkillManifestLite {
  id: string;
  name: string;
  version: string;
  description: string;
  longDescription?: string;
  publisher: string;
  categories: string[];
  tags: string[];
  permissions: WirePermission[];
  dependencies: WireDependency[];
  settings: WireSetting[];
  verification: { level: string; signature?: string };
  activation?: { phrases: string[]; slashCommands: string[] };
  skillType?: string;
}

// ─── Categories (brief §4 — rows the sidebar shows) ──────────────────────────

export type CategoryId =
  | 'featured'
  | 'installed'
  | 'updates'
  | 'developer'
  | 'productivity'
  | 'research'
  | 'creative'
  | 'browser'
  | 'files'
  | 'communication'
  | 'operations'
  | 'data'
  | 'memory'
  | 'agents'
  | 'security'
  | 'custom-mcp';

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /** Engine categories this row aggregates. */
  engineCategories: string[];
  /** Tag/keyword fallback for rows the engine category list does not name. */
  tagHints: string[];
  /** "Custom MCP" opens the add-server form instead of filtering. */
  action?: 'add-mcp';
}

export const CATEGORY_DEFS: readonly CategoryDef[] = [
  { id: 'featured', label: 'Featured', engineCategories: [], tagHints: [] },
  { id: 'installed', label: 'Installed', engineCategories: [], tagHints: [] },
  { id: 'updates', label: 'Updates', engineCategories: [], tagHints: [] },
  { id: 'developer', label: 'Developer Tools', engineCategories: ['developer', 'mcp'], tagHints: [] },
  { id: 'productivity', label: 'Productivity', engineCategories: ['productivity', 'business'], tagHints: [] },
  { id: 'research', label: 'Research', engineCategories: ['research'], tagHints: [] },
  { id: 'creative', label: 'Media / Creative', engineCategories: ['creative', 'voice', 'ui'], tagHints: [] },
  {
    id: 'browser',
    label: 'Browser & Web',
    engineCategories: [],
    tagHints: ['browser', 'web', 'http', 'fetch', 'scrape', 'crawl', 'search', 'url'],
  },
  {
    id: 'files',
    label: 'Files & Folders',
    engineCategories: [],
    tagHints: ['file', 'files', 'folder', 'pdf', 'document', 'docs', 'filesystem', 'organizer', 'excel', 'word', 'ppt'],
  },
  {
    id: 'communication',
    label: 'Communication',
    engineCategories: [],
    tagHints: ['email', 'mail', 'gmail', 'slack', 'chat', 'message', 'communication', 'social', 'notion', 'calendar'],
  },
  { id: 'operations', label: 'Cloud & DevOps', engineCategories: ['operations'], tagHints: ['devops', 'docker', 'kubernetes', 'cloud', 'deploy'] },
  { id: 'data', label: 'Data & Databases', engineCategories: ['data'], tagHints: ['database', 'sql', 'db', 'postgres', 'sqlite'] },
  { id: 'memory', label: 'Memory', engineCategories: ['memory'], tagHints: [] },
  { id: 'agents', label: 'Agents & Workflows', engineCategories: ['agent', 'workflow'], tagHints: [] },
  { id: 'security', label: 'Security', engineCategories: ['security'], tagHints: [] },
  { id: 'custom-mcp', label: 'Custom MCP', engineCategories: [], tagHints: [], action: 'add-mcp' },
];

export function categoryMatches(record: SkillRecord, def: CategoryDef): boolean {
  if (def.engineCategories.some((c) => record.categories.includes(c))) return true;
  if (!def.tagHints.length) return false;
  const haystack = [...record.tags, ...record.categories, record.name, record.description].join(' ').toLowerCase();
  return def.tagHints.some((t) => haystack.includes(t));
}

/** What the grid shows for a given sidebar selection. */
export function filterByCategory(records: SkillRecord[], id: CategoryId): SkillRecord[] {
  switch (id) {
    case 'featured':
      // Featured hero + the rest of the catalog underneath (app-store style).
      return records;
    case 'installed':
      return records.filter((r) => r.installed);
    case 'updates':
      return records.filter((r) => r.installed && r.updateAvailable);
    default: {
      const def = CATEGORY_DEFS.find((d) => d.id === id);
      return def ? records.filter((r) => categoryMatches(r, def)) : records;
    }
  }
}

export function categoryCount(records: SkillRecord[], id: CategoryId): number {
  return filterByCategory(records, id).length;
}

// ─── Search ──────────────────────────────────────────────────────────────────

export function matchesQuery(record: SkillRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = [record.id, record.name, record.description, record.publisher, ...record.categories, ...record.tags]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((term) => fields.includes(term));
}

// ─── Trust vocabulary (honest, calm) ────────────────────────────────────────

export type TrustLevel = 'official' | 'verified' | 'reviewed' | 'community' | 'unsigned';

export function trustOf(record: Pick<SkillRecord, 'verification' | 'signed' | 'source'>): TrustLevel {
  const level = (record.verification ?? 'unverified').toLowerCase();
  if (level === 'official') return 'official';
  if (level === 'verified') return 'verified';
  if (level === 'reviewed') return 'reviewed';
  if (record.signed && (level === 'community' || level === 'unknown')) return 'community';
  if (level === 'community') return 'community';
  return 'unsigned';
}

export const TRUST_LABEL: Record<TrustLevel, string> = {
  official: 'official',
  verified: 'verified',
  reviewed: 'reviewed',
  community: 'community',
  unsigned: 'Unsigned — use caution',
};

export const TRUST_DETAIL: Record<TrustLevel, string> = {
  official: 'Published by the XR team and shipped with the product.',
  verified: 'Publisher identity and package signature verified by an XR registry.',
  reviewed: 'Reviewed by a registry curator; signature on file.',
  community: 'Community publisher. Check the permissions before installing.',
  unsigned: 'XR cannot verify who published this skill.',
};

export function isTrustedPublisher(level: TrustLevel): boolean {
  return level === 'official' || level === 'verified';
}

// ─── Permission chips (nutrition-label style) ───────────────────────────────

export interface PermissionChip {
  scope: string;
  label: string;
  dangerous: boolean;
  /** Short consequence sentence for the install modal ("what this lets it do"). */
  consequence: string;
}

const CHIPS: Record<string, Omit<PermissionChip, 'scope' | 'dangerous'>> = {
  'fs:read': { label: 'Read files', consequence: 'Can read files on your computer.' },
  'fs:write': { label: 'Write files', consequence: 'Can create and change files on your computer.' },
  net: { label: 'Internet', consequence: 'Can reach the web through XR’s logged egress proxy.' },
  browser: { label: 'Browser', consequence: 'Can drive a web browser on your behalf.' },
  'memory:read': { label: 'Read memory', consequence: 'Can read what XR remembers.' },
  'memory:write': { label: 'Write memory', consequence: 'Can change what XR remembers.' },
  provider: { label: 'Use models', consequence: 'Can call paid AI models through your budget.' },
  voice: { label: 'Voice', consequence: 'Can speak and listen through XR’s voice layer.' },
  control: { label: 'Computer control', consequence: 'Can request keyboard/mouse control of your computer.' },
  secrets: { label: 'Credentials', consequence: 'Can read your stored credentials and secrets.' },
  ui: { label: 'UI panels', consequence: 'Can add panels to XR’s interface.' },
  mcp: { label: 'MCP tools', consequence: 'Can register MCP servers and call their tools.' },
  shell: { label: 'Shell', consequence: 'Can run shell commands on your computer.' },
  'skill:install': { label: 'Install skills', consequence: 'Can install other skills.' },
  'skill:update': { label: 'Update skills', consequence: 'Can update installed skills.' },
  'skill:publish': { label: 'Publish skills', consequence: 'Can publish skill packages.' },
  'skill:execute': { label: 'Run skills', consequence: 'Can execute skill code.' },
  'workflow:run': { label: 'Run workflows', consequence: 'Can run multi-step workflows.' },
  'computer:read-screen': { label: 'Read screen', consequence: 'Can see your screen contents.' },
  'computer:act': { label: 'Computer actions', consequence: 'Can perform computer actions for you.' },
  'analytics:write': { label: 'Write analytics', consequence: 'Can record analytics events.' },
};

export const DANGEROUS_DEFAULT = new Set([
  'fs:write',
  'shell',
  'secrets',
  'control',
  'computer:act',
  'computer:read-screen',
  'browser',
  'skill:install',
  'skill:publish',
]);

export function permissionChip(permission: WirePermission): PermissionChip {
  const meta = CHIPS[permission.scope] ?? {
    label: permission.scope,
    consequence: permission.reason || 'Declared by the skill manifest.',
  };
  return {
    scope: permission.scope,
    label: meta.label,
    consequence: meta.consequence,
    dangerous: permission.dangerous || DANGEROUS_DEFAULT.has(permission.scope),
  };
}

export function hasDangerousPermissions(record: Pick<SkillRecord, 'permissions'>): boolean {
  return record.permissions.some((p) => p.dangerous || DANGEROUS_DEFAULT.has(p.scope));
}

export function dangerSummary(record: Pick<SkillRecord, 'permissions'>): string {
  const worst = record.permissions.find((p) => p.scope === 'shell' || p.scope === 'control' || p.scope === 'computer:act');
  if (worst) return permissionChip(worst).consequence;
  const first = record.permissions.find((p) => p.dangerous || DANGEROUS_DEFAULT.has(p.scope));
  return first ? permissionChip(first).consequence : '';
}

// ─── Brand monograms (no remote logos — color + letter, per brief) ──────────

export interface BrandStyle {
  color: string;
  monogram: string;
}

const BRANDS: Record<string, BrandStyle> = {
  gmail: { color: '#EA4335', monogram: 'G' },
  google: { color: '#4285F4', monogram: 'G' },
  gdrive: { color: '#1FA463', monogram: 'D' },
  drive: { color: '#1FA463', monogram: 'D' },
  calendar: { color: '#1A73E8', monogram: 'C' },
  notion: { color: '#111111', monogram: 'N' },
  slack: { color: '#611F69', monogram: 'S' },
  github: { color: '#24292F', monogram: 'gh' },
  gitlab: { color: '#FC6D26', monogram: 'Gl' },
  figma: { color: '#A259FF', monogram: 'F' },
  linear: { color: '#5E6AD2', monogram: 'L' },
  jira: { color: '#0052CC', monogram: 'J' },
  discord: { color: '#5865F2', monogram: 'Di' },
  twitter: { color: '#1DA1F2', monogram: 'X' },
  x: { color: '#000000', monogram: 'X' },
  openai: { color: '#10A37F', monogram: 'OA' },
  anthropic: { color: '#D97757', monogram: 'An' },
  aws: { color: '#FF9900', monogram: 'AWS' },
  azure: { color: '#0078D4', monogram: 'Az' },
  gcp: { color: '#4285F4', monogram: 'GC' },
  vercel: { color: '#171717', monogram: 'V' },
  stripe: { color: '#635BFF', monogram: 'St' },
  spotify: { color: '#1DB954', monogram: 'Sp' },
  youtube: { color: '#FF0000', monogram: 'YT' },
  linkedin: { color: '#0A66C2', monogram: 'in' },
  dropbox: { color: '#0061FF', monogram: 'Db' },
  zoom: { color: '#2D8CFF', monogram: 'Z' },
  telegram: { color: '#229ED9', monogram: 'Tg' },
  whatsapp: { color: '#25D366', monogram: 'W' },
  shopify: { color: '#7AB55C', monogram: 'Sh' },
  airtable: { color: '#18BFFF', monogram: 'At' },
  hubspot: { color: '#FF7A59', monogram: 'Hs' },
  salesforce: { color: '#00A1E0', monogram: 'Sf' },
  postgres: { color: '#336791', monogram: 'Pg' },
  mysql: { color: '#00758F', monogram: 'My' },
  mongodb: { color: '#47A248', monogram: 'Mg' },
  redis: { color: '#DC382D', monogram: 'Rd' },
  docker: { color: '#2496ED', monogram: 'Dk' },
  kubernetes: { color: '#326CE5', monogram: 'K8' },
  cloudflare: { color: '#F38020', monogram: 'Cf' },
  arxiv: { color: '#B31B1B', monogram: 'Ax' },
  pdf: { color: '#C22F2F', monogram: 'PDF' },
  excel: { color: '#217346', monogram: 'Xl' },
  word: { color: '#2B579A', monogram: 'Wd' },
  powerpoint: { color: '#D24726', monogram: 'Pp' },
  outlook: { color: '#0078D4', monogram: 'Ol' },
  teams: { color: '#6264A7', monogram: 'Tm' },
};

export function brandFor(record: Pick<SkillRecord, 'id' | 'name' | 'tags' | 'categories'>): BrandStyle | null {
  const haystack = [record.id, record.name, ...record.tags].join(' ').toLowerCase();
  // Longest key first so "google drive" prefers "gdrive" exact tokens over "google".
  for (const key of Object.keys(BRANDS).sort((a, b) => b.length - a.length)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack)) return BRANDS[key];
  }
  return null;
}

// ─── Skill-type + state vocabulary ──────────────────────────────────────────

export function typeLabel(skillType: string | null | undefined): string {
  switch (skillType) {
    case 'executable':
      return 'executable';
    case 'connector':
      return 'connector';
    case 'prompt-pack':
      return 'prompt pack';
    case 'knowledge-pack':
      return 'knowledge pack';
    case 'experimental':
      return 'experimental';
    default:
      return 'skill';
  }
}

export type CardState = 'install' | 'installed' | 'disabled' | 'quarantined' | 'update';

export function cardState(record: SkillRecord): CardState {
  if (record.installed && record.quarantine.quarantined) return 'quarantined';
  if (record.installed && record.updateAvailable) return 'update';
  if (record.installed && !record.enabled) return 'disabled';
  if (record.installed) return 'installed';
  return 'install';
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function formatRemaining(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function formatDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Quarantine copy (single voice, calm) ───────────────────────────────────

export const QUARANTINE_COPY = Object.freeze({
  summary: 'Quarantine — safer for new skills',
  toggle: 'Run in quarantine first 48 hours',
  recommend: 'RECOMMENDED',
  limits: [
    'cannot read or write files outside ~/xr/scratch/',
    'cannot run shell commands',
    'can only reach the web through a logged proxy',
    'cannot access your credentials or secrets',
    'needs your approval for every invocation',
  ],
  offWarning: 'Not recommended for untrusted publishers. XR will not sandbox this skill.',
  badge: 'Skill is quarantined, requires approval for each use',
  toast: (name: string) => `${name} is quarantined — you'll be asked before every action.`,
  promoteHint: 'After 48 hours with no issues you can promote it to normal access — or promote any time below.',
  promoted: (name: string) => `${name} promoted to normal access.`,
});
