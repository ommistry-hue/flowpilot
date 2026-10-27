import { ArrowRight, CircleAlert, Copy, Keyboard, MousePointerClick, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCatalog } from '@/api/hooks'
import type { Json, JsonObject } from '@/api/types'
import { CodeEditor } from '@/components/code/CodeEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
import { Kbd, Switch } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { ActivityIcon } from '@/components/ActivityIcon'
import { modKey } from '@/lib/utils'
import { CasesEditor, FieldRow, InputField } from './fields'
import { DEFAULT_RETRY, hasDynamicOutcomes, readCases, type FlowNode } from './model'
import { useDesigner, useDesignerApi } from './store'

export function Inspector() {
  const selectedNodes = useDesigner(useShallow((s) => s.nodes.filter((n) => n.selected)))
  const selectedEdges = useDesigner(useShallow((s) => s.edges.filter((e) => e.selected)))
  const ghost = useDesigner((s) => s.ghost)

  let body
  if (ghost) body = <GhostInfo />
  else if (selectedNodes.length === 1) body = <NodeInspector key={selectedNodes[0].id} node={selectedNodes[0]} />
  else if (selectedNodes.length > 1) body = <MultiSelection count={selectedNodes.length} ids={selectedNodes.map((n) => n.id)} />
  else if (selectedEdges.length === 1) body = <EdgeInspector id={selectedEdges[0].id} />
  else body = <WorkflowInspector />

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l bg-sidebar">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{body}</div>
    </aside>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>
}

function GhostInfo() {
  const ghost = useDesigner((s) => s.ghost)!
  return (
    <div className="p-4">
      <SectionTitle>AI draft</SectionTitle>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{ghost.explanation || 'No explanation was provided.'}</p>
      <div className="mt-4 flex gap-2 text-xs text-muted-foreground">
        <Badge variant="muted">{ghost.nodes.length} nodes</Badge>
        <Badge variant="muted">{ghost.edges.length} edges</Badge>
      </div>
    </div>
  )
}

