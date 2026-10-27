import { keepPreviousData, replaceEqualDeep, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { mergeExecutions } from '@/lib/status'
import { api, type RunsQuery } from './client'
import { FALLBACK_ACTIVITIES } from './fallbackActivities'
import type { ActivityDescriptor, RunDetail } from './types'

export const qk = {
  activities: ['activities'] as const,
  workflows: ['workflows'] as const,
  workflow: (id: string) => ['workflows', id] as const,
  versions: (id: string) => ['workflows', id, 'versions'] as const,
  runs: (q: RunsQuery) => ['runs', 'list', q] as const,
  runsAll: ['runs'] as const,
  run: (id: string) => ['runs', 'detail', id] as const,
  approvals: (status: 'pending' | 'resolved') => ['approvals', status] as const,
  approvalsAll: ['approvals'] as const,
  stats: ['stats'] as const,
  aiStatus: ['ai-status'] as const,
}

export interface ActivityCatalog {
  list: ActivityDescriptor[]
  byType: Map<string, ActivityDescriptor>
  offline: boolean
}

function catalog(list: ActivityDescriptor[], offline: boolean): ActivityCatalog {
  return { list, byType: new Map(list.map((a) => [a.type, a])), offline }
}

const fallbackCatalog = catalog(FALLBACK_ACTIVITIES, true)
let latestCatalog = fallbackCatalog

/**
 * Best-known descriptor for code that runs outside React (layout, height estimates):
 * the last catalog fetched from the server, else the built-in fallback.
 */
export function knownDescriptor(type: string): ActivityDescriptor | undefined {
  return latestCatalog.byType.get(type) ?? fallbackCatalog.byType.get(type)
}

export function useActivities() {
  return useQuery({
    queryKey: qk.activities,
    queryFn: async () => {
      try {
        latestCatalog = catalog(await api.activities(), false)
        return latestCatalog
      } catch {
        return fallbackCatalog
      }
    },
    staleTime: 5 * 60_000,
    placeholderData: fallbackCatalog,
  })
}

export function useCatalog(): ActivityCatalog {
  return useActivities().data ?? fallbackCatalog
}

export const useWorkflows = () => useQuery({ queryKey: qk.workflows, queryFn: api.workflows })

export const useWorkflow = (id: string | undefined) =>
  useQuery({ queryKey: qk.workflow(id ?? ''), queryFn: () => api.workflow(id!), enabled: !!id })

export const useRuns = (q: RunsQuery) =>
  useQuery({ queryKey: qk.runs(q), queryFn: () => api.runs(q), placeholderData: keepPreviousData })

export const useRun = (id: string | undefined) =>
  useQuery({
    queryKey: qk.run(id ?? ''),
    queryFn: () => api.run(id!),
    enabled: !!id,
    structuralSharing: (old: unknown, next: unknown) => {
      const prev = old as RunDetail | undefined
      const fresh = next as RunDetail
      if (!prev || prev.id !== fresh.id) return fresh
      return replaceEqualDeep(prev, { ...fresh, nodes: mergeExecutions(fresh.nodes, prev.nodes, fresh.status) })
    },
  })

/** Refetches a run, discarding a fetch that started before the caller subscribed to its live events. */
export function useReloadRun() {
  const qc = useQueryClient()
  return useCallback(
    async (id: string) => {
      await qc.cancelQueries({ queryKey: qk.run(id) })
      await qc.refetchQueries({ queryKey: qk.run(id) })
    },
    [qc],
  )
}

export const useApprovals = (status: 'pending' | 'resolved') =>
  useQuery({ queryKey: qk.approvals(status), queryFn: () => api.approvals(status) })

export const useStats = () => useQuery({ queryKey: qk.stats, queryFn: api.stats, refetchInterval: 30_000 })

export const useAiStatus = () =>
  useQuery({ queryKey: qk.aiStatus, queryFn: api.aiStatus, staleTime: 60_000, retry: false })

export function useDeleteWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteWorkflow,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workflows })
      void qc.invalidateQueries({ queryKey: qk.stats })
    },
  })
}
