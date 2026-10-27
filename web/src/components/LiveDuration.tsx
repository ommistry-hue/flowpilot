import { useNow } from '@/lib/useNow'
import type { RunSummary } from '@/api/types'
import { durationBetween, formatDuration } from '@/lib/utils'

type Timing = Pick<RunSummary, 'status' | 'startedAt' | 'createdAt' | 'completedAt' | 'durationMs'>

export function LiveDuration({ run }: { run: Timing }) {
  const active = run.status === 'Running' || run.status === 'Pending'
  useNow(active)
  const ms = active
    ? durationBetween(run.startedAt ?? run.createdAt, null)
    : (run.durationMs ?? durationBetween(run.startedAt, run.completedAt))
  return <span className="tabular-nums">{formatDuration(ms)}</span>
}
