import { CloudOff, KeyRound, RotateCw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14',
        className,
      )}
    >
      <div className="relative">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-primary/10 blur-xl" />
        <div
          className={cn(
            'flex items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-soft',
            compact ? 'size-9 [&_svg]:size-4' : 'size-12 [&_svg]:size-5',
          )}
        >
          {icon}
        </div>
      </div>
      <div className="max-w-sm space-y-1">
        <p className={cn('font-semibold tracking-tight', compact ? 'text-sm' : 'text-base')}>{title}</p>
        {description && <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  className,
  compact,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
  compact?: boolean
}) {
  const apiErr = error instanceof ApiError ? error : null
  const offline = apiErr?.isNetwork
  const unauthorized = apiErr?.status === 401
  return (
    <EmptyState
      compact={compact}
      className={className}
      icon={offline ? <CloudOff /> : unauthorized ? <KeyRound /> : <TriangleAlert />}
      title={offline ? 'Cannot reach the FlowPilot server' : unauthorized ? 'API key required' : 'Something went wrong'}
      description={
        offline
          ? 'Retrying automatically. If it does not come back, check that the backend is running (default http://localhost:5080).'
          : unauthorized
            ? 'This server requires an API key. Add it in Settings.'
            : error instanceof Error
              ? error.message
              : String(error)
      }
      action={
        <>
          {unauthorized && (
            <Button asChild size="sm" variant="secondary">
              <Link to="/settings">Open settings</Link>
            </Button>
          )}
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              <RotateCw /> Retry
            </Button>
          )}
        </>
      }
    />
  )
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4 pb-6', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className={cn('mx-auto w-full px-6 py-7 lg:px-8', wide ? 'max-w-[1400px]' : 'max-w-6xl', className)}>
        {children}
      </div>
    </div>
  )
}
