import { Ban, CircleCheck, CircleDashed, CircleX, Loader2, PauseCircle } from 'lucide-react'
import type { NodeStatus, RunStatus } from '@/api/types'
import { STATUS_DOT } from '@/lib/status'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type AnyStatus = RunStatus | NodeStatus

const META: Record<AnyStatus, { variant: BadgeVariant; icon: typeof Loader2; label: string }> = {
  Pending: { variant: 'muted', icon: CircleDashed, label: 'Pending' },
  Running: { variant: 'info', icon: Loader2, label: 'Running' },
  Suspended: { variant: 'warning', icon: PauseCircle, label: 'Suspended' },
  Completed: { variant: 'success', icon: CircleCheck, label: 'Completed' },
  Failed: { variant: 'danger', icon: CircleX, label: 'Failed' },
  Cancelled: { variant: 'muted', icon: Ban, label: 'Cancelled' },
}

export function StatusBadge({ status, className }: { status: AnyStatus; className?: string }) {
  const m = META[status] ?? META.Pending
  const Icon = m.icon
  return (
    <Badge variant={m.variant} className={className}>
      <Icon className={cn(status === 'Running' && 'animate-spin')} />
      {m.label}
    </Badge>
  )
}

export function StatusDot({ status, className }: { status: AnyStatus; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0 rounded-full', STATUS_DOT[status], className)}>
      {status === 'Running' && (
        <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', STATUS_DOT[status])} />
      )}
    </span>
  )
}
