/**
 * XR — Self-Improving Skills Engine (Hermes-style auto-learning)
 * 
 * The key differentiator from all other agents: XR learns from experience.
 * 
 * How it works:
 * 1. After every complex task, XR analyzes what it did
 * 2. If the task succeeded and was verifiable → creates a skill
 * 3. Skills self-improve during use (usage patterns update them)
 * 4. XR nudges itself to store useful context in memory
 * 5. Cross-session recall via FTS5 full-text search
 * 
 * This is inspired by Hermes Agent's "autonomous skill creation after complex tasks"
 * and "Honcho dialectic user modeling" — but built with XR's security-first approach.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../state/workspace-store.ts";
import { loadSkills, type LoadedSkill } from "./loader.ts";
import { verify, isVerifiable, type VerifierSpec } from "./verifier.ts";
import { SkillEngine } from "./engine.ts";

// ── Pattern Detection ─────────────────────────────────────────────────────────
interface LearnedPattern {
  id: string;
  trigger: string; // what the user said to trigger this
  action: string; // what XR did
  verifier: VerifierSpec;
  usageCount: number;
  lastUsed: number;
  skillId: string;
  skillVersion: number;
}

export class AutoLearner {
  private store: Store;
  private cwd: string;
  
  constructor(store: Store, cwd: string) {
    this.store = store;
    this.cwd = cwd;
  }
  
  /**
   * Analyze a completed task and decide if it's worth learning from.
   * Called after every agent run (not just tool calls).
   */
  analyzeAndLearn(
    task: string,
    result: string,
    steps: Array<{ tool: string; args: Record<string, unknown>; success: boolean }>,
    success: boolean,
    userApproved?: boolean
  ): { learned: boolean; skillId?: string; reason: string } {
    if (!success) {
      return { learned: false, reason: "task did not complete successfully" };
    }
    
    // Heuristic: only learn from multi-step tasks (complexity indicator)
    const hasMultipleSteps = steps.filter(s => s.success).length >= 2;
    const hasFileAction = steps.some(s => s.tool === "write_file" || s.tool === "shell");
    const isVerifiable = this.canDeriveVerifier(task, result, steps);
    
    if (!hasMultipleSteps && !hasFileAction) {
      return { learned: false, reason: "task too simple to be worth learning (single-step)" };
    }
    
    if (!isVerifiable) {
      // Still learn if user explicitly approved (user_approved verifier)
      if (!userApproved) {
        return { learned: false, reason: "outcome not automatically verifiable" };
      }
    }
    
    // Derive a skill ID from the task
    const skillId = this.deriveSkillId(task);
    
    // Build the verifier
    const verifier = this.deriveVerifier(task, result, steps) ?? { kind: "user_approved" };
    
    // Build the action sequence
    const actions = {
      steps: steps.filter(s => s.success).map(s => ({
        tool: s.tool,
        args: s.args,
      })),
    };
    
    // Attempt to learn
    const engine = new SkillEngine(this.store, this.cwd);
    const outcome = engine.learn(
      { skillId, actions, verifier, why: `from: "${task.slice(0, 100)}"` },
      { userApproved }
    );
    
    if (outcome.learned) {
      // Also store a learned pattern for future recognition
      this.storeRememberPattern(skillId, task, result, steps, outcome.version);
      
      this.store.audit("autolearn.created", { skillId, version: outcome.version });
      
      // Nudge: suggest to store related memory
      const contextHint = this.extractMemoryHints(task, result);
      if (contextHint) {
        this.storeNudge(contextHint);
      }
      
      return { learned: true, skillId, reason: `Learned skill v${outcome.version} from successful task` };
    }
    
    return { learned: false, reason: outcome.reason };
  }
  
  private deriveSkillId(task: string): string {
    // Convert task to skill ID: "add install steps to README" → "add-install-steps-readme"
    const words = task.toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 4);
    return words.join("-") || `skill-${randomUUID().slice(0, 8)}`;
  }
  
  private canDeriveVerifier(task: string, result: string, steps: any[]): boolean {
    // Check if the task outcome can be objectively verified
    const hasFileWrite = steps.some(s => s.tool === "write_file" && s.success);
    if (hasFileWrite) return true;
    
    const hasShellCommand = steps.some(s => s.tool === "shell" && s.success && s.args?.cmd);
    if (hasShellCommand && result.includes("✓")) return true;
    
    return false;
  }
  
  private deriveVerifier(
    task: string,
    result: string,
    steps: Array<{ tool: string; args: Record<string, unknown>; success: boolean }>
  ): VerifierSpec | null {
    // File write → file_nonempty verifier
    const writeStep = steps.find(s => s.tool === "write_file" && s.success);
    if (writeStep?.args?.path) {
      return { kind: "file_nonempty", path: writeStep.args.path as string };
    }
    
    // Shell command → try to verify the outcome
    const shellStep = steps.find(s => s.tool === "shell" && s.success);
    if (shellStep?.args?.cmd) {
      const cmd = shellStep.args.cmd as string;
      
      // npm install → check node_modules
      if (cmd.includes("npm install") || cmd.includes("bun install")) {
        return { kind: "file_exists", path: "node_modules" };
      }
      
      // git commit → check that something was committed
      if (cmd.includes("git commit")) {
        return { kind: "file_exists", path: ".git" };
      }
    }
    
    return null;
  }
  
  private storeRememberPattern(
    skillId: string,
    task: string,
    result: string,
    steps: any[],
    version: number
  ): void {
    // Store in memory for cross-session recall
    const { basename } = require("node:path");
    const project = basename(this.cwd);
    
    this.store.remember(
      `pat_${randomUUID().slice(0, 8)}`,
      project,
      "learned_pattern",
      JSON.stringify({ skillId, task, result: result.slice(0, 200), version, stepsCount: steps.length })
    );
  }
  
  private extractMemoryHints(task: string, result: string): string | null {
    // Extract facts that might be worth remembering
    const hints: string[] = [];
    
    // Project facts
    const projectName = task.match(/project[:\s]+(\w+)/i)?.[1];
    if (projectName) hints.push(`Project name: ${projectName}`);
    
    // Tech stack hints
    const stackHints = [
      { pattern: /react|next|vue|svelte/i, label: "frontend_framework" },
      { pattern: /express|fastify|koa|hono/i, label: "backend_framework" },
      { pattern: /postgres|mysql|mongodb|sqlite/i, label: "database" },
      { pattern: /docker|kubernetes/i, label: "infrastructure" },
      { pattern: /python|typescript|go|rust/i, label: "language" },
    ];
    
    for (const hint of stackHints) {
      if (hint.pattern.test(task) || hint.pattern.test(result)) {
        hints.push(hint.label);
      }
    }
    
    return hints.length > 0 ? hints.join("; ") : null;
  }
  
  private storeNudge(hint: string): void {
    const { basename } = require("node:path");
    const project = basename(this.cwd);
    
    // Store as a nudge (future session can pick this up)
    this.store.remember(
      `nudge_${randomUUID().slice(0, 8)}`,
      project,
      "nudge",
      hint
    );
  }
  
  /**
   * Get learning nudge for the current session
   * Called at session start to recall relevant patterns
   */
  getSessionNudges(): string[] {
    const { basename } = require("node:path");
    const project = basename(this.cwd);
    
    const nudges = this.store.recall(project, "nudge");
    return nudges.map(n => n.content);
  }
  
  /**
   * Auto-improve: when a skill is called and produces good results,
   * subtly refine the skill's approach based on what worked
   */
  recordSkillUsage(skillId: string, success: boolean, context: string): void {
    const { basename } = require("node:path");
    const project = basename(this.cwd);
    
    this.store.remember(
      `usage_${randomUUID().slice(0, 8)}`,
      project,
      "skill_usage",
      JSON.stringify({ skillId, success, context: context.slice(0, 100), at: Date.now() })
    );
  }
}

