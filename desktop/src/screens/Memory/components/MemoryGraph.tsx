/*
 * Graph tab. Read-mostly: the engine's heuristic graph (GET /memory/graph) is
 * laid out deterministically (memory/core.ts layoutGraph) and drawn with
 * @xyflow/react, the same dependency the Agents workflow canvas uses. Clicking a
 * memory node opens its real entry in the detail panel; entity nodes list the
 * memories they came from. The text outline is the accessible fallback.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Maximize, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMemoryStore } from '@/stores/memoryStore';
import {
  ENTITY_COLOR,
  ENTITY_LABEL,
  GRAPH_NODE_LIMIT,
  graphOutline,
  layoutGraph,
  neighborhood,
  nodeRadius,
  summarize,
  type GraphNode,
  type GraphNodeKind,
  type MemoryGraphData,
  PLURAL,
} from '@/memory/core';
import { EntryDetail } from './EntryDetail';

const KINDS: GraphNodeKind[] = ['person', 'project', 'org', 'tool', 'model', 'file', 'fact'];

type MxNodeData = { label: string; kind: GraphNodeKind; r: number; dim: boolean; selected: boolean; importance: number };

function MxNode({ data, selected }: NodeProps<Node<MxNodeData>>) {
  const d = data;
  return (
    <div
      className="mx-node"
      role="button"
      tabIndex={0}
      aria-label={`${ENTITY_LABEL[d.kind]}: ${d.label}`}
      data-selected={selected || d.selected ? 'true' : 'false'}
      data-dim={d.dim ? 'true' : 'false'}
      style={{ width: d.r * 2, height: d.r * 2, background: ENTITY_COLOR[d.kind], opacity: d.dim ? 0.25 : 1 }}
    >
      <span className="mx-node-label" aria-hidden>
        {d.label}
      </span>
    </div>
  );
}

const nodeTypes = { mx: MxNode };

export function MemoryGraph() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}

function GraphInner() {
  const graph = useMemoryStore((s) => s.graph);
  const loading = useMemoryStore((s) => s.graphLoading);
  const error = useMemoryStore((s) => s.graphError);
  const loadGraph = useMemoryStore((s) => s.loadGraph);
  const selectMemory = useMemoryStore((s) => s.select);
  const entries = useMemoryStore((s) => s.entries);

  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<Set<GraphNodeKind>>(() => new Set(KINDS));
  const [asText, setAsText] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Record<string, { x: number; y: number }>>({});
  const [layoutKey, setLayoutKey] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!graph && !loading) void loadGraph();
  }, [graph, loading, loadGraph]);

  const positions = useMemo(() => (graph ? layoutGraph(graph) : new Map<string, { x: number; y: number }>()), [graph, layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleIds = useMemo(() => {
    if (!graph) return new Set<string>();
    const q = query.trim().toLowerCase();
    return new Set(
      graph.nodes
        .filter((n) => n.kind === 'you' || (kinds.has(n.kind) && (!q || n.label.toLowerCase().includes(q))))
        .map((n) => n.id),
    );
  }, [graph, kinds, query]);

  const hl = useMemo(() => neighborhood(graph ?? { edges: [] }, hovered ?? selectedNode), [graph, hovered, selectedNode]);

  const flowNodes: Node<MxNodeData>[] = useMemo(() => {
    if (!graph) return [];
    return graph.nodes
      .filter((n) => visibleIds.has(n.id))
      .map((n) => {
        const r = nodeRadius(n);
        const p = pinned[n.id] ?? positions.get(n.id) ?? { x: 0, y: 0 };
        return {
          id: n.id,
          type: 'mx',
          position: { x: p.x - r, y: p.y - r },
          data: {
            label: n.kind === 'you' ? 'You' : n.label.length > 16 ? `${n.label.slice(0, 15)}…` : n.label,
            kind: n.kind,
            r,
            dim: (hovered || selectedNode) != null && !hl.nodes.has(n.id),
            selected: selectedNode === n.id,
            importance: n.importance,
          },
          draggable: true,
          focusable: true,
          ariaLabel: `${ENTITY_LABEL[n.kind]}: ${n.label}`,
        } as Node<MxNodeData>;
      });
  }, [graph, visibleIds, positions, pinned, hovered, selectedNode, hl]);

  const flowEdges: Edge[] = useMemo(() => {
    if (!graph) return [];
    return graph.edges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e) => {
        const lit = hl.edges.has(e.id);
        const active = hovered != null || selectedNode != null;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: lit ? e.relation : undefined,
          style: {
            stroke: lit ? 'var(--accent)' : 'var(--border-default)',
            strokeWidth: lit ? 1.6 : 1,
            opacity: active && !lit ? 0.12 : 0.7,
            transition: 'opacity 240ms ease',
          },
          labelStyle: { fontSize: 10, fill: 'var(--text-secondary)' },
          labelBgStyle: { fill: 'var(--bg-raised)' },
          selectable: false,
        } as Edge;
      });
  }, [graph, visibleIds, hl, hovered, selectedNode]);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      setSelectedNode(node.id);
      if (node.id.startsWith('fact:')) selectMemory(node.id.slice('fact:'.length));
      else selectMemory(null);
    },
    [selectMemory],
  );

  const selectedGraphNode: GraphNode | null = graph?.nodes.find((n) => n.id === selectedNode) ?? null;
  const selectedEntry = selectedGraphNode?.kind === 'fact' ? entries.find((e) => e.id === selectedGraphNode.id.slice(5)) ?? null : null;

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  if (loading && !graph) {
    return <div className="mx-empty" role="status">Loading the graph…</div>;
  }
  if (error && !graph) {
    return (
      <div className="mx-empty" role="alert">
        <p style={{ margin: 0 }}>{error}</p>
        <Button size="sm" variant="outline" onClick={() => void loadGraph()}>
          <RefreshCw /> Try again
        </Button>
      </div>
    );
  }
  if (!graph) return null;

  const memoryCount = graph.nodes.filter((n) => n.kind === 'fact').length;
  if (memoryCount === 0) {
    return (
      <div className="mx-empty" data-testid="graph-empty">
        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r="10" fill="var(--accent)" />
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <g key={i}>
                <line x1="60" y1="60" x2={60 + Math.cos(a) * 46} y2={60 + Math.sin(a) * 46} stroke="var(--border-default)" strokeDasharray="3 4" />
                <circle cx={60 + Math.cos(a) * 46} cy={60 + Math.sin(a) * 46} r="4" fill="var(--border-default)" />
              </g>
            );
          })}
        </svg>
        <p style={{ margin: 0 }}>Memories you save appear here as a map. People, projects, files and tools are picked out of their text.</p>
      </div>
    );
  }

  return (
    <div className="mx-graph-wrap" ref={wrapRef} style={{ background: 'var(--bg-void, transparent)' }}>
      <aside className="mx-graph-rail" aria-label="Graph controls">
        <label className="mx-field" htmlFor="mx-graph-find">
          Find a node
        </label>
        <div style={{ position: 'relative' }}>
          <Search size={14} aria-hidden style={{ position: 'absolute', left: 8, top: 9, color: 'var(--text-tertiary)' }} />
          <input
            id="mx-graph-find"
            type="search"
            className="mx-input"
            style={{ paddingLeft: 28 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or topic"
          />
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <legend className="mx-field" style={{ padding: 0, marginBottom: 4 }}>
            Show
          </legend>
          {KINDS.filter((k) => graph.nodes.some((n) => n.kind === k)).map((k) => (
            <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={kinds.has(k)}
                onChange={() =>
                  setKinds((prev) => {
                    const next = new Set(prev);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return next;
                  })
                }
              />
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: ENTITY_COLOR[k], display: 'inline-block' }} />
              {PLURAL[k]}
            </label>
          ))}
        </fieldset>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Button
            size="sm"
            variant="outline"
            title="Clear pinned nodes and re-run the layout"
            onClick={() => {
              setPinned({});
              setLayoutKey((k) => k + 1);
            }}
          >
            <RefreshCw /> Reset layout
          </Button>
          <Button size="sm" variant="outline" onClick={toggleFullscreen}>
            <Maximize /> Fullscreen
          </Button>
          <Button size="sm" variant="outline" aria-pressed={asText} onClick={() => setAsText((v) => !v)}>
            {asText ? 'Show map' : 'Show as text'}
          </Button>
        </div>
        {graph.truncated && (
          <p className="mx-hint">Showing the {GRAPH_NODE_LIMIT} most important items. Use Find to look for the rest.</p>
        )}
        <p className="mx-hint">Heuristic: entities come from tags and wording in your memories, not from a model.</p>
      </aside>

      <div className="mx-graph-canvas" style={{ display: 'flex', minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {asText ? (
            <GraphOutline graph={graph} onOpen={(id) => { setSelectedNode(`fact:${id}`); selectMemory(id); }} />
          ) : (
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
              minZoom={0.3}
              maxZoom={2}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={(_, n) => setHovered(n.id)}
              onNodeMouseLeave={() => setHovered(null)}
              onNodeDragStop={(_, n) => setPinned((p) => ({ ...p, [n.id]: { x: n.position.x + (n.width ?? 0) / 2, y: n.position.y + (n.height ?? 0) / 2 } }))}
              onPaneClick={() => {
                setSelectedNode(null);
                selectMemory(null);
              }}
              proOptions={{ hideAttribution: false }}
              aria-label="Memory graph"
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(n) => ENTITY_COLOR[(n.data as MxNodeData).kind]} />
              <GraphKeys />
            </ReactFlow>
          )}
        </div>

        {selectedGraphNode && selectedGraphNode.kind !== 'you' && (
          <aside className="mx-right" style={{ width: 340, borderLeft: '1px solid var(--border-subtle)', flexShrink: 0 }} aria-label="Selected node">
            {selectedEntry ? (
              <EntryDetail key={selectedEntry.id} entry={selectedEntry} all={entries} />
            ) : selectedGraphNode.kind !== 'fact' ? (
              <EntityPanel
                node={selectedGraphNode}
                entries={entries}
                onOpen={(id) => {
                  setSelectedNode(`fact:${id}`);
                  selectMemory(id);
                }}
              />
            ) : null}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Keyboard: F fits the view, +/- zoom (React Flow handles arrows on a focused node). */
