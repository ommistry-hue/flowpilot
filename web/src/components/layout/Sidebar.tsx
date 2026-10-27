import { Activity, Inbox, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Settings, Workflow, type LucideIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import { useApprovals } from '@/api/hooks'
import { useHubStatus } from '@/api/realtime'
import { Tooltip } from '@/components/ui/tooltip'
import { useUi } from '@/lib/uiStore'
import { cn } from '@/lib/utils'
import { APP_VERSION, LogoMark } from './Brand'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  badge?: number
  end?: boolean
}

export function Sidebar() {
  const { pathname } = useLocation()
  const focusMode = /^\/workflows\/[^/]+/.test(pathname)
  const collapsed = useUi((s) => s.sidebarCollapsed) || focusMode
  const toggle = useUi((s) => s.toggleSidebar)
  const pending = useApprovals('pending').data?.length ?? 0
  const hub = useHubStatus()

  const items: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/workflows', label: 'Workflows', icon: Workflow },
    { to: '/runs', label: 'Runs', icon: Activity },
    { to: '/approvals', label: 'Approvals', icon: Inbox, badge: pending },
  ]

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 ease-out',
        collapsed ? 'w-[56px]' : 'w-[232px]',
      )}
    >
      <div className={cn('flex h-12 items-center gap-2.5 border-b px-3.5', collapsed && 'justify-center px-0')}>
        <LogoMark className="size-6.5" />
        {!collapsed && (
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-[15px] font-semibold tracking-tight">FlowPilot</span>
            <span className="rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">v{APP_VERSION}</span>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Main">
        {items.map((item) => (
          <SidebarLink key={item.to} item={item} collapsed={collapsed} />
        ))}
        <div className="my-2 h-px bg-border" />
        <SidebarLink item={{ to: '/settings', label: 'Settings', icon: Settings }} collapsed={collapsed} />
      </nav>

      <div className={cn('flex flex-col gap-1 border-t p-2', collapsed && 'items-center')}>
        <Tooltip content={collapsed ? `Realtime: ${hub}` : null} side="right">
          <div
            className={cn(
              'flex h-8 items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                hub === 'connected' ? 'bg-emerald-500' : hub === 'connecting' ? 'animate-pulse bg-amber-500' : 'bg-zinc-400',
              )}
            />
            {!collapsed && (hub === 'connected' ? 'Live updates on' : hub === 'connecting' ? 'Connecting…' : 'Offline')}
          </div>
        </Tooltip>
        {!focusMode && (
          <Tooltip content={collapsed ? 'Expand sidebar' : null} side="right">
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn(
                'flex h-8 items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
                collapsed && 'w-8 justify-center px-0',
              )}
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              {!collapsed && 'Collapse'}
            </button>
          </Tooltip>
        )}
      </div>
    </aside>
  )
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon
  return (
    <Tooltip content={collapsed ? item.label : null} side="right">
      <NavLink
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          cn(
            'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
            isActive && 'bg-card text-foreground shadow-soft ring-1 ring-border hover:bg-card',
            collapsed && 'w-8 justify-center px-0',
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon className={cn('size-4 shrink-0', isActive && 'text-primary')} />
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            {!!item.badge &&
              (collapsed ? (
                <span className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
              ) : (
                <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ))}
          </>
        )}
      </NavLink>
    </Tooltip>
  )
}
