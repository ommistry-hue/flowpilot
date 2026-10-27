import { Panel, useReactFlow } from '@xyflow/react'
import { Check, CircleAlert, MousePointer2, Sparkles, X } from 'lucide-react'
import { useCatalog } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { ActivityIcon } from '@/components/ActivityIcon'
import { NODE_WIDTH } from './model'
import { useDesigner, useDesignerApi } from './store'

export function ValidationPanel() {
  const store = useDesignerApi()
  const validation = useDesigner((s) => s.validation)
  const ghost = useDesigner((s) => s.ghost)
  const rf = useReactFlow()
  if (!validation || ghost || validation.list.length === 0) return null

  return (
    <Panel position="top-left" className="!m-3 w-80 animate-slide-up">
      <div className="overflow-hidden rounded-xl border border-destructive/30 bg-card shadow-elevated">
        <div className="flex items-center gap-2 border-b bg-destructive/8 px-3 py-2">
          <CircleAlert className="size-4 text-destructive" />
          <p className="flex-1 text-sm font-semibold">
            {validation.list.length} problem{validation.list.length === 1 ? '' : 's'}
          </p>
          {validation.source === 'local' && <span className="text-[10px] text-muted-foreground">local check</span>}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => store.getState().setValidation(null)}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <ul className="max-h-64 overflow-y-auto p-1 scrollbar-thin">
          {validation.list.map((e, i) => (
            <li key={i}>
              <button
                type="button"
                disabled={!e.nodeId}
                onClick={() => {
                  if (!e.nodeId) return
                  store.getState().selectOnly(e.nodeId)
                  void rf.fitView({ nodes: [{ id: e.nodeId }], duration: 300, maxZoom: 1.2, padding: 0.8 })
                }}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none enabled:hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-destructive" />
                <span className="min-w-0 flex-1">
                  {e.nodeId && <span className="mr-1 font-mono font-medium text-foreground">{e.nodeId}</span>}
                  <span className="text-muted-foreground">{e.message}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

export function GhostBanner() {
  const store = useDesignerApi()
  const ghost = useDesigner((s) => s.ghost)
  if (!ghost) return null
  return (
    <Panel position="top-center" className="!mt-3 animate-slide-up">
      <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-card py-2 pr-2 pl-3 shadow-elevated">
        <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
          <Sparkles className="size-3.5" />
        </span>
        <div className="min-w-[300px] text-sm">
          <p className="font-semibold">AI draft preview</p>
          <p className="text-xs text-muted-foreground">
            {ghost.nodes.length} nodes · {ghost.edges.length} connections. Accepting replaces the canvas (undo with Ctrl+Z).
          </p>
        </div>
        <div className="ml-2 flex gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => store.getState().discardGhost()}>
            <X /> Discard
          </Button>
          <Button size="sm" onClick={() => store.getState().acceptGhost()}>
            <Check /> Accept
          </Button>
        </div>
      </div>
    </Panel>
  )
}

export function EmptyCanvasHint({ onAi }: { onAi: () => void }) {
  const store = useDesignerApi()
  const empty = useDesigner((s) => s.nodes.length === 0 && !s.ghost)
  const catalog = useCatalog()
  const rf = useReactFlow()
  if (!empty) return null
  const triggers = catalog.list.filter((a) => a.isTrigger).slice(0, 4)
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
      <div className="pointer-events-auto w-[420px] rounded-2xl border bg-card/95 p-6 text-center shadow-elevated backdrop-blur animate-slide-up">
        <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <MousePointer2 className="size-5" />
        </span>
        <h3 className="mt-3 font-semibold tracking-tight">Start with a trigger</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">Drag an activity from the left, or pick a trigger to begin.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {triggers.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => {
                const p = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
                store.getState().addNode(t, { x: Math.round(p.x - NODE_WIDTH / 2), y: Math.round(p.y - 40) })
              }}
              className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-left text-xs font-medium outline-none transition hover:border-primary/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <ActivityIcon type={t.type} descriptor={t} size="sm" />
              {t.displayName}
            </button>
          ))}
        </div>
        <Button variant="link" size="sm" className="mt-3" onClick={onAi}>
          <Sparkles /> Or describe it and let AI build it
        </Button>
      </div>
    </div>
  )
}
