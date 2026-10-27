import { Activity, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { useRuns, useWorkflows } from '@/api/hooks'
import { useHubStatus } from '@/api/realtime'
import type { RunStatus } from '@/api/types'
import { LiveDuration } from '@/components/LiveDuration'
import { EmptyState, ErrorState, Page, PageHeader } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { ACTIVE_STATUSES } from '@/lib/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { Tooltip } from '@/components/ui/tooltip'
import { formatDateTime, relativeTime, shortId } from '@/lib/utils'

const STATUSES: RunStatus[] = ['Pending', 'Running', 'Suspended', 'Completed', 'Failed', 'Cancelled']
const PAGE = 25

export default function RunsPage() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') ?? '') as RunStatus | ''
  const workflowId = params.get('workflowId') ?? ''
  const page = Number(params.get('page') ?? '0') || 0
  const runs = useRuns({ status, workflowId, skip: page * PAGE, take: PAGE })
  const workflows = useWorkflows()
  const navigate = useNavigate()
  const hub = useHubStatus()

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  const total = runs.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <Page wide>
      <PageHeader
        title="Runs"
        description="Every execution across your workflows, updated live."
        actions={
          <>
            {hub === 'connected' && (
              <Badge variant="success" className="h-6">
                <span className="relative flex size-1.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative size-1.5 rounded-full bg-emerald-500" />
                </span>
                Live
              </Badge>
            )}
            <Button variant="secondary" onClick={() => void runs.refetch()} disabled={runs.isFetching}>
              <RotateCw className={runs.isFetching ? 'animate-spin' : undefined} /> Refresh
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          className="w-44"
          ariaLabel="Filter by status"
          value={status}
          onValueChange={(v) => setParam('status', v)}
          options={[{ value: '', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
        />
        <Select
          className="w-60"
          ariaLabel="Filter by workflow"
          value={workflowId}
          onValueChange={(v) => setParam('workflowId', v)}
          options={[
            { value: '', label: 'All workflows' },
            ...(workflows.data ?? []).map((w) => ({ value: w.id, label: w.name })),
          ]}
        />
        {(status || workflowId) && (
          <Button variant="subtle" size="sm" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {runs.isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="ml-auto h-3.5 w-24" />
              </div>
            ))}
          </div>
        ) : runs.isError ? (
          <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
        ) : !runs.data?.items.length ? (
          <EmptyState
            icon={<Activity />}
            title={status || workflowId ? 'No runs match these filters' : 'No runs yet'}
            description={status || workflowId ? 'Try a different status or workflow.' : 'Start a workflow from the designer or the workflows list.'}
          />
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="w-36 px-4 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Workflow</th>
                <th className="hidden w-32 px-3 py-2.5 font-medium md:table-cell">Run</th>
                <th className="hidden w-24 px-3 py-2.5 font-medium lg:table-cell">Version</th>
                <th className="w-36 px-3 py-2.5 font-medium">Started</th>
                <th className="w-28 px-4 py-2.5 text-right font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs.data.items.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  onClick={() => navigate(`/runs/${r.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/runs/${r.id}`)}
                  className="cursor-pointer outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/60"
                >
                  <td className="px-4 py-2.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="max-w-0 px-3 py-2.5">
                    <p className="truncate font-medium">{r.workflowName}</p>
                    {r.error && <p className="truncate text-xs text-red-600 dark:text-red-400">{r.error}</p>}
                  </td>
                  <td className="hidden px-3 py-2.5 font-mono text-xs text-muted-foreground md:table-cell">{shortId(r.id)}</td>
                  <td className="hidden px-3 py-2.5 lg:table-cell">
                    {r.version ? <Badge variant="outline">v{r.version}</Badge> : <Badge variant="muted">Draft</Badge>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    <Tooltip content={formatDateTime(r.startedAt ?? r.createdAt)}>
                      <span>{relativeTime(r.startedAt ?? r.createdAt)}</span>
                    </Tooltip>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                    {ACTIVE_STATUSES.includes(r.status) || r.durationMs != null || r.completedAt ? <LiveDuration run={r} /> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {total > PAGE && (
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setParam('page', String(page - 1))}
              >
                <ChevronLeft />
              </Button>
              <span className="px-1 tabular-nums">
                {page + 1} / {pages}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next page"
                disabled={page + 1 >= pages}
                onClick={() => setParam('page', String(page + 1))}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </Page>
  )
}
