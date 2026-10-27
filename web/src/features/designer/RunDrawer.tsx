import { ChevronDown, ChevronUp, ExternalLink, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { LiveDuration } from '@/components/LiveDuration'
import { StatusBadge } from '@/components/StatusBadge'
import { ACTIVE_STATUSES } from '@/lib/status'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { ExecutionDetails } from '@/features/runs/ExecutionDetails'
import { RunTimeline } from '@/features/runs/RunTimeline'
import { cn, shortId } from '@/lib/utils'
import { useDesigner, useDesignerApi } from './store'

export function RunDrawer() {
  const store = useDesignerApi()
  const run = useDesigner((s) => s.run)
  const inspectNodeId = useDesigner((s) => s.inspectNodeId)
  const nodes = useDesigner((s) => s.nodes)
  const [open, setOpen] = useState(true)

  if (!run) return null
  const label = (id: string) => nodes.find((n) => n.id === id)?.data.name || id
  const selected = inspectNodeId ? (run.byNode[inspectNodeId] ?? []) : []
  const selectedExecId = selected[selected.length - 1]?.id ?? null

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col border-t bg-card shadow-[0_-8px_24px_-12px_rgb(9_9_11/0.18)] transition-[height] duration-200',
        open ? 'h-[min(320px,40vh)]' : 'h-10',
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronUp className="size-4 text-muted-foreground" />}
          Run
          <span className="font-mono text-xs font-normal text-muted-foreground">{shortId(run.runId)}</span>
        </button>
        <StatusBadge status={run.status} />
        <span className="text-xs text-muted-foreground">
          <LiveDuration
            run={{ status: run.status, startedAt: run.startedAt, createdAt: run.startedAt ?? '', completedAt: run.completedAt, durationMs: null }}
          />
        </span>
        {run.error && <span className="min-w-0 truncate text-xs text-destructive">{run.error}</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/runs/${run.runId}`}>
              <ExternalLink /> Details
            </Link>
          </Button>
          <Tooltip content="Close run overlay">
            <Button variant="ghost" size="icon-sm" aria-label="Close run overlay" onClick={() => store.getState().clearRun()}>
              <X />
            </Button>
          </Tooltip>
        </div>
      </div>
      {open && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-r py-2 scrollbar-thin">
            <RunTimeline
              executions={run.executions}
              nodeLabel={label}
              selectedId={selectedExecId}
              onSelect={(e) => {
                store.getState().setInspectNode(e.nodeId)
                store.getState().selectOnly(e.nodeId)
              }}
              live={ACTIVE_STATUSES.includes(run.status)}
              compact
            />
          </div>
          <div className="min-h-0 overflow-y-auto p-3 scrollbar-thin">
            <ExecutionDetails
              key={inspectNodeId ?? 'none'}
              nodeId={inspectNodeId}
              label={inspectNodeId ? label(inspectNodeId) : undefined}
              executions={selected}
            />
          </div>
        </div>
      )}
    </div>
  )
}
