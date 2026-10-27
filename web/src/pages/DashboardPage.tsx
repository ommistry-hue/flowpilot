import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CircleX,
  Inbox,
  Plus,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApprovals, useRuns, useStats } from '@/api/hooks'
import { RunsChart } from '@/components/RunsChart'
import { EmptyState, ErrorState, Page, PageHeader } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import { cn, formatDuration, relativeTime, shortId } from '@/lib/utils'

function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone,
  to,
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  hint?: ReactNode
  tone?: 'danger' | 'primary'
  to?: string
}) {
  const body = (
    <Card className={cn('group h-full p-4 transition-colors', to && 'hover:border-input')}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5',
            tone === 'danger' && 'bg-red-500/10 text-red-600 dark:text-red-400',
            tone === 'primary' && 'bg-primary-soft text-primary-soft-foreground',
          )}
        >
          <Icon />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {hint}
        {to && <ArrowUpRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
    </Card>
  )
  return to ? (
    <Link to={to} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
      {body}
    </Link>
  ) : (
    body
  )
}

export function DashboardPage() {
  const stats = useStats()
  const runs = useRuns({ take: 8 })
  const approvals = useApprovals('pending')
  const navigate = useNavigate()

  if (stats.isError) {
    return (
      <Page>
        <PageHeader title="Dashboard" description="Overview of your automations." />
        <Card>
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        </Card>
      </Page>
    )
  }

  const s = stats.data
  const failRate = s && s.runs24h > 0 ? Math.round((s.failed24h / s.runs24h) * 100) : 0
  const noWorkflows = s && s.workflows === 0

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        description="Overview of your automations."
        actions={
          <Button onClick={() => navigate('/workflows/new')}>
            <Plus /> Create workflow
          </Button>
        }
      />

      {noWorkflows && (
        <Card className="relative mb-6 overflow-hidden p-6">
          <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-primary/15 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-lg">
              <p className="text-xs font-semibold tracking-wide text-primary uppercase">Get started</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">Build your first workflow</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Drag activities onto the canvas, connect outcomes and hit Run. Or describe what you want and let AI draft
                it for you.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => navigate('/workflows/new?ai=1')}>
                <Sparkles /> Generate with AI
              </Button>
              <Button onClick={() => navigate('/workflows/new')}>
                <Plus /> Blank workflow
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!s ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-xl" />)
        ) : (
          <>
            <StatCard label="Workflows" value={s.workflows} icon={Workflow} hint="Total definitions" to="/workflows" />
            <StatCard label="Runs (24h)" value={s.runs24h} icon={Activity} hint="Started in the last day" to="/runs" />
            <StatCard
              label="Failed (24h)"
              value={s.failed24h}
              icon={CircleX}
              tone={s.failed24h > 0 ? 'danger' : undefined}
              hint={s.runs24h > 0 ? `${failRate}% failure rate` : 'No runs yet'}
              to="/runs?status=Failed"
            />
            <StatCard
              label="Pending approvals"
              value={s.pendingApprovals}
              icon={Inbox}
              tone={s.pendingApprovals > 0 ? 'primary' : undefined}
              hint={s.pendingApprovals > 0 ? 'Waiting for a decision' : 'Inbox zero'}
              to="/approvals"
            />
          </>
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Runs by day</CardTitle>
          </CardHeader>
          <CardContent className="h-60">
            {!s ? (
              <Skeleton className="h-full" />
            ) : s.runsByDay.length === 0 || s.runsByDay.every((d) => d.completed + d.failed === 0) ? (
              <EmptyState compact icon={<Activity />} title="No runs yet" description="Run a workflow to see activity here." />
            ) : (
              <RunsChart data={s.runsByDay} className="h-full" />
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Pending approvals</CardTitle>
            <Button variant="link" size="sm" asChild className="text-xs">
              <Link to="/approvals">
                View all <ArrowRight className="size-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="flex-1">
            {approvals.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : approvals.isError ? (
              <ErrorState compact error={approvals.error} />
            ) : !approvals.data?.length ? (
              <EmptyState compact icon={<Inbox />} title="All caught up" description="No approvals are waiting." />
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {approvals.data.slice(0, 5).map((a) => (
                  <li key={a.id}>
                    <Link
                      to="/approvals"
                      className="flex items-center gap-3 rounded-md px-2 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-rose-500/12 text-rose-600 dark:text-rose-300">
                        <Inbox className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{a.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {a.workflowName} · {relativeTime(a.createdAt)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
          <Button variant="link" size="sm" asChild className="text-xs">
            <Link to="/runs">
              View all <ArrowRight className="size-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="px-2">
          {runs.isLoading ? (
            <div className="space-y-2 px-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : runs.isError ? (
            <ErrorState compact error={runs.error} />
          ) : !runs.data?.items.length ? (
            <EmptyState compact icon={<Activity />} title="No runs yet" description="Runs appear here as soon as a workflow starts." />
          ) : (
            <ul>
              {runs.data.items.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/runs/${r.id}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md px-2 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 sm:grid-cols-[minmax(0,1fr)_110px_90px_110px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.workflowName}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{shortId(r.id)}</p>
                    </div>
                    <StatusBadge status={r.status} className="justify-self-start" />
                    <span className="hidden text-xs text-muted-foreground tabular-nums sm:block">
                      {formatDuration(r.durationMs)}
                    </span>
                    <span className="hidden text-right text-xs text-muted-foreground sm:block">{relativeTime(r.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Page>
  )
}
