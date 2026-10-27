import { useReactFlow } from '@xyflow/react'
import { ChevronDown, CloudOff, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useCatalog } from '@/api/hooks'
import type { ActivityDescriptor } from '@/api/types'
import { Tooltip } from '@/components/ui/tooltip'
import { ActivityIcon } from '@/components/ActivityIcon'
import { categoryRank, categoryTone } from '@/lib/activityMeta'
import { useUi } from '@/lib/uiStore'
import { cn } from '@/lib/utils'
import { ACTIVITY_DND_TYPE } from './Canvas'
import { NODE_WIDTH } from './model'
import { useDesignerApi } from './store'

export function Palette() {
  const catalog = useCatalog()
  const store = useDesignerApi()
  const rf = useReactFlow()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const panelCollapsed = useUi((s) => s.activitiesCollapsed)
  const togglePanel = useUi((s) => s.toggleActivities)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = catalog.list.filter(
      (a) =>
        !q ||
        a.displayName.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q),
    )
    const map = new Map<string, ActivityDescriptor[]>()
    for (const a of list) {
      const cat = a.isTrigger && !/trigger/i.test(a.category) ? 'Triggers' : a.category || 'General'
      ;(map.get(cat) ?? map.set(cat, []).get(cat)!).push(a)
    }
    return [...map.entries()].sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0]))
  }, [catalog.list, query])

  const addAtCenter = (a: ActivityDescriptor) => {
    const el = document.querySelector('.react-flow')
    const rect = el?.getBoundingClientRect()
    const center = rect
      ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }
    const nodes = store.getState().nodes
    const pos = { x: Math.round(center.x - NODE_WIDTH / 2), y: Math.round(center.y - 40) }
    const overlaps = () =>
      nodes.some((n) => {
        const w = n.measured?.width ?? NODE_WIDTH
        const h = n.measured?.height ?? 100
        return pos.x < n.position.x + w + 24 && pos.x + NODE_WIDTH + 24 > n.position.x && pos.y < n.position.y + h + 24 && pos.y + 100 > n.position.y
      })
    for (let i = 0; i < 12 && overlaps(); i++) pos.y += 64
    store.getState().addNode(a, pos)
  }

  if (panelCollapsed) {
    return (
      <aside className="flex h-full w-11 shrink-0 flex-col items-center border-r bg-sidebar py-3" aria-label="Activities (collapsed)">
        <Tooltip content="Show activities" side="right">
          <button
            type="button"
            onClick={togglePanel}
            aria-label="Show activities"
            className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </Tooltip>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r bg-sidebar">
      <div className="flex items-center gap-1.5 border-b p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search activities"
            aria-label="Search activities"
            className="h-8 w-full rounded-md border border-input bg-card pr-7 pl-8 text-[13px] shadow-soft outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Tooltip content="Hide activities" side="bottom">
          <button
            type="button"
            onClick={togglePanel}
            aria-label="Hide activities"
            className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 scrollbar-thin">
        {groups.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">No activities match “{query}”.</p>}
        {groups.map(([category, items]) => {
          const isCollapsed = collapsed[category] && !query
          const tone = categoryTone(category)
          return (
            <div key={category} className="mb-1.5">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [category]: !c[category] }))}
                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                aria-expanded={!isCollapsed}
              >
                <span className={cn('size-1.5 rounded-full', tone.dot)} />
                <span className="flex-1 text-left">{category}</span>
                <span className="font-normal tabular-nums">{items.length}</span>
                <ChevronDown className={cn('size-3.5 transition-transform', isCollapsed && '-rotate-90')} />
              </button>
              {!isCollapsed && (
                <div className="mt-0.5 space-y-0.5">
                  {items.map((a) => (
                    <Tooltip key={a.type} content={a.description} side="right" delay={600}>
                      <div
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(ACTIVITY_DND_TYPE, a.type)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        onDoubleClick={() => addAtCenter(a)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            addAtCenter(a)
                          }
                        }}
                        className="group flex cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 outline-none select-none hover:border-border hover:bg-card hover:shadow-soft focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing"
                      >
                        <ActivityIcon type={a.type} descriptor={a} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{a.displayName}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">{a.type}</p>
                        </div>
                      </div>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="border-t px-3 py-2.5 text-[11px] leading-snug text-muted-foreground">
        {catalog.offline ? (
          <span className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
            <CloudOff className="mt-px size-3.5 shrink-0" /> Server unreachable. Showing the built-in catalog.
          </span>
        ) : (
          'Drag onto the canvas, or double-click to add.'
        )}
      </div>
    </aside>
  )
}
