import { MousePointerClick } from 'lucide-react'
import { useState } from 'react'
import { useCatalog } from '@/api/hooks'
import type { NodeExecution } from '@/api/types'
import { JsonViewer } from '@/components/JsonViewer'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ActivityIcon } from '@/components/ActivityIcon'
import { STATUS_DOT } from '@/lib/status'
import { cn, durationBetween, formatDateTime, formatDuration } from '@/lib/utils'

export function ExecutionDetails({
  nodeId,
  label,
  executions,
  className,
}: {
  nodeId: string | null
  label?: string
  executions: NodeExecution[]
  className?: string
}) {
  const catalog = useCatalog()
  const [picked, setPicked] = useState<string | null>(null)

  if (!nodeId) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground', className)}>
        <MousePointerClick className="size-5" />
        Select a node or a timeline row to inspect its input and output.
      </div>
    )
  }
  if (executions.length === 0) {
    return (
      <div className={cn('flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground', className)}>
        {label ?? nodeId} has not executed in this run.
      </div>
    )
  }

  const exec = executions.find((e) => e.id === picked) ?? executions[executions.length - 1]
  const retriesOnly = new Set(executions.map((e) => e.attempt)).size === executions.length
  const chipLabel = (e: NodeExecution, i: number) =>
    retriesOnly ? `Attempt ${e.attempt}` : `#${i + 1}${e.attempt > 1 ? ` · attempt ${e.attempt}` : ''}`
  const defaultTab = exec.status === 'Failed' && exec.error ? 'error' : exec.output !== undefined && exec.output !== null ? 'output' : 'input'

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <ActivityIcon type={exec.nodeType} descriptor={catalog.byType.get(exec.nodeType)} size="sm" />
        <span className="truncate text-sm font-semibold">{label ?? nodeId}</span>
        <StatusBadge status={exec.status} />
        {exec.outcome && <Badge variant="outline">→ {exec.outcome}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {formatDuration(exec.durationMs ?? durationBetween(exec.startedAt, exec.completedAt))}
        </span>
      </div>
      {executions.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {executions.map((e, i) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setPicked(e.id)}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                e.id === exec.id ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'hover:bg-accent',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  STATUS_DOT[e.status],
                )}
              />
              {chipLabel(e, i)}
            </button>
          ))}
        </div>
      )}
      <p className="mb-2 text-[11px] text-muted-foreground">Started {formatDateTime(exec.startedAt)}</p>
      <Tabs key={exec.id} defaultValue={defaultTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mb-2 self-start">
          <TabsTrigger value="input">Input</TabsTrigger>
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="error" className={exec.error ? 'text-destructive data-[state=active]:text-destructive' : undefined}>
            Error
          </TabsTrigger>
        </TabsList>
        <TabsContent value="input" className="min-h-0">
          <JsonViewer value={exec.input} emptyLabel="No input" />
        </TabsContent>
        <TabsContent value="output" className="min-h-0">
          <JsonViewer value={exec.output} emptyLabel={exec.status === 'Running' ? 'Still running…' : 'No output'} />
        </TabsContent>
        <TabsContent value="error" className="min-h-0">
          {exec.error ? (
            <pre className="max-h-80 overflow-auto rounded-lg border border-destructive/30 bg-destructive/8 p-3 font-mono text-[12px] whitespace-pre-wrap text-destructive scrollbar-thin">
              {exec.error}
            </pre>
          ) : (
            <p className="rounded-lg border bg-muted/40 px-3 py-3 text-xs text-muted-foreground italic">No error</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
