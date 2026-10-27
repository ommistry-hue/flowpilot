import dagre from '@dagrejs/dagre'
import { NODE_WIDTH, estimateNodeHeight, nodeHandles, type FlowEdge, type FlowNode } from './model'

type LayoutNode = Pick<FlowNode, 'id' | 'position' | 'measured' | 'data'>
type LayoutEdge = Pick<FlowEdge, 'source' | 'target'> & { sourceHandle?: string | null }
type Constraint = { left: string; right: string }

const size = (n: LayoutNode) => ({
  width: n.measured?.width ?? NODE_WIDTH,
  height: n.measured?.height ?? estimateNodeHeight(n.data),
})

/**
 * Pairs of targets `[upper, lower]` that should stack in the order of the handles that feed them,
 * e.g. `approved` above `rejected`, `true` above `false`, and the error branch last.
 */
function siblingPairs(nodes: LayoutNode[], edges: LayoutEdge[]): [string, string][] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const handleIndex = new Map<string, string[]>()
  const out = new Map<string, { target: string; rank: number; i: number }[]>()
  edges.forEach((e, i) => {
    const src = byId.get(e.source)
    if (!src || !byId.has(e.target) || e.source === e.target) return
    let handles = handleIndex.get(src.id)
    if (!handles) handleIndex.set(src.id, (handles = nodeHandles(src.data)))
    const idx = handles.indexOf(e.sourceHandle || 'done')
    const list = out.get(src.id) ?? []
    list.push({ target: e.target, rank: idx === -1 ? handles.length : idx, i })
    out.set(src.id, list)
  })
  const pairs: [string, string][] = []
  for (const list of out.values()) {
    const targets = [...new Set(list.sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => x.target))]
    for (let k = 1; k < targets.length; k++) pairs.push([targets[k - 1], targets[k]])
  }
  return pairs
}

/** Edges sorted so each node's outgoing edges are added in handle order, which seeds dagre's initial ordering. */
function orderedEdges(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const rank = (e: LayoutEdge) => {
    const src = byId.get(e.source)
    if (!src) return 0
    const handles = nodeHandles(src.data)
    const idx = handles.indexOf(e.sourceHandle || 'done')
    return idx === -1 ? handles.length : idx
  }
  return edges.map((e, i) => ({ e, i, r: rank(e) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.e)
}

function run(nodes: LayoutNode[], edges: LayoutEdge[], constraints: Constraint[]) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 96, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, size(n))
  const ids = new Set(nodes.map((n) => n.id))
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target)
  dagre.layout(g, constraints.length ? { constraints } : undefined)
  return g
}

/** True when adding `left -> right` keeps the constraint graph acyclic (dagre cannot satisfy a cycle). */
function acyclicWith(constraints: Constraint[], left: string, right: string) {
  const next = new Map<string, string[]>()
  for (const c of constraints) next.set(c.left, [...(next.get(c.left) ?? []), c.right])
  const stack = [right]
  const seen = new Set<string>()
  while (stack.length) {
    const v = stack.pop()!
    if (v === left) return false
    if (seen.has(v)) continue
    seen.add(v)
    stack.push(...(next.get(v) ?? []))
  }
  return true
}

export function autoLayout<N extends LayoutNode>(nodes: N[], edges: LayoutEdge[]): N[] {
  if (nodes.length === 0) return nodes
  const sorted = orderedEdges(nodes, edges)
  let g = run(nodes, sorted, [])

  // Ranks do not depend on the in-rank order, so siblings sharing a column after the first pass
  // still share it when the pass is repeated with ordering constraints.
  const pairs = siblingPairs(nodes, sorted).filter(([a, b]) => Math.abs(g.node(a).x - g.node(b).x) < 1)
  if (pairs.some(([a, b]) => g.node(a).y > g.node(b).y)) {
    const constraints: Constraint[] = []
    for (const [left, right] of pairs) {
      if (constraints.some((c) => c.left === left && c.right === right)) continue
      if (acyclicWith(constraints, left, right)) constraints.push({ left, right })
    }
    g = run(nodes, sorted, constraints)
  }

  return nodes.map((n) => {
    const p = g.node(n.id)
    const { width, height } = size(n)
    return { ...n, position: { x: Math.round(p.x - width / 2), y: Math.round(p.y - height / 2) } }
  })
}
