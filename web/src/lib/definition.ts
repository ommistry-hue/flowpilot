import type { WorkflowDefinition } from '@/api/types'

export function parseDefinition(text: string): WorkflowDefinition {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }
  if (!raw || typeof raw !== 'object') throw new Error('Expected a JSON object')
  const obj = raw as Partial<WorkflowDefinition> & { definition?: WorkflowDefinition }
  const def = obj.definition && Array.isArray(obj.definition.nodes) ? obj.definition : obj
  if (!Array.isArray(def.nodes)) throw new Error('Missing "nodes" array')
  return {
    schemaVersion: def.schemaVersion ?? '1',
    id: def.id,
    name: def.name ?? 'Imported workflow',
    description: def.description ?? null,
    variables: def.variables ?? {},
    nodes: def.nodes.map((n) => ({ ...n, config: n.config ?? {}, position: n.position ?? { x: 0, y: 0 } })),
    edges: Array.isArray(def.edges) ? def.edges : [],
  }
}
