import type { ActivityCatalog } from '@/api/hooks'
import type { ValidationError, WorkflowDefinition } from '@/api/types'
import { DEFAULT_CASE, ERROR_OUTCOME, hasDynamicOutcomes, isTriggerType, outcomesFor, readCases } from './model'
import type { ValidationState } from './store'

export function localValidate(def: WorkflowDefinition, catalog: ActivityCatalog): ValidationError[] {
  const errors: ValidationError[] = []
  const nodes = new Map(def.nodes.map((n) => [n.id, n]))

  if (!def.nodes.some((n) => isTriggerType(n.type, catalog.byType.get(n.type)))) {
    errors.push({ message: 'The workflow needs at least one trigger node.' })
  }

  for (const n of def.nodes) {
    const d = catalog.byType.get(n.type)
    if (!d) {
      if (!catalog.offline) errors.push({ nodeId: n.id, message: `Unknown activity type "${n.type}".` })
      continue
    }
    for (const input of d.inputs) {
      const dynamic = hasDynamicOutcomes(n.type, d)
      if (!input.required || (dynamic && input.name === 'cases')) continue
      const v = n.config[input.name]
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
        errors.push({ nodeId: n.id, message: `${input.displayName || input.name} is required.` })
      }
    }
    if (hasDynamicOutcomes(n.type, d)) {
      const names = readCases(n.config).map((c) => c.name)
      if (names.some((x) => !x)) errors.push({ nodeId: n.id, message: 'Every case needs a name.' })
      if (new Set(names).size !== names.length) errors.push({ nodeId: n.id, message: 'Case names must be unique.' })
      for (const reserved of [DEFAULT_CASE, ERROR_OUTCOME])
        if (names.includes(reserved)) errors.push({ nodeId: n.id, message: `"${reserved}" is reserved.` })
    }
  }

  for (const e of def.edges) {
    const src = nodes.get(e.source)
    const tgt = nodes.get(e.target)
    if (!src || !tgt) {
      errors.push({ edgeId: e.id, message: `Connection ${e.id} points to a missing node.` })
      continue
    }
    if (isTriggerType(tgt.type, catalog.byType.get(tgt.type))) {
      errors.push({ edgeId: e.id, nodeId: tgt.id, message: 'Triggers cannot have incoming connections.' })
    }
    const outcomes = outcomesFor(src.type, src.config, catalog.byType.get(src.type))
    if (e.sourceHandle !== ERROR_OUTCOME && !outcomes.includes(e.sourceHandle) && catalog.byType.has(src.type)) {
      errors.push({ edgeId: e.id, nodeId: src.id, message: `Outcome "${e.sourceHandle}" does not exist on ${src.id}.` })
    }
  }
  return errors
}

export function toValidationState(list: ValidationError[], source: ValidationState['source']): ValidationState {
  const byNode: Record<string, string[]> = {}
  const byEdge: Record<string, string[]> = {}
  for (const e of list) {
    if (e.nodeId) (byNode[e.nodeId] ??= []).push(e.message)
    if (e.edgeId) (byEdge[e.edgeId] ??= []).push(e.message)
  }
  return { list, byNode, byEdge, source }
}
