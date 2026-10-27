import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { createContext, useContext } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import type {
  ActivityDescriptor,
  NodeExecution,
  RunDetail,
  RunStatus,
  RunSummary,
  ValidationError,
  WorkflowDefinition,
} from '@/api/types'
import { isTerminalExecution, mergeExecutions } from '@/lib/status'
import { autoLayout } from './layout'
import {
  defaultConfig,
  definitionToFlow,
  flowToDefinition,
  needsLayout,
  readCases,
  TARGET_HANDLE,
  uniqueEdgeId,
  uniqueNodeId,
  type ActivityNodeData,
  type CasesChange,
  type FlowEdge,
  type FlowNode,
  type SwitchCase,
  type WorkflowMeta,
} from './model'

interface Snapshot {
  nodes: FlowNode[]
  edges: FlowEdge[]
  meta: WorkflowMeta
}

export interface ValidationState {
  list: ValidationError[]
  byNode: Record<string, string[]>
  byEdge: Record<string, string[]>
  source: 'server' | 'local'
}

export interface RunOverlay {
  runId: string
  status: RunStatus
  error?: string | null
  startedAt?: string | null
  completedAt?: string | null
  executions: NodeExecution[]
  byNode: Record<string, NodeExecution[]>
}

export interface GhostPreview {
  definition: WorkflowDefinition
  explanation?: string | null
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface DesignerState {
  readOnly: boolean
  workflowId: string | null
  publishedVersion: number | null
  meta: WorkflowMeta
  nodes: FlowNode[]
  edges: FlowEdge[]
  dirty: boolean
  past: Snapshot[]
  future: Snapshot[]
  validation: ValidationState | null
  run: RunOverlay | null
  inspectNodeId: string | null
  ghost: GhostPreview | null

  onNodesChange: (changes: NodeChange<FlowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void
  onConnect: (c: Connection) => void
  snapshot: (coalesceKey?: string) => void
  undo: () => void
  redo: () => void
  addNode: (descriptor: ActivityDescriptor, position: XYPosition) => string
  updateNodeData: (id: string, patch: Partial<ActivityNodeData>, coalesceKey?: string) => void
  renameNode: (id: string, newId: string) => boolean
  setCases: (nodeId: string, cases: SwitchCase[], opts?: CasesChange) => void
  deleteElements: (nodeIds: string[], edgeIds: string[]) => void
  copySelection: () => number
  paste: (offset?: XYPosition) => number
  duplicateSelection: () => number
  selectOnly: (nodeId: string | null) => void
  setMeta: (patch: Partial<WorkflowMeta>, coalesceKey?: string) => void
  layout: () => void
  replaceDefinition: (def: WorkflowDefinition, opts?: { keepName?: boolean }) => void
  toDefinition: () => WorkflowDefinition
  markSaved: (workflowId: string, publishedVersion?: number | null) => void
  setPublishedVersion: (v: number | null) => void
  setValidation: (v: ValidationState | null) => void
  startRun: (runId: string) => void
  setRunDetail: (detail: RunDetail) => void
  applyExecution: (exec: NodeExecution) => void
  applyRunSummary: (run: RunSummary) => void
  clearRun: () => void
  setInspectNode: (id: string | null) => void
  setGhost: (def: WorkflowDefinition, explanation?: string | null) => void
  acceptGhost: () => void
  discardGhost: () => void
}

const HISTORY_LIMIT = 100
let clipboard: { nodes: FlowNode[]; edges: FlowEdge[] } | null = null

function indexExecutions(executions: NodeExecution[]): Record<string, NodeExecution[]> {
  const byNode: Record<string, NodeExecution[]> = {}
  for (const e of executions) (byNode[e.nodeId] ??= []).push(e)
  for (const list of Object.values(byNode)) {
    list.sort((a, b) => a.attempt - b.attempt || a.startedAt.localeCompare(b.startedAt))
  }
  return byNode
}

function prepare(def: WorkflowDefinition) {
  const flow = definitionToFlow(def)
  if (needsLayout(def)) flow.nodes = autoLayout(flow.nodes, flow.edges)
  return flow
}

export function createDesignerStore(init: {
  definition: WorkflowDefinition
  workflowId: string | null
  publishedVersion?: number | null
  readOnly?: boolean
}) {
  const flow = prepare(init.definition)
  let lastCoalesce: { key: string; at: number } | null = null

  return createStore<DesignerState>()((set, get) => {
    const take = (): Snapshot => {
      const { nodes, edges, meta } = get()
      return { nodes, edges, meta }
    }

    const commit = (patch: Partial<DesignerState>) => set({ ...patch, dirty: true })

    return {
      readOnly: init.readOnly ?? false,
      workflowId: init.workflowId,
      publishedVersion: init.publishedVersion ?? null,
      meta: flow.meta,
      nodes: flow.nodes,
      edges: flow.edges,
      dirty: false,
      past: [],
      future: [],
      validation: null,
      run: null,
      inspectNodeId: null,
      ghost: null,

      snapshot: (coalesceKey) => {
        const now = Date.now()
        if (coalesceKey && lastCoalesce?.key === coalesceKey && now - lastCoalesce.at < 1200) {
          lastCoalesce.at = now
          return
        }
        lastCoalesce = coalesceKey ? { key: coalesceKey, at: now } : null
        set((s) => ({ past: [...s.past.slice(-HISTORY_LIMIT + 1), take()], future: [] }))
      },

      undo: () => {
        const { past, future, readOnly } = get()
        if (readOnly || past.length === 0) return
        const prev = past[past.length - 1]
        lastCoalesce = null
        set({ ...prev, past: past.slice(0, -1), future: [take(), ...future], dirty: true })
      },

      redo: () => {
        const { past, future, readOnly } = get()
        if (readOnly || future.length === 0) return
        const next = future[0]
        lastCoalesce = null
        set({ ...next, past: [...past, take()], future: future.slice(1), dirty: true })
      },

      onNodesChange: (changes) => {
        const { readOnly, ghost } = get()
        if (ghost) return
        const allowed = readOnly ? changes.filter((c) => c.type === 'select' || c.type === 'dimensions') : changes
        if (allowed.length === 0) return
        const mutating = allowed.some((c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace')
        const moved = allowed.some((c) => c.type === 'position' && c.position)
        if (mutating) get().snapshot()
        const nodes = applyNodeChanges(allowed, get().nodes)
        if (mutating) {
          const ids = new Set(nodes.map((n) => n.id))
          const edges = get().edges.filter((e) => ids.has(e.source) && ids.has(e.target))
          commit({ nodes, edges })
        } else if (moved) commit({ nodes })
        else set({ nodes })
      },

      onEdgesChange: (changes) => {
        const { readOnly, ghost } = get()
        if (ghost) return
        const allowed = readOnly ? changes.filter((c) => c.type === 'select') : changes
        if (allowed.length === 0) return
        const mutating = allowed.some((c) => c.type !== 'select')
        if (mutating) get().snapshot()
        const edges = applyEdgeChanges(allowed, get().edges)
        if (mutating) commit({ edges })
        else set({ edges })
      },

      onConnect: (c) => {
        const { readOnly, edges } = get()
        if (readOnly || !c.source || !c.target || c.source === c.target) return
        const handle = c.sourceHandle || 'done'
        if (edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle || 'done') === handle)) return
        get().snapshot()
        const id = uniqueEdgeId(new Set(edges.map((e) => e.id)))
        commit({
          edges: addEdge(
            { id, source: c.source, target: c.target, sourceHandle: handle, targetHandle: TARGET_HANDLE, type: 'outcome' },
            edges,
          ),
        })
      },

      addNode: (descriptor, position) => {
        const { nodes } = get()
        get().snapshot()
        const id = uniqueNodeId(descriptor.type, new Set(nodes.map((n) => n.id)))
        const node: FlowNode = {
          id,
          type: 'activity',
          position,
          selected: true,
          data: {
            activityType: descriptor.type,
            name: null,
            config: defaultConfig(descriptor),
            retry: null,
            timeoutMs: null,
          },
        }
        commit({ nodes: [...nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node] })
        return id
      },

      updateNodeData: (id, patch, coalesceKey) => {
        if (get().readOnly) return
        get().snapshot(coalesceKey ? `${id}:${coalesceKey}` : undefined)
        commit({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) })
      },

      renameNode: (id, newId) => {
        const { nodes, edges } = get()
        if (!newId || newId === id || nodes.some((n) => n.id === newId)) return false
        get().snapshot()
        commit({
          nodes: nodes.map((n) => (n.id === id ? { ...n, id: newId } : n)),
          edges: edges.map((e) => ({
            ...e,
            source: e.source === id ? newId : e.source,
            target: e.target === id ? newId : e.target,
          })),
          inspectNodeId: get().inspectNodeId === id ? newId : get().inspectNodeId,
        })
        return true
      },

      setCases: (nodeId, cases, opts = {}) => {
        const node = get().nodes.find((n) => n.id === nodeId)
        if (get().readOnly || !node) return
        get().snapshot(opts.coalesceKey ? `${nodeId}:${opts.coalesceKey}` : undefined)
        const { rename } = opts
        const previous = new Set(readCases(node.data.config).map((c) => c.name))
        const current = new Set(cases.map((c) => c.name))
        const edges = get().edges.flatMap((e) => {
          if (e.source !== nodeId) return [e]
          const handle = e.sourceHandle || 'done'
          const next = rename && handle === rename.from ? rename.to : handle
          if (previous.has(handle) && !current.has(next)) return []
          return [next === handle ? e : { ...e, sourceHandle: next }]
        })
        commit({
          nodes: get().nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, config: { ...n.data.config, cases: cases.map((c) => ({ name: c.name, expression: c.expression })) } } } : n)),
          edges,
        })
      },

