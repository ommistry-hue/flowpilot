import { Dialog as D } from 'radix-ui'
import {
  Activity,
  CornerDownLeft,
  Inbox,
  LayoutDashboard,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkflows } from '@/api/hooks'
import { Kbd } from '@/components/ui/misc'
import { useTheme } from '@/lib/theme'
import { useUi } from '@/lib/uiStore'
import { cn } from '@/lib/utils'

interface Command {
  id: string
  group: string
  label: string
  hint?: string
  icon: LucideIcon
  run: () => void
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPaletteOpen)
  const navigate = useNavigate()
  const { resolved, toggle } = useTheme()
  const workflows = useWorkflows()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useUi.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to)
    const base: Command[] = [
      { id: 'new', group: 'Actions', label: 'Create workflow', icon: Plus, run: go('/workflows/new') },
      {
        id: 'theme',
        group: 'Actions',
        label: resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: resolved === 'dark' ? Sun : Moon,
        run: toggle,
      },
      { id: 'nav-dash', group: 'Navigate', label: 'Dashboard', icon: LayoutDashboard, run: go('/') },
      { id: 'nav-wf', group: 'Navigate', label: 'Workflows', icon: Workflow, run: go('/workflows') },
      { id: 'nav-runs', group: 'Navigate', label: 'Runs', icon: Activity, run: go('/runs') },
      { id: 'nav-appr', group: 'Navigate', label: 'Approvals', icon: Inbox, run: go('/approvals') },
      { id: 'nav-set', group: 'Navigate', label: 'Settings', icon: Settings, run: go('/settings') },
    ]
    const wf: Command[] = (workflows.data ?? []).map((w) => ({
      id: `wf-${w.id}`,
      group: 'Workflows',
      label: w.name,
      hint: w.publishedVersion ? `v${w.publishedVersion}` : 'Draft',
      icon: Workflow,
      run: go(`/workflows/${w.id}`),
    }))
    return [...base, ...wf]
  }, [navigate, resolved, toggle, workflows.data])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      const wf = commands.filter((c) => c.group === 'Workflows').slice(0, 8)
      return [...commands.filter((c) => c.group !== 'Workflows'), ...wf]
    }
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const runCommand = (c: Command | undefined) => {
    if (!c) return
    setOpen(false)
    setQuery('')
    c.run()
  }

  let lastGroup = ''
  return (
    <D.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        setQuery('')
        setActive(0)
      }}
    >
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[95] animate-fade-in bg-black/30 backdrop-blur-[2px]" />
        <D.Content
          className="fixed top-[14vh] left-1/2 z-[95] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 animate-slide-up overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-elevated outline-none"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(filtered.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              runCommand(filtered[active])
            }
          }}
        >
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search pages, actions and workflows</D.Description>
          <div className="flex h-12 items-center gap-2.5 border-b px-4">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              placeholder="Search workflows, pages, actions…"
              className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Search commands"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5 scrollbar-thin" role="listbox">
            {filtered.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No results</p>}
            {filtered.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null
              lastGroup = c.group
              const Icon = c.icon
              return (
                <div key={c.id}>
                  {header && (
                    <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{header}</p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => runCommand(c)}
                    className={cn(
                      'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none',
                      i === active && 'bg-accent',
                    )}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{c.label}</span>
                    {c.hint && <span className="text-xs text-muted-foreground">{c.hint}</span>}
                    {i === active && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                  </button>
                </div>
              )
            })}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
