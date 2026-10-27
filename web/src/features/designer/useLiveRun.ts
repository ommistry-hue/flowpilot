import { useEffect } from 'react'
import { useStore } from 'zustand'
import { useReloadRun, useRun } from '@/api/hooks'
import { useHubEvent, useHubStatus, useRunChannel } from '@/api/realtime'
import { ACTIVE_STATUSES } from '@/lib/status'
import type { DesignerStore } from './store'

export function useLiveRun(store: DesignerStore, runId: string | null) {
  const query = useRun(runId ?? undefined)
  const { refetch } = query
  const hub = useHubStatus()
  const reloadRun = useReloadRun()
  useRunChannel(runId, () => runId && void reloadRun(runId))

  useEffect(() => {
    if (query.data) store.getState().setRunDetail(query.data)
  }, [query.data, store])

  useHubEvent('nodeUpdated', (e) => {
    if (runId && e.runId === runId) store.getState().applyExecution(e)
  })

  useHubEvent('runUpdated', (r) => {
    if (!runId || r.id !== runId) return
    store.getState().applyRunSummary(r)
    if (!ACTIVE_STATUSES.includes(r.status)) void refetch()
  })

  const status = useStore(store, (s) => s.run?.status)
  const active = !!runId && (!status || ACTIVE_STATUSES.includes(status))
  useEffect(() => {
    if (!active || hub === 'connected') return
    const t = setInterval(() => void refetch(), 1500)
    return () => clearInterval(t)
  }, [active, hub, refetch])

  return query
}
