import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import { X } from 'lucide-react'
import { memo, useState } from 'react'
import { cn } from '@/lib/utils'
import { ERROR_OUTCOME, type FlowEdge } from './model'
import { useDesigner, useDesignerApi } from './store'

function OutcomeEdgeView({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  selected,
  markerEnd,
}: EdgeProps<FlowEdge>) {
  const store = useDesignerApi()
  const readOnly = useDesigner((s) => s.readOnly)
  const invalid = useDesigner((s) => !!s.validation?.byEdge[id])
  const traversed = useDesigner((s) => {
    const src = s.run?.byNode[source]
    if (!src?.length || !s.run?.byNode[target]?.length) return false
    return src.some((e) => e.outcome === (sourceHandleId ?? 'done'))
  })
  const [hover, setHover] = useState(false)

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
    offset: 20,
  })
  const outcome = sourceHandleId ?? 'done'
  const isError = outcome === ERROR_OUTCOME
  const showLabel = outcome !== 'done'

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={cn(isError && 'edge-error', traversed && 'edge-active', invalid && 'edge-invalid')}
        interactionWidth={22}
      />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          {showLabel && (
            <span
              className={cn(
                'rounded-full border bg-card px-1.5 py-px text-[10px] font-medium text-muted-foreground shadow-soft',
                isError && 'border-red-300/70 text-red-600 dark:border-red-500/40 dark:text-red-400',
                traversed && 'border-emerald-400/60 text-emerald-600 dark:text-emerald-400',
                selected && 'border-primary text-primary',
              )}
            >
              {outcome}
            </span>
          )}
          {!readOnly && (selected || hover) && (
            <button
              type="button"
              aria-label="Delete edge"
              onClick={() => store.getState().deleteElements([], [id])}
              className="flex size-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-soft transition hover:border-destructive hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const OutcomeEdge = memo(OutcomeEdgeView)
