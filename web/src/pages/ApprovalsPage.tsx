import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCheck, Clock, ExternalLink, Inbox, User, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useApprovals } from '@/api/hooks'
import type { Approval, Json } from '@/api/types'
import { EmptyState, ErrorState, Page, PageHeader } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Label, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { formatDateTime, relativeTime, shortId } from '@/lib/utils'

type Decision = 'approve' | 'reject'

function resolutionInfo(resolution: Json | undefined): { decision: 'approved' | 'rejected' | 'resolved'; comment?: string } {
  if (resolution && typeof resolution === 'object' && !Array.isArray(resolution)) {
    const r = resolution as Record<string, Json>
    const raw = String(r.decision ?? r.outcome ?? r.status ?? (r.approved === true ? 'approved' : r.approved === false ? 'rejected' : '')).toLowerCase()
    const comment = typeof r.comment === 'string' ? r.comment : undefined
    if (raw.startsWith('approv')) return { decision: 'approved', comment }
    if (raw.startsWith('reject')) return { decision: 'rejected', comment }
    return { decision: 'resolved', comment }
  }
  if (typeof resolution === 'string') {
    const raw = resolution.toLowerCase()
    if (raw.startsWith('approv')) return { decision: 'approved' }
    if (raw.startsWith('reject')) return { decision: 'rejected' }
  }
  return { decision: 'resolved' }
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState<'pending' | 'resolved'>('pending')
  const pending = useApprovals('pending')
  const resolved = useApprovals('resolved')
  const [action, setAction] = useState<{ approval: Approval; decision: Decision } | null>(null)

  return (
    <Page>
      <PageHeader title="Approvals" description="Human-in-the-loop decisions waiting on you." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'resolved')}>
        <TabsList className="mb-4">
          <TabsTrigger value="pending">
            <Clock /> Pending
            {!!pending.data?.length && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground">
                {pending.data.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="resolved">
            <CheckCheck /> Resolved
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <ApprovalList
            query={pending}
            empty={<EmptyState icon={<Inbox />} title="Inbox zero" description="When a workflow reaches an approval step, it shows up here." />}
            render={(a) => (
              <ApprovalCard key={a.id} approval={a}>
                <Button variant="secondary" size="sm" onClick={() => setAction({ approval: a, decision: 'reject' })}>
                  <X /> Reject
                </Button>
                <Button variant="success" size="sm" onClick={() => setAction({ approval: a, decision: 'approve' })}>
                  <Check /> Approve
                </Button>
              </ApprovalCard>
            )}
          />
        </TabsContent>
        <TabsContent value="resolved">
          <ApprovalList
            query={resolved}
            empty={<EmptyState icon={<CheckCheck />} title="Nothing resolved yet" description="Decisions you make appear here." />}
            render={(a) => {
              const info = resolutionInfo(a.resolution)
              return (
                <ApprovalCard key={a.id} approval={a} comment={info.comment}>
                  <Badge variant={info.decision === 'approved' ? 'success' : info.decision === 'rejected' ? 'danger' : 'muted'}>
                    {info.decision === 'approved' ? <Check /> : info.decision === 'rejected' ? <X /> : null}
                    {info.decision[0].toUpperCase() + info.decision.slice(1)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{relativeTime(a.resolvedAt)}</span>
                </ApprovalCard>
              )
            }}
          />
        </TabsContent>
      </Tabs>
      <DecisionDialog action={action} onClose={() => setAction(null)} />
    </Page>
  )
}

function ApprovalList({
  query,
  empty,
  render,
}: {
  query: ReturnType<typeof useApprovals>
  empty: ReactNode
  render: (a: Approval) => ReactNode
}) {
  if (query.isLoading)
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    )
  if (query.isError)
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Card>
    )
  if (!query.data?.length) return <Card>{empty}</Card>
  return <div className="space-y-2">{query.data.map(render)}</div>
}

function ApprovalCard({ approval: a, children, comment }: { approval: Approval; children: ReactNode; comment?: string }) {
  return (
    <Card className="flex flex-wrap items-start gap-4 p-4 animate-slide-up">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/12 text-rose-600 dark:text-rose-300">
        <Inbox className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{a.title || 'Approval requested'}</p>
        {a.description && <p className="mt-0.5 text-sm whitespace-pre-wrap text-muted-foreground">{a.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Link to={`/workflows/${a.workflowId}`} className="font-medium text-foreground/80 hover:text-foreground hover:underline">
            {a.workflowName}
          </Link>
          <Link to={`/runs/${a.runId}`} className="inline-flex items-center gap-1 font-mono hover:text-foreground">
            run {shortId(a.runId)} <ExternalLink className="size-3" />
          </Link>
          <span className="font-mono">{a.nodeId}</span>
          {a.assignee && (
            <span className="inline-flex items-center gap-1">
              <User className="size-3" /> {a.assignee}
            </span>
          )}
          <Tooltip content={formatDateTime(a.createdAt)}>
            <span>{relativeTime(a.createdAt)}</span>
          </Tooltip>
        </div>
        {comment && <p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs">“{comment}”</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </Card>
  )
}

function DecisionDialog({ action, onClose }: { action: { approval: Approval; decision: Decision } | null; onClose: () => void }) {
  const [comment, setComment] = useState('')
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: Decision; comment: string }) =>
      decision === 'approve' ? api.approve(id, comment) : api.reject(id, comment),
    onSuccess: (_d, v) => {
      toast.success(v.decision === 'approve' ? 'Approved' : 'Rejected', { description: 'The run will resume shortly.' })
      void qc.invalidateQueries({ queryKey: qk.approvalsAll })
      void qc.invalidateQueries({ queryKey: qk.stats })
      setComment('')
      onClose()
    },
  })
  const approve = action?.decision === 'approve'
  return (
    <Dialog open={!!action} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title={approve ? 'Approve request' : 'Reject request'}
          description={action?.approval.title}
          icon={approve ? <Check /> : <X />}
        />
        <DialogBody className="space-y-1.5">
          <Label htmlFor="decision-comment">Comment (optional)</Label>
          <Textarea
            id="decision-comment"
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={approve ? 'Looks good to me' : 'Reason for rejecting'}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={approve ? 'success' : 'destructive'}
            disabled={mutation.isPending}
            onClick={() => action && mutation.mutate({ id: action.approval.id, decision: action.decision, comment })}
          >
            {approve ? <Check /> : <X />}
            {approve ? 'Approve' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