      deleteElements: (nodeIds, edgeIds) => {
        if (get().readOnly || (nodeIds.length === 0 && edgeIds.length === 0)) return
        get().snapshot()
        const n = new Set(nodeIds)
        const e = new Set(edgeIds)
        commit({
          nodes: get().nodes.filter((x) => !n.has(x.id)),
          edges: get().edges.filter((x) => !e.has(x.id) && !n.has(x.source) && !n.has(x.target)),
        })
      },

      copySelection: () => {
        const nodes = get().nodes.filter((n) => n.selected)
        if (nodes.length === 0) return 0
        const ids = new Set(nodes.map((n) => n.id))
        clipboard = {
          nodes: structuredClone(nodes),
          edges: structuredClone(get().edges.filter((e) => ids.has(e.source) && ids.has(e.target))),
        }
        return nodes.length
      },

      paste: (offset = { x: 40, y: 40 }) => {
        if (!clipboard || get().readOnly) return 0
        const { nodes, edges } = get()
        get().snapshot()
        const taken = new Set(nodes.map((n) => n.id))
        const edgeTaken = new Set(edges.map((e) => e.id))
        const map = new Map<string, string>()
        const newNodes = clipboard.nodes.map((n) => {
          const id = uniqueNodeId(n.data.activityType, taken)
          taken.add(id)
          map.set(n.id, id)
          return {
            ...structuredClone(n),
            id,
            selected: true,
            position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
          }
        })
        const newEdges = clipboard.edges.map((e) => {
          const id = uniqueEdgeId(edgeTaken)
          edgeTaken.add(id)
          return { ...e, id, source: map.get(e.source)!, target: map.get(e.target)!, selected: false }
        })
        clipboard = { nodes: newNodes.map((n) => ({ ...n, selected: false })), edges: newEdges }
        commit({
          nodes: [...nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...newNodes],
          edges: [...edges, ...newEdges],
        })
        return newNodes.length
      },

