# T01 / D1 — evidence: `new Function()` code execution in workflow conditions

Priority P0 · OWASP LLM05 (Improper Output Handling) · plan source 3/D1

## The defect

`src/execution/workflow/engine.ts:1099` (base commit `1834fd16`):

```ts
} else if (c.type === "expression") {
  // Safe eval for simple expressions — in production, use a proper expression parser
  try {
    conditionResult = !!new Function("ctx", `"use strict"; return (${c.expression});`)(availableOutputs);
  } catch {
    conditionResult = false;
  }
}
```

The `expression` string is data from a workflow definition. Definitions are authored in the
desktop inspector (`desktop/src/screens/Agents/workflows/Inspector.tsx` offered a
`Raw expression` option and a free-text box), imported from files, or produced by a model.
`new Function` compiles that string in the engine's own realm, so the author gets the
engine's globals: `process`, `require`, the filesystem, every loaded module. The comment
calls it "safe eval"; it is not an eval scope, it is host execution.

Reachability, verified: the string is *user-reachable from the shipped UI*, not dead code.

```
$ grep -n "Raw expression" desktop/src/screens/Agents/workflows/Inspector.tsx
488:                <option value="expression">Raw expression</option>
```

## The fix — the `expression` condition type is removed

The plan allowed either a restricted parser or removal. Removal was chosen: the condition
type had **no tests, no documentation and no user apart from that one raw text box**, and
removing it eliminates the whole class instead of narrowing it. A parser kept a
surface that nothing depended on.

| File | Change |
|---|---|
| `src/execution/workflow/types.ts` | dropped `{ type: "expression" }` from `BranchCondition`; added exported `BRANCH_CONDITION_TYPES` allow-list |
| `src/execution/workflow/engine.ts` | deleted the `new Function` branch; unknown condition type is now a **hard error** on that node, not a silent `false` |
| `src/execution/workflow/lint.ts` | replaced the empty-expression check with `branch_unsupported_condition`, so a stored legacy workflow is rejected at lint time |
| `src/execution/workflow/canvas.ts` | removed the `expression` case and the `expression` default key |
| `desktop/src/screens/Agents/workflows/Inspector.tsx` | removed the `Raw expression` option and the expression input (no dead control left behind) |
| `desktop/src/agents/canvasCore.ts` | same, in the renderer's canvas defaults and branch validation |

Engine guard (defense in depth — a workflow can arrive as stored JSON that never passed a
type checker):

```ts
if (!(BRANCH_CONDITION_TYPES as readonly string[]).includes(c.type)) {
  throw new Error(`branch node "${node.id}" has unsupported condition type "${c.type}" — ` +
    `raw expressions are not evaluated; use a typed condition`);
}
```

## Tests — and proof they fail on the old code

New file `test/workflow/branch-condition-safety.test.ts`: 13 tests, 8 hostile payloads
(`constructor.constructor("return process")()`, `globalThis.__XR_PWNED__ = 1`,
`require("node:fs").writeFileSync(...)`, `__proto__` pollution, …), plus a typed-condition
regression test, a lint test, a canvas test, a source scan for evaluator primitives, and a
type-surface test.

### GREEN — with the fix

```
$ TMPDIR=/home/user/tmp bun test test/workflow/branch-condition-safety.test.ts
(pass) … expression condition is not evaluated: constructor.constructor("return process")() [27.08ms]
(pass) … expression condition is not evaluated: globalThis.__XR_PWNED__ = 1 [15.95ms]
… (13 total)
 13 pass
 0 fail
 51 expect() calls
```

### RED — the same tests against the base-commit engine

`git checkout 1834fd16 -- src/execution/workflow/engine.ts`, then the same command:

```
$ grep -n "new Function" src/execution/workflow/engine.ts
1099:          conditionResult = !!new Function("ctx", `"use strict"; return (${c.expression});`)(availableOutputs);
(fail) … expression condition is not evaluated: globalThis.__XR_PWNED__ = 1 [15.92ms]
(fail) … no evaluator primitive exists anywhere in src/execution/workflow [6.08ms]
 4 pass
 9 fail
```

The hostile tests fail **because the payload executed**. That is the defect, demonstrated.

## Gates run

| Gate | Command | Result |
|---|---|---|
| root typecheck | `npx tsc --noEmit` | exit 0 |
| workflow + execution suites | `TMPDIR=/home/user/tmp bun test test/workflow/ test/execution/` | `212 pass, 0 fail` |
| API contract | `bun run api:schema:check` | `OK — 292 operations` |
| generated client | `bun run client:check` | `OK` |
| desktop typecheck | `cd desktop && npx tsc --noEmit` | exit 0 |
| desktop lint | `npx eslint src/screens/Agents/workflows/Inspector.tsx src/agents/canvasCore.ts` | exit 0 |

The API schema and typed client did not change: workflow definitions are not part of the
HTTP route registry, so no regeneration was required. `api:schema:check` and
`client:check` were run anyway per Rules of Engagement 6.

## Residual risk / follow-up

- Stored workflows written before this change that used `expression` will now fail lint and
  fail the node at run time with an explicit message. That is the intended honest failure;
  no migration is offered because no such workflow exists in the repo, its fixtures, or the
  docs.
- The plan's instruction to audit the other 33 files that spawn processes is separate work,
  tracked as T44 (OWASP LLM05) and T45 (excessive agency).
