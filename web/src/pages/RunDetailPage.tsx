import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { Bookmark, ChevronLeft, CircleX, Pencil, RotateCcw, Square } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useStore } from 'zustand'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useReloadRun, useRun } from '@/api/hooks'
import { useHubEvent, useHubStatus, useRunChannel } from '@/api/realtime'
import type { RunDetail } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { JsonViewer } from '@/components/JsonViewer'
import { LiveDuration } from '@/components/LiveDuration'
import { TopbarPortal } from '@/components/layout/TopbarSlot'
import { EmptyState, ErrorState } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { ACTIVE_STATUSES } from '@/lib/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { Canvas } from '@/features/designer/Canvas'
import { createDesignerStore, DesignerContext, type DesignerStore } from '@/features/designer/store'
import { ExecutionDetails } from '@/features/runs/ExecutionDetails'
import { RunTimeline } from '@/features/runs/RunTimeline'
import { formatDateTime, relativeTime, shortId } from '@/lib/utils'

function useRunLiveCache(id: string | undefined, active: boolean) {
  const qc = useQueryClient()
  const hub = useHubStatus()
  const reloadRun = useReloadRun()
  useRunChannel(id, () => id && void reloadRun(id))

  useHubEvent('nodeUpdated', (e) => {
    if (e.runId !== id) return
    qc.setQueryData<RunDetail>(qk.run(id), (old) => {
      if (!old) return old
      const idx = old.nodes.findIndex((n) => n.id === e.id)
      const nodes = idx === -1 ? [...old.nodes, e] : old.nodes.map((n, i) => (i === idx ? e : n))
      return { ...old, nodes }
    })
  })
  useHubEvent('runUpdated', (r) => {
    if (r.id !== id) return
    qc.setQueryData<RunDetail>(qk.run(id), (old) => (old ? { ...old, ...r } : old))
    if (!ACTIVE_STATUSES.includes(r.status)) void qc.invalidateQueries({ queryKey: qk.run(id) })
  })

  useEffect(() => {
    if (!id || !active || hub === 'connected') return
    const t = setInterval(() => void qc.invalidateQueries({ queryKey: qk.run(id) }), 2000)
    return () => clearInterval(t)
  }, [active, hub, id, qc])
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 truncate text-sm font-medium">{children}</div>
    </div>
  )
}

export default function RunDetailPage() {
  const { id } = useParams()
  const run = useRun(id)
  const active = !!run.data && ACTIVE_STATUSES.includes(run.data.status)
  useRunLiveCache(id, active)

  if (run.isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <ErrorState error={run.error} onRetry={() => void run.refetch()} />
      </div>
    )
  }
  if (!run.data) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-[420px] rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    )
  }
  return <RunDetailView key={run.data.id} detail={run.data} />
}