      duplicateSelection: () => {
        const saved = clipboard
        const count = get().copySelection()
        if (count) get().paste()
        clipboard = saved
        return count
      },

      selectOnly: (nodeId) => {
        set({
          nodes: get().nodes.map((n) => ({ ...n, selected: n.id === nodeId })),
          edges: get().edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
        })
      },

      setMeta: (patch, coalesceKey) => {
        get().snapshot(coalesceKey ? `meta:${coalesceKey}` : undefined)
        commit({ meta: { ...get().meta, ...patch } })
      },

      layout: () => {
        const { nodes, edges, readOnly } = get()
        if (readOnly || nodes.length === 0) return
        get().snapshot()
        commit({ nodes: autoLayout(nodes, edges) })
      },

      replaceDefinition: (def, opts) => {
        get().snapshot()
        const next = prepare(def)
        commit({
          nodes: next.nodes,
          edges: next.edges,
          meta: opts?.keepName ? { ...next.meta, name: get().meta.name } : next.meta,
          validation: null,
        })
      },

      toDefinition: () => {
        const { nodes, edges, meta, workflowId } = get()
        return flowToDefinition(nodes, edges, meta, workflowId)
      },

      markSaved: (workflowId, publishedVersion) =>
        set((s) => ({
          workflowId,
          dirty: false,
          publishedVersion: publishedVersion === undefined ? s.publishedVersion : publishedVersion,
        })),

