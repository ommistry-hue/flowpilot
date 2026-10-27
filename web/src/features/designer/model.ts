import type { Edge, Node } from '@xyflow/react'
import type {
  ActivityDescriptor,
  EdgeDefinition,
  Json,
  JsonObject,
  NodeDefinition,
  RetryPolicy,
  WorkflowDefinition,
} from '@/api/types'
import { knownDescriptor } from '@/api/hooks'
import { formatDuration } from '@/lib/utils'

export type ActivityNodeData = {
  activityType: string
  name?: string | null
  config: JsonObject
  retry?: RetryPolicy | null
  timeoutMs?: number | null
}

export type FlowNode = Node<ActivityNodeData, 'activity'>
export type FlowEdge = Edge<Record<string, never>, 'outcome'>

export interface WorkflowMeta {
  schemaVersion: string
  name: string
  description: string
  variables: JsonObject
}

export const NODE_WIDTH = 248
export const TARGET_HANDLE = 'in'
export const ERROR_OUTCOME = 'error'

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 60_000 }

export interface SwitchCase {
  name: string
  expression: string
}

export interface CasesChange {
  rename?: { from: string; to: string }
  coalesceKey?: string
}

export function readCases(config: JsonObject): SwitchCase[] {
  const raw = config.cases
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is JsonObject => !!c && typeof c === 'object' && !Array.isArray(c))
    .map((c) => ({ name: String(c.name ?? ''), expression: String(c.expression ?? '') }))
}

export function isTriggerType(type: string, descriptor?: ActivityDescriptor) {
  return descriptor?.isTrigger ?? type.startsWith('trigger.')
}

export const DEFAULT_CASE = 'default'

/**
 * Whether an activity's outcomes come from its `config.cases` (one handle per case name, then `default`).
 * Driven by the descriptor so plugin activities work too; `switch` is assumed while the catalog is unknown.
 */
export function hasDynamicOutcomes(type: string, descriptor?: ActivityDescriptor): boolean {
  return descriptor ? !!descriptor.dynamicOutcomes : type === 'switch'
}

export function outcomesFor(type: string, config: JsonObject, descriptor?: ActivityDescriptor): string[] {
  const fixed = (descriptor?.outcomes ?? []).filter((o) => o !== ERROR_OUTCOME)
  if (hasDynamicOutcomes(type, descriptor)) {
    const names = readCases(config)
      .map((c) => c.name)
      .filter((n) => n && n !== ERROR_OUTCOME)
    return [...new Set([...names, ...(fixed.length ? fixed : [DEFAULT_CASE])])]
  }
  return fixed.length ? fixed : ['done']
}

export function canHaveErrorHandle(type: string, descriptor?: ActivityDescriptor) {
  return !isTriggerType(type, descriptor)
}

export function defaultConfig(descriptor?: ActivityDescriptor): JsonObject {
  const cfg: JsonObject = {}
  for (const input of descriptor?.inputs ?? []) {
    if (input.defaultValue !== undefined && input.defaultValue !== null && input.defaultValue !== '') {
      cfg[input.name] = input.defaultValue as Json
    }
  }
  if (descriptor && hasDynamicOutcomes(descriptor.type, descriptor)) {
    if (!Array.isArray(cfg.cases)) cfg.cases = []
    if (descriptor.type === 'switch' && cfg.cases.length === 0) cfg.cases = [{ name: 'case1', expression: 'input.value > 0' }]
  }
  return cfg
}

export function idBase(type: string): string {
  const last = type.split('.').pop() ?? 'node'
  return last.replace(/[^a-zA-Z0-9]/g, '') || 'node'
}

export function uniqueNodeId(type: string, taken: Set<string>): string {
  const base = idBase(type)
  let i = 1
  while (taken.has(`${base}${i}`)) i++
  return `${base}${i}`
}

export function uniqueEdgeId(taken: Set<string>): string {
  let i = taken.size + 1
  while (taken.has(`e${i}`)) i++
  return `e${i}`
}

export function toFlowNode(n: NodeDefinition): FlowNode {
  return {
    id: n.id,
    type: 'activity',
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: {
      activityType: n.type,
      name: n.name ?? null,
      config: n.config ?? {},
      retry: n.retry ?? null,
      timeoutMs: n.timeoutMs ?? null,
    },
  }
}