function NodeInspector({ node }: { node: FlowNode }) {
  const store = useDesignerApi()
  const catalog = useCatalog()
  const readOnly = useDesigner((s) => s.readOnly)
  const errors = useDesigner((s) => s.validation?.byNode[node.id])
  const descriptor = catalog.byType.get(node.data.activityType)
  const { config } = node.data
  const update = store.getState().updateNodeData

  const setConfig = (key: string, value: Json | undefined) => {
    const next: JsonObject = { ...store.getState().nodes.find((n) => n.id === node.id)!.data.config }
    if (value === undefined) delete next[key]
    else next[key] = value
    update(node.id, { config: next }, `cfg:${key}`)
  }

  const inputs = descriptor?.inputs ?? []
  const hasCases = hasDynamicOutcomes(node.data.activityType, descriptor)
  const known = new Set(inputs.map((i) => i.name))
  const extraKeys = Object.keys(config).filter((k) => !known.has(k) && !(hasCases && k === 'cases'))

  return (
    <div className={readOnly ? 'pointer-events-none opacity-90' : undefined}>
      <div className="border-b p-4">
        <div className="flex items-start gap-3">
          <ActivityIcon type={node.data.activityType} descriptor={descriptor} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{descriptor?.displayName ?? node.data.activityType}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{node.data.activityType}</p>
          </div>
          {!readOnly && (
            <div className="flex gap-0.5">
              <Tooltip content={`Duplicate (${modKey}+D)`}>
                <Button variant="ghost" size="icon-sm" aria-label="Duplicate node" onClick={() => store.getState().duplicateSelection()}>
                  <Copy />
                </Button>
              </Tooltip>
              <Tooltip content="Delete (Del)">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete node"
                  className="hover:text-destructive"
                  onClick={() => store.getState().deleteElements([node.id], [])}
                >
                  <Trash2 />
                </Button>
              </Tooltip>
            </div>
          )}
        </div>
        {descriptor?.description && <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{descriptor.description}</p>}
        {!descriptor && (
          <p className="mt-2.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            Unknown activity type. Its config is preserved as-is.
          </p>
        )}
        {errors && (
          <div className="mt-3 space-y-1 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2">
            {errors.map((e, i) => (
              <p key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                <CircleAlert className="mt-px size-3.5 shrink-0" /> {e}
              </p>
            ))}
          </div>
        )}
      </div>

      <Tabs defaultValue="params" className="p-4">
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="params" className="flex-1">
            Parameters
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex-1">
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="params" className="space-y-4">
          <FieldRow label="Display name" htmlFor={`name-${node.id}`}>
            <Input
              id={`name-${node.id}`}
              value={node.data.name ?? ''}
              placeholder={descriptor?.displayName ?? node.data.activityType}
              onChange={(e) => update(node.id, { name: e.target.value || null }, 'name')}
            />
          </FieldRow>

          {hasCases && (
            <CasesEditor
              cases={readCases(config)}
              onChange={(cases, change) => store.getState().setCases(node.id, cases, change)}
            />
          )}

          {inputs
            .filter((i) => !(hasCases && i.name === 'cases'))
            .map((input) => (
              <InputField
                key={input.name}
                nodeId={node.id}
                input={input}
                value={config[input.name]}
                onChange={(v) => setConfig(input.name, v)}
              />
            ))}

          {inputs.length === 0 && !hasCases && (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              This activity has no parameters.
            </p>
          )}

          {extraKeys.length > 0 && (
            <FieldRow label="Other config" description="Keys not described by the activity. Preserved on save.">
              <CodeEditor
                language="json"
                readOnly
                value={JSON.stringify(Object.fromEntries(extraKeys.map((k) => [k, config[k]])), null, 2)}
                minHeight={48}
                maxHeight={200}
              />
            </FieldRow>
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-5">
          <NodeIdField node={node} />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor={`retry-${node.id}`}>Retry on failure</Label>
                <p className="text-[11px] text-muted-foreground">Exponential backoff between attempts.</p>
              </div>
              <Switch
                id={`retry-${node.id}`}
                checked={!!node.data.retry}
                onCheckedChange={(v) => update(node.id, { retry: v ? { ...DEFAULT_RETRY } : null })}
              />
            </div>
            {node.data.retry && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3">
                {(
                  [
                    ['maxAttempts', 'Max attempts'],
                    ['initialDelayMs', 'Initial delay (ms)'],
                    ['backoffMultiplier', 'Multiplier'],
                    ['maxDelayMs', 'Max delay (ms)'],
                  ] as const
                ).map(([key, label]) => (
                  <FieldRow key={key} label={label} htmlFor={`${key}-${node.id}`}>
                    <Input
                      id={`${key}-${node.id}`}
                      type="number"
                      min={key === 'maxAttempts' ? 1 : 0}
                      step={key === 'backoffMultiplier' ? 0.5 : 1}
                      value={node.data.retry![key]}
                      onChange={(e) =>
                        update(node.id, { retry: { ...node.data.retry!, [key]: Number(e.target.value) || 0 } }, `retry:${key}`)
                      }
                      className="h-7 font-mono text-xs"
                    />
                  </FieldRow>
                ))}
              </div>
            )}
          </div>

          <FieldRow label="Timeout (ms)" htmlFor={`timeout-${node.id}`} description="Fail the attempt if it runs longer than this.">
            <Input
              id={`timeout-${node.id}`}
              type="number"
              min={0}
              placeholder="No timeout"
              value={node.data.timeoutMs ?? ''}
              onChange={(e) => update(node.id, { timeoutMs: e.target.value ? Number(e.target.value) : null }, 'timeout')}
              className="font-mono text-[13px]"
            />
          </FieldRow>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function NodeIdField({ node }: { node: FlowNode }) {
  const store = useDesignerApi()
  const [draft, setDraft] = useState(node.id)
  const [error, setError] = useState<string | null>(null)
  const commit = () => {
    const v = draft.trim()
    if (v === node.id) return setError(null)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return setError('Use letters, digits and underscores; start with a letter.')
    if (!store.getState().renameNode(node.id, v)) return setError('Another node already uses this ID.')
    setError(null)
  }
  return (
    <FieldRow
      label="Node ID"
      htmlFor={`id-${node.id}`}
      description="Referenced in expressions as nodes.<id>.output"
      error={error}
    >
      <Input
        id={`id-${node.id}`}
        value={draft}
        aria-invalid={!!error || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="font-mono text-[13px]"
      />
    </FieldRow>
  )
}

function EdgeInspector({ id }: { id: string }) {
  const store = useDesignerApi()
  const edge = useDesigner((s) => s.edges.find((e) => e.id === id))
  const nodes = useDesigner((s) => s.nodes)
  const readOnly = useDesigner((s) => s.readOnly)
  if (!edge) return null
  const label = (nid: string) => {
    const n = nodes.find((x) => x.id === nid)
    return n?.data.name || nid
  }
  return (
    <div className="p-4">
      <SectionTitle>Connection</SectionTitle>
      <div className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm">
        <span className="truncate font-medium">{label(edge.source)}</span>
        <Badge variant={edge.sourceHandle === 'error' ? 'danger' : 'default'}>{edge.sourceHandle ?? 'done'}</Badge>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{label(edge.target)}</span>
      </div>
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">id: {edge.id}</p>
      {!readOnly && (
        <Button variant="secondary" size="sm" className="mt-4 hover:text-destructive" onClick={() => store.getState().deleteElements([], [id])}>
          <Trash2 /> Delete connection
        </Button>
      )}
    </div>
  )
}

function MultiSelection({ count, ids }: { count: number; ids: string[] }) {
  const store = useDesignerApi()
  const readOnly = useDesigner((s) => s.readOnly)
  return (
    <div className="p-4">
      <SectionTitle>Selection</SectionTitle>
      <p className="text-sm">{count} nodes selected</p>
      {!readOnly && (
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => store.getState().duplicateSelection()}>
            <Copy /> Duplicate
          </Button>
          <Button variant="secondary" size="sm" className="hover:text-destructive" onClick={() => store.getState().deleteElements(ids, [])}>
            <Trash2 /> Delete
          </Button>
        </div>
      )}
    </div>
  )
}

function WorkflowInspector() {
  const store = useDesignerApi()
  const meta = useDesigner((s) => s.meta)
  const nodeCount = useDesigner((s) => s.nodes.length)
  const edgeCount = useDesigner((s) => s.edges.length)
  const readOnly = useDesigner((s) => s.readOnly)
  const [varsText, setVarsText] = useState(() => JSON.stringify(meta.variables ?? {}, null, 2))
  const [varsError, setVarsError] = useState<string | null>(null)

  return (
    <div className={readOnly ? 'pointer-events-none' : undefined}>
      <div className="space-y-4 border-b p-4">
        <SectionTitle>Workflow</SectionTitle>
        <FieldRow label="Name" htmlFor="wf-name">
          <Input id="wf-name" value={meta.name} onChange={(e) => store.getState().setMeta({ name: e.target.value }, 'name')} />
        </FieldRow>
        <FieldRow label="Description" htmlFor="wf-desc">
          <Textarea
            id="wf-desc"
            rows={3}
            value={meta.description}
            placeholder="What does this workflow do?"
            onChange={(e) => store.getState().setMeta({ description: e.target.value }, 'desc')}
          />
        </FieldRow>
        <FieldRow label="Variables" description="Initial run variables, available as vars.<name>" error={varsError}>
          <CodeEditor
            language="json"
            value={varsText}
            invalid={!!varsError}
            minHeight={64}
            maxHeight={240}
            onChange={(t) => {
              setVarsText(t)
              try {
                const parsed = t.trim() ? (JSON.parse(t) as Json) : {}
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Variables must be a JSON object')
                setVarsError(null)
                store.getState().setMeta({ variables: parsed as JsonObject }, 'vars')
              } catch (e) {
                setVarsError((e as Error).message)
              }
            }}
          />
        </FieldRow>
        <div className="flex gap-2">
          <Badge variant="muted">{nodeCount} nodes</Badge>
          <Badge variant="muted">{edgeCount} connections</Badge>
        </div>
      </div>
      <div className="p-4">
        <SectionTitle>
          <span className="inline-flex items-center gap-1.5">
            <Keyboard className="size-3.5" /> Shortcuts
          </span>
        </SectionTitle>
        <dl className="space-y-1.5 text-xs">
          {[
            ['Save', [modKey, 'S']],
            ['Undo', [modKey, 'Z']],
            ['Redo', [modKey, 'Shift', 'Z']],
            ['Copy / paste', [modKey, 'C / V']],
            ['Duplicate', [modKey, 'D']],
            ['Delete selection', ['Del']],
            ['Multi-select', ['Shift', 'Click']],
            ['Command palette', [modKey, 'K']],
          ].map(([label, keys]) => (
            <div key={label as string} className="flex items-center justify-between">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="flex gap-1">
                {(keys as string[]).map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MousePointerClick className="size-3.5" /> Select a node to edit its parameters.
        </p>
      </div>
    </div>
  )
}