      setPublishedVersion: (v) => set({ publishedVersion: v }),
      setValidation: (v) => set({ validation: v }),

      startRun: (runId) =>
        set({ run: { runId, status: 'Pending', executions: [], byNode: {} }, inspectNodeId: null }),

      setRunDetail: (d) => {
        const run = get().run
        if (!run || run.runId !== d.id) return
        const executions = mergeExecutions(d.nodes, run.executions, d.status)
        set({
          run: {
            ...run,
            status: d.status,
            error: d.error,
            startedAt: d.startedAt,
            completedAt: d.completedAt,
            executions,
            byNode: indexExecutions(executions),
          },
        })
      },

      applyExecution: (exec) => {
        const run = get().run
        if (!run) return
        const idx = run.executions.findIndex((e) => e.id === exec.id)
        // A late "Running" event must not resurrect an execution already known as finished or cancelled.
        if (idx !== -1 && isTerminalExecution(run.executions[idx]) && !isTerminalExecution(exec)) return
        const executions = idx === -1 ? [...run.executions, exec] : run.executions.map((e, i) => (i === idx ? exec : e))
        set({ run: { ...run, executions, byNode: indexExecutions(executions) } })
      },

      applyRunSummary: (r) => {
        const run = get().run
        if (!run || run.runId !== r.id) return
        set({ run: { ...run, status: r.status, error: r.error, startedAt: r.startedAt, completedAt: r.completedAt } })
      },

      clearRun: () => set({ run: null, inspectNodeId: null }),
      setInspectNode: (id) => set({ inspectNodeId: id }),

      setGhost: (definition, explanation) => {
        const flow = prepare(definition)
        set({ ghost: { definition, explanation, nodes: flow.nodes, edges: flow.edges } })
      },

      acceptGhost: () => {
        const ghost = get().ghost
        if (!ghost) return
        get().snapshot()
        const name = ghost.definition.name?.trim()
        commit({
          nodes: ghost.nodes.map((n) => ({ ...n, selected: false })),
          edges: ghost.edges,
          meta: {
            ...get().meta,
            name: name && name !== 'Untitled workflow' ? name : get().meta.name,
            description: ghost.definition.description ?? get().meta.description,
            variables: ghost.definition.variables ?? get().meta.variables,
          },
          ghost: null,
          validation: null,
        })
      },

      discardGhost: () => set({ ghost: null }),
    }
  })
}

export type DesignerStore = StoreApi<DesignerState>

export const DesignerContext = createContext<DesignerStore | null>(null)

export function useDesigner<T>(selector: (s: DesignerState) => T): T {
  const store = useContext(DesignerContext)
  if (!store) throw new Error('DesignerContext missing')
  return useStore(store, selector)
}

export function useDesignerApi(): DesignerStore {
  const store = useContext(DesignerContext)
  if (!store) throw new Error('DesignerContext missing')
  return store
}

