/**
 * XR 5.0 — Agent and Workflow OS
 *
 * The canonical workflow substrate for XR. Every workflow surface
 * (CLI, API, automation, agents, future visual editor) compiles to this model.
 *
 * Public exports:
 *   - types   — canonical workflow node types, states, versioning
 *   - nodes   — typed factory functions for every node kind
 *   - state-machine — deterministic state transitions
 *   - versioning — definition versioning and migration
 *   - engine — the workflow execution engine
 *   - repository — persistence for definitions, runs, human decisions
 *   - inspection — CLI/daemon/dashboard views
 */

export * from "./types.ts";
export * as nodes from "./nodes.ts";
export * from "./state-machine.ts";
export * from "./versioning.ts";
export * from "./engine.ts";
export * from "./repository.ts";
export * from "./inspection.ts";
