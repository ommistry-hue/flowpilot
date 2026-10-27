import { useQueryClient } from '@tanstack/react-query'
import {
  Copy,
  Download,
  FileUp,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api, errorMessage } from '@/api/client'
import { qk, useCatalog, useDeleteWorkflow, useWorkflows } from '@/api/hooks'
import type { WorkflowDefinition, WorkflowSummary } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ImportDialog } from '@/components/ImportDialog'
import { EmptyState, ErrorState, Page, PageHeader } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { Tooltip } from '@/components/ui/tooltip'
import { ActivityIcon } from '@/components/ActivityIcon'
import { startRun } from '@/lib/runWorkflow'
import { downloadJson, formatDateTime, relativeTime, slugify } from '@/lib/utils'

export default function WorkflowsPage() {
  const workflows = useWorkflows()
  const catalog = useCatalog()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const del = useDeleteWorkflow()
  const [query, setQuery] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [toDelete, setToDelete] = useState<WorkflowSummary | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...(workflows.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (!q) return list
    return list.filter((w) => w.name.toLowerCase().includes(q) || (w.description ?? '').toLowerCase().includes(q))
  }, [workflows.data, query])

  const create = async (def: WorkflowDefinition, open = true) => {
    const { id: _ignored, ...rest } = def
    void _ignored
    const created = await api.createWorkflow(rest)
    await qc.invalidateQueries({ queryKey: qk.workflows })
    if (open) navigate(`/workflows/${created.id}`)
    return created
  }

  const duplicate = async (w: WorkflowSummary) => {
    try {
      const detail = await api.workflow(w.id)
      await create({ ...detail.definition, name: `${detail.name} (copy)` }, false)
      toast.success('Workflow duplicated')
    } catch (e) {
      toast.error('Duplicate failed', { description: errorMessage(e) })
    }
  }

  const exportJson = async (w: WorkflowSummary) => {
    try {
      const detail = await api.workflow(w.id)
      downloadJson(`${slugify(detail.name)}.json`, detail.definition)
    } catch (e) {
      toast.error('Export failed', { description: errorMessage(e) })
    }
  }

  return (
    <Page>
      <PageHeader
        title="Workflows"
        description="Design, publish and run your automations."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <FileUp /> Import
            </Button>
            <Button onClick={() => navigate('/workflows/new')}>
              <Plus /> New workflow
            </Button>
          </>
        }
      />

      <div className="mb-3 flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workflows"
            className="pl-8"
            aria-label="Search workflows"
          />
        </div>
        {workflows.data && (
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {workflows.data.length}
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        {workflows.isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-8 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : workflows.isError ? (
          <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />
        ) : filtered.length === 0 ? (
          query ? (
            <EmptyState icon={<Search />} title="No matches" description={`Nothing matches “${query}”.`} />
          ) : (
            <EmptyState
              icon={<Workflow />}
              title="No workflows yet"
              description="Create a workflow from scratch, import a JSON definition, or let AI draft one."
              action={
                <>
                  <Button variant="secondary" onClick={() => navigate('/workflows/new?ai=1')}>
                    <Sparkles /> Generate with AI
                  </Button>
                  <Button onClick={() => navigate('/workflows/new')}>
                    <Plus /> New workflow
                  </Button>
                </>
              }
            />
          )
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="hidden w-32 px-3 py-2.5 font-medium md:table-cell">Triggers</th>
                <th className="hidden w-20 px-3 py-2.5 font-medium lg:table-cell">Nodes</th>
                <th className="w-28 px-3 py-2.5 font-medium">Status</th>
                <th className="hidden w-36 px-3 py-2.5 font-medium sm:table-cell">Updated</th>
                <th className="w-24 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((w) => {
                const firstTrigger = w.triggerTypes[0] ?? 'trigger.manual'
                return (
                  <tr
                    key={w.id}
                    className="group cursor-pointer transition-colors hover:bg-accent/50"
                    onClick={() => navigate(`/workflows/${w.id}`)}
                  >
                    <td className="max-w-0 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ActivityIcon type={firstTrigger} descriptor={catalog.byType.get(firstTrigger)} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{w.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{w.description || 'No description'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      <div className="flex -space-x-1">
                        {w.triggerTypes.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                        {w.triggerTypes.map((t) => (
                          <Tooltip key={t} content={catalog.byType.get(t)?.displayName ?? t}>
                            <span className="rounded-md ring-2 ring-card">
                              <ActivityIcon type={t} descriptor={catalog.byType.get(t)} size="sm" />
                            </span>
                          </Tooltip>
                        ))}
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 text-muted-foreground tabular-nums lg:table-cell">{w.nodeCount}</td>
                    <td className="px-3 py-3">
                      {w.publishedVersion ? (
                        <Badge variant="success">
                          <span className="size-1.5 rounded-full bg-emerald-500" />v{w.publishedVersion}
                        </Badge>
                      ) : (
                        <Badge variant="muted">Draft</Badge>
                      )}
                    </td>
                    <td className="hidden px-3 py-3 text-xs text-muted-foreground sm:table-cell">
                      <Tooltip content={formatDateTime(w.updatedAt)}>
                        <span>{relativeTime(w.updatedAt)}</span>
                      </Tooltip>
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Tooltip content="Run now">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Run ${w.name}`}
                            className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                            onClick={() => void startRun(w.id, { navigate })}
                          >
                            <Play />
                          </Button>
                        </Tooltip>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="More actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => navigate(`/workflows/${w.id}`)}>
                              <Pencil /> Open in designer
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void startRun(w.id, { navigate })}>
                              <Play /> Run
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void duplicate(w)}>
                              <Copy /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void exportJson(w)}>
                              <Download /> Export JSON
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive onSelect={() => setToDelete(w)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        pending={importing}
        onImport={async (def) => {
          setImporting(true)
          try {
            await create(def)
            setImportOpen(false)
            toast.success('Workflow imported')
          } catch (e) {
            toast.error('Import failed', { description: errorMessage(e) })
          } finally {
            setImporting(false)
          }
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        destructive
        title={`Delete “${toDelete?.name}”?`}
        description="The workflow and its published versions will be removed. Past runs may no longer resolve."
        confirmLabel="Delete workflow"
        pending={del.isPending}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.id, {
            onSuccess: () => {
              toast.success('Workflow deleted')
              setToDelete(null)
            },
          })
        }
      />
    </Page>
  )
}
