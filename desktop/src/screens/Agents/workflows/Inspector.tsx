/*
 * Node inspector (Phase 19) — 320 px, one form per node kind. Every field
 * maps 1:1 onto a key the engine's canvas compiler reads
 * (src/execution/workflow/canvas.ts); nothing here invents semantics.
 * Branch conditions are offered exactly as the engine evaluates them:
 * fields are upstream node ids, approval/review conditions name a human
 * node. There is no expression editor (out of scope) — the raw expression
 * box is labelled as such.
 */
import { X } from 'lucide-react';
import { useMemo } from 'react';

import { kindMeta } from '@/agents/canvasCore';
import { selectCustom, selectPrebuilt, useAgentsStore } from '@/stores/agentsStore';
import { useWorkflowEditorStore } from '@/stores/workflowEditorStore';

import { ModelSelect } from '../components/ModelSelect';

const RISK = ['low', 'medium', 'high', 'critical'] as const;

export function Inspector() {
  const node = useWorkflowEditorStore((s) => (s.selectedNodeId ? s.nodes.find((n) => n.id === s.selectedNodeId) : undefined));
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const edges = useWorkflowEditorStore((s) => s.edges);
  const problems = useWorkflowEditorStore((s) => s.problems);
  const runInfo = useWorkflowEditorStore((s) => (s.selectedNodeId ? s.progress?.nodes[s.selectedNodeId] : undefined));
  const tools = useAgentsStore((s) => s.tools);
  const prebuilt = useAgentsStore(selectPrebuilt);
  const custom = useAgentsStore(selectCustom);

  const upstream = useMemo(() => {
    if (!node) return [];
    const seen = new Set<string>();
    const stack = edges.filter((e) => e.target === node.id).map((e) => e.source);
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of edges) if (e.target === id) stack.push(e.source);
    }
    return nodes.filter((n) => seen.has(n.id));
  }, [node, nodes, edges]);

  if (!node) {
    return (
      <aside className="xw-inspector" aria-label="Inspector" data-testid="wf-inspector">
        <div className="xw-inspector-head">
          <h3>Inspector</h3>
        </div>
        <div className="xw-inspector-body">
          <p className="xa-help">Select a node to edit it. Double-click a node to rename it. Space-drag pans; ⌘Z undoes.</p>
        </div>
      </aside>
    );
  }

  const meta = kindMeta(node.data.kind);
  const c = node.data.config;
  const patch = (p: Record<string, unknown>): void => useWorkflowEditorStore.getState().updateNodeConfig(node.id, p);
  const nodeProblems = problems.filter((p) => p.nodeId === node.id);
  const str = (k: string, d = ''): string => (c[k] === undefined || c[k] === null ? d : String(c[k]));
  const num = (k: string, d: number): number => (typeof c[k] === 'number' ? (c[k] as number) : Number(c[k] ?? d) || d);
  const humanNodes = nodes.filter((n) => n.data.kind === 'human_approval' || n.data.kind === 'human_review');

  return (
    <aside className="xw-inspector" aria-label={`Inspector: ${node.data.label}`} data-testid="wf-inspector">
      <div className="xw-inspector-head">
        <h3 style={{ color: meta.color }}>{meta.label}</h3>
        <span className="xa-help" style={{ fontFamily: 'var(--font-mono)' }}>{node.id}</span>
        <button type="button" className="xa-btn xa-btn--icon" aria-label="Close inspector" style={{ marginLeft: 'auto' }} onClick={() => useWorkflowEditorStore.getState().selectNode(null)}>
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="xw-inspector-body">
        {nodeProblems.length ? (
          <div className="xa-note xa-note--warn" role="status">
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {nodeProblems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {runInfo ? (
          <dl className="xa-kv" data-testid="wf-inspector-run">
            <div>
              <dt>run state</dt>
              <dd>{runInfo.state.replace(/_/g, ' ')}{runInfo.attempt > 1 ? ` · attempt ${runInfo.attempt}` : ''}</dd>
            </div>
            {runInfo.error ? (
              <div>
                <dt>error</dt>
                <dd style={{ color: 'var(--danger)' }}>{runInfo.error}</dd>
              </div>
            ) : null}
            {runInfo.outputs ? (
              <div>
                <dt>outputs</dt>
                <dd>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(runInfo.outputs, null, 1).slice(0, 1200)}</pre>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <Field id="xw-insp-name" label="Name">
          <input id="xw-insp-name" className="xa-input" value={node.data.label} maxLength={80} onChange={(e) => useWorkflowEditorStore.getState().updateNode(node.id, { label: e.target.value })} data-testid="wf-insp-name" />
        </Field>

        {node.data.kind === 'input' && (
          <>
            <Field id="i-param" label="Parameter name" help="Letters, numbers and underscores. Becomes a run parameter.">
              <input id="i-param" className="xa-input" value={str('paramName')} onChange={(e) => patch({ paramName: e.target.value.replace(/[^A-Za-z0-9_]/g, '_') })} data-testid="wf-insp-paramName" />
            </Field>
            <Field id="i-type" label="Type">
              <select id="i-type" className="xa-select" value={str('paramType', 'string')} onChange={(e) => patch({ paramType: e.target.value })}>
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="json">json</option>
              </select>
            </Field>
            <Toggle label="Required" checked={c.required === true} onChange={(v) => patch({ required: v })} />
            <Field id="i-default" label="Default value">
              <input id="i-default" className="xa-input" value={str('defaultValue')} onChange={(e) => patch({ defaultValue: e.target.value })} />
            </Field>
            <Field id="i-desc" label="Description">
              <input id="i-desc" className="xa-input" value={str('description')} onChange={(e) => patch({ description: e.target.value })} />
            </Field>
          </>
        )}

        {node.data.kind === 'llm' && (
          <>
            <Field id="l-instr" label="Instruction" help="What this step must produce. Upstream outputs are available to it.">
              <textarea id="l-instr" className="xa-textarea" style={{ minHeight: 110 }} value={str('instruction')} onChange={(e) => patch({ instruction: e.target.value })} data-testid="wf-insp-instruction" />
            </Field>
            <Field id="l-role" label="Agent role">
              <select id="l-role" className="xa-select" value={str('agentRole', 'executor')} onChange={(e) => patch({ agentRole: e.target.value })}>
                {['executor', 'planner', 'researcher', 'builder', 'reviewer', 'verifier', 'synthesizer', 'security_checker'].map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="l-model" label="Model">
              <ModelSelect id="l-model" value={str('model')} onChange={({ model, provider }) => patch({ model, provider })} />
            </Field>
            <Field id="l-sys" label="System prompt (optional)">
              <textarea id="l-sys" className="xa-textarea xa-textarea--mono" style={{ minHeight: 70 }} value={str('systemPrompt')} onChange={(e) => patch({ systemPrompt: e.target.value })} />
            </Field>
            <div className="xa-row">
              <Field id="l-usd" label="Cost cap (USD)">
                <input id="l-usd" type="number" min={0.01} max={50} step={0.05} className="xa-input" value={num('maxUsd', 0.5)} onChange={(e) => patch({ maxUsd: Number(e.target.value) })} />
              </Field>
              <Field id="l-steps" label="Max steps">
                <input id="l-steps" type="number" min={1} max={64} step={1} className="xa-input" value={num('maxSteps', 8)} onChange={(e) => patch({ maxSteps: Number(e.target.value) })} />
              </Field>
            </div>
            <ToolPicker label="Tools" selected={Array.isArray(c.tools) ? (c.tools as string[]) : []} tools={tools} onChange={(next) => patch({ tools: next })} />
            <Field id="l-risk" label="Risk tier">
              <select id="l-risk" className="xa-select" value={str('riskTier', 'low')} onChange={(e) => patch({ riskTier: e.target.value })}>
                {RISK.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Toggle label="Needs review before continuing" checked={c.requiresReview === true} onChange={(v) => patch({ requiresReview: v })} />
          </>
        )}

        {node.data.kind === 'subagent' && (
          <>
            <Field id="s-agent" label="Agent" help="Prebuilt or one of yours. Its tools, permissions and model apply.">
              <select id="s-agent" className="xa-select" value={str('agentId')} onChange={(e) => patch({ agentId: e.target.value })} data-testid="wf-insp-agent">
                <option value="">Choose an agent</option>
                {custom.length ? (
                  <optgroup label="My Agents">
                    {custom.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.custom?.emoji ? `${a.custom.emoji} ` : ''}
                        {a.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label="Prebuilt">
                  {prebuilt.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
            <Field id="s-instr" label="Instruction">
              <textarea id="s-instr" className="xa-textarea" style={{ minHeight: 100 }} value={str('instruction')} onChange={(e) => patch({ instruction: e.target.value })} />
            </Field>
            <div className="xa-row">
              <Field id="s-usd" label="Cost cap (USD)">
                <input id="s-usd" type="number" min={0.01} max={50} step={0.05} className="xa-input" value={num('maxUsd', 0.5)} onChange={(e) => patch({ maxUsd: Number(e.target.value) })} />
              </Field>
              <Field id="s-steps" label="Max steps">
                <input id="s-steps" type="number" min={1} max={64} step={1} className="xa-input" value={num('maxSteps', 8)} onChange={(e) => patch({ maxSteps: Number(e.target.value) })} />
              </Field>
            </div>
          </>
        )}

        {node.data.kind === 'tool' && (
          <>
            <Field id="t-tool" label="Tool">
              <select id="t-tool" className="xa-select" value={str('tool')} onChange={(e) => patch({ tool: e.target.value })} data-testid="wf-insp-tool">
                <option value="">Choose a tool</option>
                {tools.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                    {t.requiresApproval ? ' · asks first' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <JsonField id="t-args" label="Arguments (JSON object)" value={c.args} onChange={(v) => patch({ args: v })} />
            <Toggle label="Ask before running" help="Routes the call through Shield approval even if the tool itself does not require it." checked={c.requiresApproval === true} onChange={(v) => patch({ requiresApproval: v })} />
            <div className="xa-row">
              <Field id="t-retries" label="Retries">
                <input id="t-retries" type="number" min={0} max={5} step={1} className="xa-input" value={num('maxRetries', 0)} onChange={(e) => patch({ maxRetries: Number(e.target.value) })} />
              </Field>
              <Field id="t-risk" label="Risk tier">
                <select id="t-risk" className="xa-select" value={str('riskTier', 'medium')} onChange={(e) => patch({ riskTier: e.target.value })}>
                  {RISK.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}

        {node.data.kind === 'branch' && (
          <>
            <Field id="b-type" label="Condition">
              <select id="b-type" className="xa-select" value={str('conditionType', 'field_compare')} onChange={(e) => patch({ conditionType: e.target.value })} data-testid="wf-insp-condition">
                <option value="field_compare">Compare an upstream output</option>
                <option value="field_exists">Upstream output exists</option>
                <option value="field_is_empty">Upstream output is empty</option>
                <option value="approval_granted">Approval was granted</option>
                <option value="approval_denied">Approval was denied</option>
                <option value="review_approved">Review was accepted</option>
                <option value="review_changes_requested">Review asked for changes</option>
                <option value="expression">Raw expression</option>
              </select>
            </Field>
            {['field_compare', 'field_exists', 'field_is_empty'].includes(str('conditionType', 'field_compare')) && (
              <Field id="b-field" label="Upstream node" help="The engine looks at that node's output.">
                <select id="b-field" className="xa-select" value={str('field')} onChange={(e) => patch({ field: e.target.value })}>
                  <option value="">Choose a node</option>
                  {upstream.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.data.label} · {n.id}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {str('conditionType', 'field_compare') === 'field_compare' && (
              <div className="xa-row">
                <Field id="b-op" label="Operator">
                  <select id="b-op" className="xa-select" value={str('operator', 'eq')} onChange={(e) => patch({ operator: e.target.value })}>
                    {['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'in'].map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="b-val" label="Value" help="true/false and numbers are typed; the rest is text.">
                  <input id="b-val" className="xa-input" value={str('value')} onChange={(e) => patch({ value: e.target.value })} />
                </Field>
              </div>
            )}
            {['approval_granted', 'approval_denied', 'review_approved', 'review_changes_requested'].includes(str('conditionType')) && (
              <Field id="b-node" label="Human node">
                <select id="b-node" className="xa-select" value={str('nodeId')} onChange={(e) => patch({ nodeId: e.target.value })}>
                  <option value="">Choose a node</option>
                  {humanNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.data.label} · {n.id}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {str('conditionType') === 'expression' && (
              <Field id="b-expr" label="Expression" help="Evaluated by the engine against ctx[nodeId]. No editor help here; prefer the typed conditions above.">
                <input id="b-expr" className="xa-input" style={{ fontFamily: 'var(--font-mono)' }} value={str('expression')} onChange={(e) => patch({ expression: e.target.value })} />
              </Field>
            )}
            <span className="xa-help">Connect the true port and the false port to different nodes.</span>
          </>
        )}

        {node.data.kind === 'join' && (
          <>
            <Field id="j-strat" label="Strategy">
              <select id="j-strat" className="xa-select" value={str('strategy', 'all')} onChange={(e) => patch({ strategy: e.target.value })}>
                <option value="all">all incoming paths</option>
                <option value="any">first incoming path</option>
                <option value="n_of_m">N of M paths</option>
              </select>
            </Field>
            {str('strategy') === 'n_of_m' && (
              <Field id="j-n" label="N">
                <input id="j-n" type="number" min={1} step={1} className="xa-input" value={num('n', 1)} onChange={(e) => patch({ n: Number(e.target.value) })} />
              </Field>
            )}
            <div className="xa-row">
              <Field id="j-timeout" label="Timeout (s, 0 = none)">
                <input id="j-timeout" type="number" min={0} step={1} className="xa-input" value={Math.round(num('timeoutMs', 0) / 1000)} onChange={(e) => patch({ timeoutMs: Number(e.target.value) * 1000 })} />
              </Field>
              <Field id="j-ont" label="On timeout">
                <select id="j-ont" className="xa-select" value={str('onTimeout', 'fail')} onChange={(e) => patch({ onTimeout: e.target.value })}>
                  <option value="fail">fail</option>
                  <option value="proceed_partial">proceed with what arrived</option>
                  <option value="skip">skip</option>
                </select>
              </Field>
            </div>
          </>
        )}

        {(node.data.kind === 'human_approval' || node.data.kind === 'human_review') && (
          <>
            <Field id="h-summary" label="Summary" help="One line you will read when it is time to decide.">
              <input id="h-summary" className="xa-input" value={str('summary')} onChange={(e) => patch({ summary: e.target.value })} data-testid="wf-insp-summary" />
            </Field>
            <Field id="h-detail" label="Detail">
              <textarea id="h-detail" className="xa-textarea" style={{ minHeight: 80 }} value={str('detail')} onChange={(e) => patch({ detail: e.target.value })} />
            </Field>
            {node.data.kind === 'human_approval' ? (
              <>
                <Field id="h-risk" label="Risk level">
                  <select id="h-risk" className="xa-select" value={str('riskLevel', 'medium')} onChange={(e) => patch({ riskLevel: e.target.value })}>
                    {RISK.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="h-denial" label="If denied">
                  <select id="h-denial" className="xa-select" value={str('onDenial', 'stop_workflow')} onChange={(e) => patch({ onDenial: e.target.value })}>
                    <option value="stop_workflow">stop the workflow</option>
                    <option value="skip">skip this node</option>
                  </select>
                </Field>
                <Field id="h-exp" label="If no answer">
                  <select id="h-exp" className="xa-select" value={str('onExpiry', 'deny')} onChange={(e) => patch({ onExpiry: e.target.value })}>
                    <option value="deny">treat as denied</option>
                    <option value="auto_approve">approve (not recommended)</option>
                  </select>
                </Field>
              </>
            ) : (
              <>
                <Field id="h-chg" label="If changes requested">
                  <select id="h-chg" className="xa-select" value={str('onChangeRequested', 'retry_targets')} onChange={(e) => patch({ onChangeRequested: e.target.value })}>
                    <option value="retry_targets">re-run the reviewed nodes</option>
                    <option value="stop_workflow">stop the workflow</option>
                  </select>
                </Field>
                <Field id="h-exp2" label="If no answer">
                  <select id="h-exp2" className="xa-select" value={str('onExpiry', 'block')} onChange={(e) => patch({ onExpiry: e.target.value })}>
                    <option value="block">block until answered</option>
                    <option value="deny">treat as rejected</option>
                  </select>
                </Field>
              </>
            )}
            <Field id="h-ttl" label="Expires after (hours)">
              <input id="h-ttl" type="number" min={0} step={1} className="xa-input" value={Math.round(num('expiresInMs', 86_400_000) / 3_600_000)} onChange={(e) => patch({ expiresInMs: Number(e.target.value) * 3_600_000 })} />
            </Field>
            <span className="xa-help">Enforced by the engine: the run cannot pass this node without a recorded decision.</span>
          </>
        )}

        {node.data.kind === 'wait' && (
          <>
            <Field id="w-mode" label="Wait for">
              <select id="w-mode" className="xa-select" value={str('mode', 'delay')} onChange={(e) => patch({ mode: e.target.value })}>
                <option value="delay">a delay</option>
                <option value="event">an event</option>
              </select>
            </Field>
            {str('mode', 'delay') === 'event' ? (
              <Field id="w-event" label="Event name">
                <input id="w-event" className="xa-input" value={str('eventName')} onChange={(e) => patch({ eventName: e.target.value })} />
              </Field>
            ) : (
              <Field id="w-dur" label="Seconds">
                <input id="w-dur" type="number" min={0} step={1} className="xa-input" value={Math.round(num('durationMs', 5000) / 1000)} onChange={(e) => patch({ durationMs: Number(e.target.value) * 1000 })} />
              </Field>
            )}
          </>
        )}

        {node.data.kind === 'notification' && (
          <>
            <Field id="n-msg" label="Message">
              <textarea id="n-msg" className="xa-textarea" style={{ minHeight: 70 }} value={str('message')} onChange={(e) => patch({ message: e.target.value })} />
            </Field>
            <Field id="n-sev" label="Severity">
              <select id="n-sev" className="xa-select" value={str('severity', 'info')} onChange={(e) => patch({ severity: e.target.value })}>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
              </select>
            </Field>
          </>
        )}

        {node.data.kind === 'artifact' && (
          <>
            <div className="xa-row">
              <Field id="a-type" label="Type">
                <select id="a-type" className="xa-select" value={str('type', 'report')} onChange={(e) => patch({ type: e.target.value })}>
                  {['report', 'code', 'document', 'dataset', 'configuration', 'evidence_package', 'decision_record', 'custom'].map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="a-format" label="Format">
                <input id="a-format" className="xa-input" value={str('format', 'markdown')} onChange={(e) => patch({ format: e.target.value })} />
              </Field>
            </div>
            <Field id="a-desc" label="Description">
              <input id="a-desc" className="xa-input" value={str('description')} onChange={(e) => patch({ description: e.target.value })} />
            </Field>
            <Field id="a-path" label="Storage path (inside the workspace)">
              <input id="a-path" className="xa-input" style={{ fontFamily: 'var(--font-mono)' }} value={str('storagePath')} onChange={(e) => patch({ storagePath: e.target.value })} />
            </Field>
          </>
        )}

        {node.data.kind === 'output' && (
          <>
            <Field id="o-msg" label="Message">
              <textarea id="o-msg" className="xa-textarea" style={{ minHeight: 70 }} value={str('message')} onChange={(e) => patch({ message: e.target.value })} />
            </Field>
            <Field id="o-out" label="Outcome">
              <select id="o-out" className="xa-select" value={str('outcome', 'success')} onChange={(e) => patch({ outcome: e.target.value })}>
                <option value="success">success</option>
                <option value="partial_success">partial success</option>
                <option value="no_op">no-op</option>
              </select>
            </Field>
          </>
        )}

        <div className="xa-row" style={{ marginTop: 8 }}>
          <button type="button" className="xa-btn xa-btn--sm" onClick={() => useWorkflowEditorStore.getState().duplicateSelection()}>
            Duplicate
          </button>
          <button type="button" className="xa-btn xa-btn--sm xa-btn--danger" onClick={() => useWorkflowEditorStore.getState().deleteSelection()} data-testid="wf-insp-delete">
            Delete
          </button>
        </div>
      </div>
    </aside>
  );
}

function Field({ id, label, help, children }: { id: string; label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="xa-field" style={{ flex: 1, minWidth: 0 }}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help ? <span className="xa-help">{help}</span> : null}
    </div>
  );
}

function Toggle({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="xa-toggle-row" style={{ cursor: 'pointer' }}>
      <div>
        <strong>{label}</strong>
        {help ? <span>{help}</span> : null}
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function ToolPicker({ label, selected, tools, onChange }: { label: string; selected: string[]; tools: { name: string; requiresApproval: boolean; description: string }[]; onChange: (next: string[]) => void }) {
  return (
    <div className="xa-field">
      <span className="xa-label">
        {label} · {selected.length}
      </span>
      <div className="xa-toolchips" role="group" aria-label={label}>
        {tools.length === 0 ? <span className="xa-help">Tool list unavailable (engine offline?).</span> : null}
        {tools.map((t) => {
          const on = selected.includes(t.name);
          return (
            <button key={t.name} type="button" className="xa-toolchip" aria-pressed={on} title={t.description} onClick={() => onChange(on ? selected.filter((x) => x !== t.name) : [...selected, t.name])}>
              {t.name}
              {t.requiresApproval ? <span className="xa-toolchip-warn">·ask</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function JsonField({ id, label, value, onChange }: { id: string; label: string; value: unknown; onChange: (v: Record<string, unknown>) => void }) {
  // Text lives in the DOM while typing; the config only changes when it parses.
  const initial = useMemo(() => (value && typeof value === 'object' ? JSON.stringify(value, null, 2) : '{}'), [value]);
  return (
    <div className="xa-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        key={initial}
        className="xa-textarea xa-textarea--mono"
        style={{ minHeight: 90 }}
        defaultValue={initial}
        spellCheck={false}
        onBlur={(e) => {
          try {
            const parsed: unknown = JSON.parse(e.target.value || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              onChange(parsed as Record<string, unknown>);
              e.target.setCustomValidity('');
            } else e.target.setCustomValidity('Must be a JSON object');
          } catch {
            e.target.setCustomValidity('Not valid JSON');
          }
          e.target.reportValidity();
        }}
      />
      <span className="xa-help">Applied when the field loses focus and parses as an object.</span>
    </div>
  );
}
