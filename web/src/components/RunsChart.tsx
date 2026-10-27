import { useState } from 'react'
import type { Stats } from '@/api/types'
import { cn } from '@/lib/utils'

type Day = Stats['runsByDay'][number]

function niceMax(v: number): number {
  if (v <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(v))
  const n = v / pow
  const step = n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

function dayLabel(date: string, long = false): string {
  const d = new Date(date.length <= 10 ? `${date}T00:00:00` : date)
  if (Number.isNaN(d.getTime())) return date
  return long
    ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function RunsChart({ data, className }: { data: Day[]; className?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(0, ...data.map((d) => d.completed + d.failed)))
  const ticks = [max, max / 2, 0]
  const total = data.reduce((s, d) => s + d.completed + d.failed, 0)
  const labelEvery = data.length > 10 ? Math.ceil(data.length / 7) : 1

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-emerald-500" /> Completed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-red-500" /> Failed
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 gap-2">
        <div className="flex w-6 flex-col justify-between pb-5 text-right text-[10px] tabular-nums text-muted-foreground">
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {Math.round(t)}
            </span>
          ))}
        </div>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative flex-1">
            {ticks.map((t, i) => (
              <div
                key={t}
                className={cn('absolute inset-x-0 border-t', i === ticks.length - 1 ? 'border-border' : 'border-dashed border-border/70')}
                style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end gap-[3px] px-0.5" role="img" aria-label={`Runs per day, ${total} total`}>
              {data.map((d, i) => {
                const c = (d.completed / max) * 100
                const f = (d.failed / max) * 100
                return (
                  <div
                    key={d.date}
                    className="group relative flex h-full flex-1 flex-col justify-end"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <div
                      className={cn(
                        'mx-auto flex w-full max-w-7 flex-col justify-end gap-[2px] transition-opacity',
                        hover !== null && hover !== i && 'opacity-45',
                      )}
                      style={{ height: '100%' }}
                    >
                      {d.failed > 0 && (
                        <div className="rounded-t-[4px] bg-red-500" style={{ height: `${f}%`, minHeight: 2 }} />
                      )}
                      {d.completed > 0 && (
                        <div
                          className={cn('bg-emerald-500', d.failed === 0 && 'rounded-t-[4px]')}
                          style={{ height: `${c}%`, minHeight: 2 }}
                        />
                      )}
                    </div>
                    {hover === i && (
                      <div
                        className={cn(
                          'pointer-events-none absolute bottom-full z-10 mb-2 w-max animate-fade-in rounded-lg border bg-popover px-2.5 py-2 text-xs shadow-elevated',
                          i > data.length / 2 ? 'right-0' : 'left-0',
                        )}
                      >
                        <p className="mb-1 font-medium">{dayLabel(d.date, true)}</p>
                        <p className="flex items-center justify-between gap-4 text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-[2px] bg-emerald-500" />
                            Completed
                          </span>
                          <span className="font-medium text-foreground tabular-nums">{d.completed}</span>
                        </p>
                        <p className="flex items-center justify-between gap-4 text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-[2px] bg-red-500" />
                            Failed
                          </span>
                          <span className="font-medium text-foreground tabular-nums">{d.failed}</span>
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex h-5 items-end gap-[3px] px-0.5">
            {data.map((d, i) => (
              <span key={d.date} className="flex-1 truncate text-center text-[10px] text-muted-foreground">
                {i % labelEvery === 0 ? dayLabel(d.date) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