function GraphKeys() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'f' || e.key === 'F') void fitView({ padding: 0.2, duration: 200 });
      if (e.key === '+' || e.key === '=') void zoomIn({ duration: 150 });
      if (e.key === '-') void zoomOut({ duration: 150 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitView, zoomIn, zoomOut]);
  return null;
}

function EntityPanel({ node, entries, onOpen }: { node: GraphNode; entries: Array<{ id: string; content: string }>; onOpen: (id: string) => void }) {
  const sources = entries.filter((e) => node.memoryIds.includes(e.id));
  return (
    <article className="mx-enter" aria-labelledby="mx-entity-title" style={{ padding: 18 }}>
      <h2 id="mx-entity-title" style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {ENTITY_LABEL[node.kind]}
      </h2>
      <p style={{ fontSize: 18, fontWeight: 600, margin: '6px 0 4px' }}>{node.label}</p>
      <p className="mx-hint">
        Mentioned in {sources.length} memor{sources.length === 1 ? 'y' : 'ies'}. Connected to {Math.max(0, node.linkCount - 1)} other item{node.linkCount === 2 ? '' : 's'}.
      </p>
      <h3 className="mx-section-title" style={{ marginTop: 14 }}>
        From these memories
      </h3>
      <ul style={{ paddingLeft: 16, margin: 0, fontSize: 13 }}>
        {sources.map((s) => (
          <li key={s.id} style={{ margin: '6px 0' }}>
            <button type="button" className="mx-chip" onClick={() => onOpen(s.id)}>
              {summarize(s.content, 60)}
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}

function GraphOutline({ graph, onOpen }: { graph: MemoryGraphData; onOpen: (id: string) => void }) {
  const groups = graphOutline(graph);
  const memories = graph.nodes.filter((n) => n.kind === 'fact');
  return (
    <div className="mx-outline" role="region" aria-label="Graph as text">
      <h3>You</h3>
      <p style={{ margin: 0 }}>{memories.length} memor{memories.length === 1 ? 'y' : 'ies'} saved on this device.</p>
      {groups.map((g) => (
        <section key={g.heading}>
          <h3>{g.heading}</h3>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {g.items.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
        </section>
      ))}
      <h3>Memories</h3>
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        {memories.map((m) => (
          <li key={m.id}>
            <button type="button" className="mx-chip" onClick={() => onOpen(m.memoryIds[0] ?? m.id.slice(5))}>
              {m.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
