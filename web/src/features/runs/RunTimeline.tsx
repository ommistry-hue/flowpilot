import { useMemo } from 'react'
import type { NodeExecution } from '@/api/types'
import { useNow } from '@/lib/useNow'
import { Tooltip } from '@/components/ui/tooltip'
import { ActivityIcon } from '@/components/ActivityIcon'
import { useCatalog } from '@/api/hooks'
import { isTerminalExecution } from '@/lib/status'
import { cn, formatDuration } from '@/lib/utils'

/** End of an execution in ms: its completion, or the ticking clock while it is still open. */
function endOf(e: NodeExecution, clock: number): number {
  if (e.completedAt) return new Date(e.completedAt).getTime()
  // A cancelled execution may carry no completion time; it must not keep growing.
  if (isTerminalExecution(e)) return new Date(e.startedAt).getTime() + (e.durationMs ?? 0)
  return clock
}

const BAR: Record<NodeExecution['status'], string> = {
  Running: 'bg-primary/80 bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,.35)_50%,transparent_75%)] bg-[length:200%_100%] animate-shimmer',
  Completed: 'bg-emerald-500',
  Failed: 'bg-red-500',
  Suspended: 'bg-amber-500 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgba(255,255,255,.3)_4px_8px)]',
  Cancelled: 'bg-zinc-400 dark:bg-zinc-500',
}

export function RunTimeline({
  executions,
  nodeLabel,
  selectedId,
  onSelect,
  live,
  compact,
}: {
  executions: NodeExecution[]
  nodeLabel: (nodeId: string) => string
  selectedId?: string | null
  onSelect?: (exec: NodeExecution) => void
  live?: boolean
  compact?: boolean
}) {
  const catalog = useCatalog()
  const now = useNow(!!live || executions.some((e) => !e.completedAt && !isTerminalExecution(e)), 500)

  const { rows, start, span, clock } = useMemo(() => {
    const sorted = [...executions].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.attempt - b.attempt)
    const times = sorted.map((e) => new Date(e.startedAt).getTime()).filter((t) => !Number.isNaN(t))
    // The ticking clock can lag behind an execution that started since its last tick.
    const clock = Math.max(now, ...times)
    const start = times.length ? Math.min(...times) : clock
    const ends = sorted.map((e) => endOf(e, clock))
    const end = Math.max(start + 1, ...ends)
    return { rows: sorted, start, span: end - start, clock }
  }, [executions, now])

  if (rows.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">No node executions yet.</p>
  }

  const ticks = compact ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="min-w-0">
      <div className={`grid ${compact ? 'grid-cols-[minmax(100px,150px)_1fr]' : 'grid-cols-[minmax(140px,200px)_1fr]'} items-end gap-3 px-3 pb-1.5 text-[10px] text-muted-foreground`}>
        <span>Node</span>
        <div className="relative h-3">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 tabular-nums first:translate-x-0 last:-translate-x-full"
              style={{ left: `${t * 100}%` }}
            >
              {formatDuration(span * t)}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-px">
        {rows.map((e) => {
          const s = new Date(e.startedAt).getTime() - start
          const end = endOf(e, clock) - start
          const left = Math.max(0, (s / span) * 100)
          const width = Math.max(0.6, ((end - s) / span) * 100)
          const dur = e.durationMs ?? end - s
          const selected = selectedId === e.id
          return (
            <button
              type="button"
              key={e.id}
              onClick={() => onSelect?.(e)}
              className={cn(
                'grid w-full items-center',
                compact ? 'grid-cols-[minmax(100px,150px)_1fr]' : 'grid-cols-[minmax(140px,200px)_1fr]',
                'gap-3 rounded-md px-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60',
                compact ? 'h-7' : 'h-8',
                selected && 'bg-primary-soft hover:bg-primary-soft',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <ActivityIcon type={e.nodeType} descriptor={catalog.byType.get(e.nodeType)} size="sm" className="size-5 [&_svg]:size-3" />
                <span className="truncate text-xs font-medium">{nodeLabel(e.nodeId)}</span>
                {e.attempt > 1 && (
                  <span className="shrink-0 rounded bg-muted px-1 text-[9.5px] font-medium text-muted-foreground">#{e.attempt}</span>
                )}
              </span>
              <span className="relative h-full">
                {ticks.slice(1, -1).map((t) => (
                  <span key={t} className="absolute inset-y-1 w-px bg-border/70" style={{ left: `${t * 100}%` }} />
                ))}
                <Tooltip
                  content={
                    <span>
                      {e.status}
                      {e.outcome ? ` → ${e.outcome}` : ''} · {formatDuration(dur)}
                      {e.attempt > 1 ? ` · attempt ${e.attempt}` : ''}
                    </span>
                  }
                >
                  <span
                    className={cn('absolute top-1/2 h-3 -translate-y-1/2 rounded-[4px]', BAR[e.status])}
                    style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, minWidth: 4 }}
                  />
                </Tooltip>
                <span
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 pl-1.5 text-[10px] text-muted-foreground tabular-nums"
                  style={left + width > 82 ? { right: `${100 - left}%`, paddingRight: 6 } : { left: `${left + width}%` }}
                >
                  {formatDuration(dur)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