function RunDetailView({ detail }: { detail: RunDetail }) {
  const qc = useQueryClient()
  const [store] = useState<DesignerStore>(() => {
    const s = createDesignerStore({ definition: detail.definition, workflowId: detail.workflowId, readOnly: true })
    s.getState().startRun(detail.id)
    return s
  })
  const [confirmCancel, setConfirmCancel] = useState(false)
  const inspectNodeId = useStore(store, (s) => s.inspectNodeId)
  const nodes = useStore(store, (s) => s.nodes)
  const byNode = useStore(store, (s) => s.run?.byNode)

  useEffect(() => {
    store.getState().setRunDetail(detail)
  }, [detail, store])

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.run(detail.id) })
    void qc.invalidateQueries({ queryKey: qk.runsAll })
  }
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(detail.id),
    onSuccess: () => {
      toast.success('Run cancelled')
      setConfirmCancel(false)
      invalidate()
    },
  })
  const retry = useMutation({
    mutationFn: () => api.retryRun(detail.id),
    onSuccess: () => {
      toast.success('Retrying from the failed node')
      invalidate()
    },
  })

  const label = (nid: string) => nodes.find((n) => n.id === nid)?.data.name || nid
  const selectedExecs = (inspectNodeId && byNode?.[inspectNodeId]) || []
  const active = ACTIVE_STATUSES.includes(detail.status)
  const failedNode = [...detail.nodes].reverse().find((n) => n.status === 'Failed')

  return (
    <DesignerContext.Provider value={store}>
      <TopbarPortal>
        <Tooltip content="All runs">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/runs" aria-label="Back to runs">
              <ChevronLeft />
            </Link>
          </Button>
        </Tooltip>
        <span className="truncate text-sm font-semibold">{detail.workflowName}</span>
        <span className="font-mono text-xs text-muted-foreground">{shortId(detail.id)}</span>
        <StatusBadge status={detail.status} />
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/workflows/${detail.workflowId}`}>
              <Pencil /> <span className="hidden md:inline">Open in designer</span>
            </Link>
          </Button>
          {detail.status === 'Failed' && (
            <Button variant="secondary" size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
              <RotateCcw /> Retry
            </Button>
          )}
          {active && (
            <Button variant="secondary" size="sm" className="hover:text-destructive" onClick={() => setConfirmCancel(true)}>
              <Square /> Cancel
            </Button>
          )}
        </div>
      </TopbarPortal>

      <div className="h-full overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[1400px] space-y-3 px-6 py-6 lg:px-8">
          <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Status">
              <StatusBadge status={detail.status} />
            </Stat>
            <Stat label="Started">
              <Tooltip content={formatDateTime(detail.startedAt ?? detail.createdAt)}>
                <span>{relativeTime(detail.startedAt ?? detail.createdAt)}</span>
              </Tooltip>
            </Stat>
            <Stat label="Duration">
              <LiveDuration run={detail} />
            </Stat>
            <Stat label="Version">{detail.version ? <Badge variant="outline">v{detail.version}</Badge> : <Badge variant="muted">Draft</Badge>}</Stat>
            <Stat label="Trigger">
              <span className="font-mono text-xs">{detail.triggerNodeId ?? '—'}</span>
            </Stat>
            <Stat label="Node executions">{detail.nodes.length}</Stat>
          </Card>

          {detail.error && (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3">
              <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 text-sm">
                <p className="font-medium text-destructive">Run failed{failedNode ? ` at ${label(failedNode.nodeId)}` : ''}</p>
                <p className="mt-0.5 font-mono text-xs break-words text-destructive/90">{detail.error}</p>
              </div>
              {failedNode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto shrink-0"
                  onClick={() => {
                    store.getState().setInspectNode(failedNode.nodeId)
                    store.getState().selectOnly(failedNode.nodeId)
                  }}
                >
                  Inspect
                </Button>
              )}
            </div>
          )}

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card className="h-[440px] overflow-hidden">
              <ReactFlowProvider>
                <Canvas />
              </ReactFlowProvider>
            </Card>
            <Card className="flex h-[440px] flex-col overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle>Node details</CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                <ExecutionDetails
                  key={inspectNodeId ?? 'none'}
                  nodeId={inspectNodeId}
                  label={inspectNodeId ? label(inspectNodeId) : undefined}
                  executions={selectedExecs}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <span className="text-xs text-muted-foreground">Click a row to inspect it</span>
            </CardHeader>
            <CardContent className="px-1">
              <RunTimeline
                executions={detail.nodes}
                nodeLabel={label}
                live={active}
                selectedId={selectedExecs[selectedExecs.length - 1]?.id}
                onSelect={(e) => {
                  store.getState().setInspectNode(e.nodeId)
                  store.getState().selectOnly(e.nodeId)
                }}
              />
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Bookmarks</CardTitle>
                <span className="text-xs text-muted-foreground">{detail.bookmarks.length}</span>
              </CardHeader>
              <CardContent>
                {detail.bookmarks.length === 0 ? (
                  <EmptyState compact icon={<Bookmark />} title="No bookmarks" description="Approvals, delays and event waits create bookmarks." />
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {detail.bookmarks.map((b) => (
                      <li key={b.id} className="space-y-1.5 px-3 py-2.5">
                        <div className="flex items-center gap-2 text-sm">
                          <Badge variant={b.resolvedAt ? 'muted' : 'warning'}>{b.kind}</Badge>
                          <span className="font-mono text-xs">{b.nodeId}</span>
                          {b.correlationKey && <span className="truncate font-mono text-xs text-muted-foreground">key: {b.correlationKey}</span>}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {b.resolvedAt ? `resolved ${relativeTime(b.resolvedAt)}` : b.resumeAt ? `resumes ${relativeTime(b.resumeAt)}` : 'waiting'}
                          </span>
                        </div>
                        {(b.payload != null || b.resolution != null) && (
                          <JsonViewer value={b.resolution ?? b.payload} label={b.resolution != null ? 'Resolution' : 'Payload'} />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Data</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="input">
                  <TabsList className="mb-2">
                    <TabsTrigger value="input">Input</TabsTrigger>
                    <TabsTrigger value="variables">Variables</TabsTrigger>
                  </TabsList>
                  <TabsContent value="input">
                    <JsonViewer value={detail.input} emptyLabel="No input" />
                  </TabsContent>
                  <TabsContent value="variables">
                    <JsonViewer value={detail.variables} emptyLabel="No variables" />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        destructive
        title="Cancel this run?"
        description="Pending work items are deleted and open bookmarks are resolved. This cannot be undone."
        confirmLabel="Cancel run"
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </DesignerContext.Provider>
  )
}