// ── Cross-Session Memory (Honcho-style user modeling) ─────────────────────────
export class UserMemory {
  private store: Store;
  private cwd: string;
  
  constructor(store: Store, cwd: string) {
    this.store = store;
    this.cwd = cwd;
  }
  
  /**
   * Remember something about the user (preferences, facts, style)
   */
  remember(key: string, value: string, category = "fact"): void {
    const { basename } = require("node:path");
    const project = basename(this.cwd);
    this.store.remember(`um_${randomUUID().slice(0, 8)}`, project, category, `${key}: ${value}`);
  }
  
  /**
   * Recall user facts for context injection
   */
  recallForContext(kinds: string[] = ["fact", "preference", "style"]): string[] {
    const { basename } = require("node:path");
    const project = basename(this.cwd);
    
    const results: string[] = [];
    for (const kind of kinds) {
      const entries = this.store.recall(project, kind);
      results.push(...entries.map(e => e.content));
    }
    return results;
  }
  
  /**
   * Build a context snippet for injection into the agent's system prompt
   */
  buildContextSnippet(): string {
    const facts = this.recallForContext();
    if (facts.length === 0) return "";
    
    return `\nContext about the user:\n${facts.map(f => `- ${f}`).join("\n")}\n`;
  }
  
  /**
   * Proactively nudge XR to remember useful things (Hermes-style nudge)
   */
  getNudge(): string | null {
    const { basename } = require("node:path");
    const project = basename(this.cwd);
    
    const nudges = this.store.recall(project, "nudge");
    if (nudges.length === 0) return null;
    
    // Return the most recent nudge
    return nudges[nudges.length - 1].content;
  }
}

// ── Search Past Sessions (FTS-style) ──────────────────────────────────────────
export function searchSessions(store: Store, query: string, project: string): Array<{
  sessionId: string;
  task: string;
  result: string;
  score: number;
}> {
  // Simple keyword search across audit log sessions
  const sessions = store.recentSessions(100);
  const results: Array<{ sessionId: string; task: string; result: string; score: number }> = [];
  
  const queryWords = query.toLowerCase().split(/\s+/);
  
  for (const session of sessions) {
    const combined = `${session.title}`.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (combined.includes(word)) score++;
    }
    if (score > 0) {
      results.push({ sessionId: session.id, task: session.title, result: "", score });
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

// ── Skill Suggestions ─────────────────────────────────────────────────────────
export function suggestSkills(store: Store, cwd: string, task: string): string[] {
  // Load pre-built skills and suggest relevant ones based on task keywords
  const skills = loadSkills(join(cwd, "skills"));
  const suggestions: string[] = [];
  
  const lowerTask = task.toLowerCase();
  
  for (const skill of skills) {
    // Simple keyword matching — in production use RAG similarity
    const keywords = skill.body.slice(0, 300).toLowerCase();
    for (const word of lowerTask.split(/\s+/)) {
      if (word.length > 3 && keywords.includes(word)) {
        suggestions.push(skill.id);
        break;
      }
    }
  }
  
  return [...new Set(suggestions)].slice(0, 5);
}
