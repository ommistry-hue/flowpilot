import {
  Braces,
  ChevronLeft,
  CircleCheckBig,
  Loader2,
  Play,
  Redo2,
  Rocket,
  Save,
  Sparkles,
  Undo2,
} from 'lucide-react'
import { Link } from 'react-router'
import { TopbarPortal } from '@/components/layout/TopbarSlot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { cn, modKey } from '@/lib/utils'
import { useDesigner, useDesignerApi } from './store'

export interface ToolbarBusy {
  saving: boolean
  validating: boolean
  publishing: boolean
}

export function DesignerToolbar({
  busy,
  onSave,
  onValidate,
  onPublish,
  onRun,
  onAi,
  onJson,
}: {
  busy: ToolbarBusy
  onSave: () => void
  onValidate: () => void
  onPublish: () => void
  onRun: () => void
  onAi: () => void
  onJson: () => void
}) {
  const store = useDesignerApi()
  const name = useDesigner((s) => s.meta.name)
  const dirty = useDesigner((s) => s.dirty)
  const isNew = useDesigner((s) => !s.workflowId)
  const version = useDesigner((s) => s.publishedVersion)
  const canUndo = useDesigner((s) => s.past.length > 0)
  const canRedo = useDesigner((s) => s.future.length > 0)
  const ghost = useDesigner((s) => !!s.ghost)
  const running = useDesigner((s) => s.run && ['Pending', 'Running'].includes(s.run.status))

  return (
    <TopbarPortal>
      <Tooltip content="All workflows">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/workflows" aria-label="Back to workflows">
            <ChevronLeft />
          </Link>
        </Button>
      </Tooltip>
      <input
        value={name}
        onChange={(e) => store.getState().setMeta({ name: e.target.value }, 'name')}
        aria-label="Workflow name"
        spellCheck={false}
        style={{ width: `calc(${Math.min(Math.max(name.length, 8), 40)}ch + 20px)` }}
        className="h-8 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold tracking-tight outline-none transition hover:border-border focus:border-ring focus:bg-card focus:ring-3 focus:ring-ring/20"
      />
      <div className="hidden items-center gap-2 md:flex">
        {version ? (
          <Badge variant="success">
            <span className="size-1.5 rounded-full bg-emerald-500" />v{version}
          </Badge>
        ) : (
          <Badge variant="muted">{isNew ? 'New' : 'Draft'}</Badge>
        )}
        <span className={cn('inline-flex items-center gap-1.5 text-xs', dirty ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
          <span className={cn('size-1.5 rounded-full', dirty ? 'bg-amber-500' : 'bg-muted-foreground/40')} />
          {dirty ? 'Unsaved' : 'Saved'}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip content={`Undo (${modKey}+Z)`}>
          <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!canUndo || ghost} onClick={() => store.getState().undo()}>
            <Undo2 />
          </Button>
        </Tooltip>
        <Tooltip content={`Redo (${modKey}+Shift+Z)`}>
          <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!canRedo || ghost} onClick={() => store.getState().redo()}>
            <Redo2 />
          </Button>
        </Tooltip>
        <div className="mx-1 h-5 w-px bg-border" />
        <Tooltip content="View / edit JSON">
          <Button variant="ghost" size="sm" onClick={onJson} disabled={ghost} aria-label="JSON">
            <Braces /> <span className="hidden xl:inline">JSON</span>
          </Button>
        </Tooltip>
        <Button variant="ghost" size="sm" onClick={onValidate} disabled={busy.validating || ghost}>
          {busy.validating ? <Loader2 className="animate-spin" /> : <CircleCheckBig />}
          <span className="hidden lg:inline">Validate</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onAi}
          disabled={ghost}
          className="text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
        >
          <Sparkles /> <span className="hidden lg:inline">AI Generate</span>
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Tooltip content={`Save (${modKey}+S)`}>
          <Button variant="secondary" size="sm" onClick={onSave} disabled={busy.saving || ghost || (!dirty && !isNew)}>
            {busy.saving ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
        </Tooltip>
        <Tooltip content={version ? `Publish a new version (current v${version})` : 'Publish version 1'}>
          <Button variant="secondary" size="sm" onClick={onPublish} disabled={busy.publishing || ghost}>
            {busy.publishing ? <Loader2 className="animate-spin" /> : <Rocket />}
            <span className="hidden sm:inline">Publish</span>
          </Button>
        </Tooltip>
        <Button size="sm" onClick={onRun} disabled={ghost || !!running}>
          {running ? <Loader2 className="animate-spin" /> : <Play />} Run
        </Button>
      </div>
    </TopbarPortal>
  )
}
