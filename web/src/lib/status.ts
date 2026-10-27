import type { NodeExecution, NodeStatus, RunStatus } from '@/api/types'

type AnyStatus = RunStatus | NodeStatus

export const STATUS_DOT: Record<AnyStatus, string> = {
  Pending: 'bg-zinc-400',
  Running: 'bg-sky-500',
  Suspended: 'bg-amber-500',
  Completed: 'bg-emerald-500',
  Failed: 'bg-red-500',
  Cancelled: 'bg-zinc-400',
}

export const ACTIVE_STATUSES: RunStatus[] = ['Pending', 'Running', 'Suspended']

export const TERMINAL_NODE_STATUSES: NodeStatus[] = ['Completed', 'Failed', 'Cancelled']

export const isTerminalExecution = (e: Pick<NodeExecution, 'status'>) => TERMINAL_NODE_STATUSES.includes(e.status)

/**
 * Applies a fetched snapshot of an active run without losing what live events delivered while it was in flight.
 * A finished run's snapshot is final and replaces everything.
 */
export function mergeExecutions(fresh: NodeExecution[], known: NodeExecution[], runStatus: RunStatus): NodeExecution[] {
  if (!ACTIVE_STATUSES.includes(runStatus)) return fresh
  const byId = new Map(fresh.map((e) => [e.id, e]))
  for (const e of known) {
    const f = byId.get(e.id)
    if (!f || (isTerminalExecution(e) && !isTerminalExecution(f))) byId.set(e.id, e)
  }
  return [...byId.values()]
}
