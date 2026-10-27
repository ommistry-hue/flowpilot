import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Monitor, Moon, Search, Sun } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { qk } from '@/api/hooks'
import { useHubEvent, useHubReconnected } from '@/api/realtime'
import type { Paged, RunSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/misc'
import { Tooltip } from '@/components/ui/tooltip'
import { useTheme } from '@/lib/theme'
import { useUi } from '@/lib/uiStore'
import { cn, modKey } from '@/lib/utils'
import { GITHUB_URL, GitHubIcon } from './Brand'
import { CommandPalette } from './CommandPalette'
import { ConnectionBanner } from './ConnectionBanner'
import { Sidebar } from './Sidebar'
import { TopbarSlotContext } from './topbarContext'

const TITLES: [RegExp, string, string?][] = [
  [/^\/$/, 'Dashboard'],
  [/^\/workflows\/?$/, 'Workflows'],
  [/^\/workflows\/.+/, 'Workflows', 'Designer'],
  [/^\/runs\/?$/, 'Runs'],
  [/^\/runs\/.+/, 'Runs', 'Run detail'],
  [/^\/approvals/, 'Approvals'],
  [/^\/settings/, 'Settings'],
]

function useRealtimeSync() {
  const qc = useQueryClient()
  const statsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useHubEvent('runUpdated', (run) => {
    let found = false
    qc.setQueriesData<Paged<RunSummary>>({ queryKey: ['runs', 'list'] }, (old) => {
      if (!old) return old
      const idx = old.items.findIndex((r) => r.id === run.id)
      if (idx === -1) return old
      found = true
      const items = old.items.slice()
      items[idx] = { ...items[idx], ...run }
      return { ...old, items }
    })
    if (!found) void qc.invalidateQueries({ queryKey: ['runs', 'list'] })
    clearTimeout(statsTimer.current)
    statsTimer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: qk.stats }), 800)
  })

  useHubEvent('approvalsChanged', () => {
    void qc.invalidateQueries({ queryKey: qk.approvalsAll })
    void qc.invalidateQueries({ queryKey: qk.stats })
  })

  // Events sent while the realtime connection was down are lost: catch up on everything they feed.
  useHubReconnected(() => {
    void qc.invalidateQueries({ queryKey: qk.runsAll })
    void qc.invalidateQueries({ queryKey: qk.approvalsAll })
    void qc.invalidateQueries({ queryKey: qk.stats })
  })
}

export function AppShell() {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const { pathname } = useLocation()
  const { pref, setTheme, resolved } = useTheme()
  const openPalette = useUi((s) => s.setPaletteOpen)
  useRealtimeSync()

  const match = TITLES.find(([re]) => re.test(pathname))
  const compactSearch = /^\/(workflows|runs)\/[^/]+/.test(pathname)
  const ThemeIcon = pref === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
          <div ref={setSlot} className="peer flex min-w-0 flex-1 items-center gap-2 empty:hidden" />
          <div className="hidden min-w-0 flex-1 items-center gap-1.5 text-sm peer-empty:flex">
            {match?.[2] ? (
              <>
                <Link to={pathname.startsWith('/runs') ? '/runs' : '/workflows'} className="text-muted-foreground hover:text-foreground">
                  {match[1]}
                </Link>
                <ChevronRight className="size-3.5 text-muted-foreground/60" />
                <span className="font-medium">{match[2]}</span>
              </>
            ) : (
              <span className="font-medium">{match?.[1] ?? 'FlowPilot'}</span>
            )}
          </div>

          <button
            type="button"
            onClick={() => openPalette(true)}
            className={cn(compactSearch ? 'hidden' : 'hidden lg:flex', 'h-8 w-56 items-center gap-2 rounded-md border bg-card px-2.5 text-sm text-muted-foreground shadow-soft outline-none transition hover:border-input hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60')}
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-left text-[13px]">Search…</span>
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </button>
          <Tooltip content={`Search (${modKey}+K)`}>
            <Button variant="ghost" size="icon" className={compactSearch ? undefined : 'lg:hidden'} aria-label="Search" onClick={() => openPalette(true)}>
              <Search />
            </Button>
          </Tooltip>

          <DropdownMenu>
            <Tooltip content="Theme">
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Theme">
                  <ThemeIcon />
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem onSelect={() => setTheme('light')}>
                <Sun /> Light
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme('dark')}>
                <Moon /> Dark
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme('system')}>
                <Monitor /> System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip content="GitHub">
            <Button variant="ghost" size="icon" asChild>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub repository">
                <GitHubIcon className="size-4" />
              </a>
            </Button>
          </Tooltip>
        </header>
        <main className="relative min-h-0 flex-1">
          <ConnectionBanner />
          <TopbarSlotContext.Provider value={slot}>
            <Outlet />
          </TopbarSlotContext.Provider>
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}
