import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { Ban, CircleAlert, CircleCheck, CircleX, Loader2, PauseCircle } from 'lucide-react'
import { memo, useEffect } from 'react'
import { useCatalog } from '@/api/hooks'
import type { NodeExecution } from '@/api/types'
import { Tooltip } from '@/components/ui/tooltip'
import { ActivityIcon } from '@/components/ActivityIcon'
import { cn, formatDuration } from '@/lib/utils'
import {
  canHaveErrorHandle,
  configSummary,
  ERROR_OUTCOME,
  isTriggerType,
  NODE_WIDTH,
  outcomesFor,
  TARGET_HANDLE,
  type FlowNode,
} from './model'
import { useDesigner } from './store'

const EMPTY: NodeExecution[] = []

const STATUS_RING: Record<NodeExecution['status'], string> = {
  Running: 'ring-2 ring-primary animate-node-pulse border-transparent',
  Completed: 'ring-2 ring-emerald-500 border-transparent',
  Failed: 'ring-2 ring-red-500 border-transparent',
  Suspended: 'ring-2 ring-amber-500 border-transparent',
  Cancelled: 'ring-2 ring-zinc-400 border-transparent dark:ring-zinc-500',
}

function StatusIcon({ status }: { status: NodeExecution['status'] }) {
  switch (status) {
    case 'Running':
      return <Loader2 className="size-3.5 animate-spin text-primary" />
    case 'Completed':
      return <CircleCheck className="size-3.5 text-emerald-500" />
    case 'Failed':
      return <CircleX className="size-3.5 text-red-500" />
    case 'Suspended':
      return <PauseCircle className="size-3.5 text-amber-500" />
    case 'Cancelled':
      return <Ban className="size-3.5 text-muted-foreground" />
  }
}

function ActivityNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const catalog = useCatalog()
  const descriptor = catalog.byType.get(data.activityType)
  const executions = useDesigner((s) => s.run?.byNode[id] ?? EMPTY)
  const hasRun = useDesigner((s) => !!s.run)
  const errors = useDesigner((s) => s.validation?.byNode[id])
  const readOnly = useDesigner((s) => s.readOnly)
  const errorWired = useDesigner((s) => s.edges.some((e) => e.source === id && e.sourceHandle === ERROR_OUTCOME))

  const last = executions[executions.length - 1]
  const trigger = isTriggerType(data.activityType, descriptor)
  const outcomes = outcomesFor(data.activityType, data.config, descriptor)
  const showErrorHandle = canHaveErrorHandle(data.activityType, descriptor)
  const summary = configSummary(data.activityType, data.config, descriptor)
  const title = data.name || descriptor?.displayName || data.activityType
  const multi = outcomes.length > 1 || (outcomes[0] && outcomes[0] !== 'done')
  const totalMs = executions.reduce((s, e) => s + (e.durationMs ?? 0), 0)

  const updateNodeInternals = useUpdateNodeInternals()
  const handleKey = outcomes.join('\n')
  useEffect(() => updateNodeInternals(id), [handleKey, id, updateNodeInternals])

  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={cn(
        'group relative rounded-xl border bg-card text-card-foreground shadow-soft transition-[box-shadow,border-color,opacity]',
        selected && !last && 'border-primary ring-3 ring-primary/20',
        last && STATUS_RING[last.status],
        selected && last && 'ring-offset-2 ring-offset-canvas',
        errors && !last && 'border-destructive ring-3 ring-destructive/25',
        hasRun && !last && 'opacity-55',
        !descriptor && 'border-dashed',
      )}
    >
      {!trigger && (
        <Handle
          type="target"
          id={TARGET_HANDLE}
          position={Position.Left}
          isConnectable={!readOnly}
          className="!top-[30px]"
        />
      )}

      <div className="flex items-center gap-2.5 px-3 pt-3 pb-2.5">
        <ActivityIcon type={data.activityType} descriptor={descriptor} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-tight font-semibold">{title}</p>
          <p className="mt-0.5 truncate font-mono text-[10.5px] leading-tight text-muted-foreground">
            {trigger && <span className="mr-1 font-sans font-medium text-amber-600 dark:text-amber-400">Trigger ·</span>}
            {data.activityType}
          </p>
        </div>
        {last ? (
          <Tooltip
            content={
              <span>
                {last.status}
                {executions.length > 1 ? ` · ${executions.length} attempts` : ''}
                {totalMs ? ` · ${formatDuration(totalMs)}` : ''}
              </span>
            }
          >
            <span className="flex items-center gap-1">
              {executions.length > 1 && (
                <span className="rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground tabular-nums">
                  ×{executions.length}
                </span>
              )}
              <StatusIcon status={last.status} />
            </span>
          </Tooltip>
        ) : errors ? (
          <Tooltip content={errors.join(' · ')}>
            <CircleAlert className="size-4 text-destructive" />
          </Tooltip>
        ) : null}
      </div>

      {summary && (
        <div className="mx-3 mb-2.5 truncate rounded-md bg-muted/70 px-2 py-1 font-mono text-[10.5px] text-muted-foreground">
          {summary}
        </div>
      )}

      {multi ? (
        <div className="border-t py-1.5">
          {outcomes.map((o) => (
            <div key={o} className="relative flex h-6 items-center justify-end pr-4 pl-3">
              <span
                className={cn(
                  'truncate text-[11px] font-medium text-muted-foreground',
                  last?.outcome === o && 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {o}
              </span>
              <Handle type="source" id={o} position={Position.Right} isConnectable={!readOnly} />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" id={outcomes[0] ?? 'done'} position={Position.Right} isConnectable={!readOnly} className="!top-[30px]" />
      )}

      {showErrorHandle && (
        <div
          className={cn(
            'absolute -bottom-px left-1/2 flex -translate-x-1/2 translate-y-full flex-col items-center transition-opacity',
            errorWired || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            readOnly && !errorWired && 'hidden',
          )}
        >
          <span className="h-2 w-px bg-red-400/60" />
          <span className="rounded-full border border-red-300/60 bg-card px-1.5 text-[9.5px] leading-3.5 font-medium text-red-600 dark:border-red-500/40 dark:text-red-400">
            on error
          </span>
          <Handle
            type="source"
            id={ERROR_OUTCOME}
            position={Position.Bottom}
            isConnectable={!readOnly}
            className="!relative !top-auto !bottom-auto !left-auto !mt-0.5 !transform-none !bg-red-500"
          />
        </div>
      )}
    </div>
  )
}

export const ActivityNode = memo(ActivityNodeView)