export function toFlowEdge(e: EdgeDefinition): FlowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || 'done',
    targetHandle: TARGET_HANDLE,
    type: 'outcome',
  }
}

export function definitionToFlow(def: WorkflowDefinition): { nodes: FlowNode[]; edges: FlowEdge[]; meta: WorkflowMeta } {
  return {
    nodes: (def.nodes ?? []).map(toFlowNode),
    edges: (def.edges ?? []).map(toFlowEdge),
    meta: {
      schemaVersion: def.schemaVersion || '1',
      name: def.name || 'Untitled workflow',
      description: def.description ?? '',
      variables: def.variables ?? {},
    },
  }
}

export function flowToDefinition(
  nodes: FlowNode[],
  edges: FlowEdge[],
  meta: WorkflowMeta,
  workflowId: string | null,
): WorkflowDefinition {
  const def: WorkflowDefinition = {
    schemaVersion: meta.schemaVersion || '1',
    name: meta.name.trim() || 'Untitled workflow',
    description: meta.description.trim() ? meta.description : null,
    variables: meta.variables ?? {},
    nodes: nodes.map((n) => {
      const out: NodeDefinition = {
        id: n.id,
        type: n.data.activityType,
        config: n.data.config ?? {},
        retry: n.data.retry ?? null,
        timeoutMs: n.data.timeoutMs ?? null,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      }
      if (n.data.name) out.name = n.data.name
      return out
    }),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle || 'done',
      target: e.target,
    })),
  }
  if (workflowId) def.id = workflowId
  return def
}

export function emptyDefinition(): WorkflowDefinition {
  return {
    schemaVersion: '1',
    name: 'Untitled workflow',
    description: null,
    variables: {},
    nodes: [{ id: 'trigger1', type: 'trigger.manual', name: 'Manual trigger', config: {}, position: { x: 0, y: 0 } }],
    edges: [],
  }
}

export function needsLayout(def: WorkflowDefinition): boolean {
  if (!def.nodes || def.nodes.length < 2) return false
  const seen = new Set(def.nodes.map((n) => `${Math.round(n.position?.x ?? 0)}:${Math.round(n.position?.y ?? 0)}`))
  return seen.size < def.nodes.length
}

/** Handles of a node in the order they are drawn, top to bottom: its outcomes, then the error handle. */
export function nodeHandles(data: ActivityNodeData, descriptor = knownDescriptor(data.activityType)): string[] {
  const outcomes = outcomesFor(data.activityType, data.config, descriptor)
  return canHaveErrorHandle(data.activityType, descriptor) ? [...outcomes, ERROR_OUTCOME] : outcomes
}

export function estimateNodeHeight(data: ActivityNodeData, descriptor = knownDescriptor(data.activityType)): number {
  const outcomes = outcomesFor(data.activityType, data.config, descriptor)
  const multi = outcomes.length > 1 || outcomes[0] !== 'done'
  const summary = configSummary(data.activityType, data.config, descriptor) ? 30 : 0
  return 58 + summary + (multi ? 14 + outcomes.length * 24 : 0)
}

export function configSummary(type: string, config: JsonObject, descriptor?: ActivityDescriptor): string | null {
  const keys = ['url', 'expression', 'path', 'cron', 'event', 'items', 'message', 'title', 'prompt', 'name', 'durationMs', 'until', 'code']
  if (hasDynamicOutcomes(type, descriptor)) {
    const n = readCases(config).length
    return `${n} case${n === 1 ? '' : 's'}`
  }
  for (const k of keys) {
    const v = config[k]
    if (v === undefined || v === null || v === '') continue
    let text = typeof v === 'string' ? v : JSON.stringify(v)
    if (k === 'url' && typeof config.method === 'string') text = `${config.method} ${text}`
    if (k === 'path' && type === 'trigger.webhook') text = `/hooks/${text.replace(/^\//, '')}`
    if (k === 'durationMs') text = typeof v === 'number' ? `wait ${formatDuration(v)}` : text
    return text.replace(/\s+/g, ' ').trim()
  }
  return null
}
