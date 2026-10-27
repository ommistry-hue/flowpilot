import { useQueryClient } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'
import { useBlocker, useNavigate } from 'react-router'
import { useStore } from 'zustand'
import { toast } from 'sonner'
import { api, ApiError, describeProblems, errorMessage, validationErrorsOf } from '@/api/client'
import { qk, useCatalog } from '@/api/hooks'
import type { Json, WorkflowDefinition, WorkflowDetail } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { isEditableTarget } from '@/lib/utils'
import { AiDialog } from './AiDialog'
import { Canvas } from './Canvas'
import { EmptyCanvasHint, GhostBanner, ValidationPanel } from './CanvasOverlays'
import { DesignerToolbar, type ToolbarBusy } from './DesignerToolbar'
import { Inspector } from './Inspector'
import { JsonDialog } from './JsonDialog'
import { isTriggerType } from './model'
import { Palette } from './Palette'
import { RunDialog } from './RunDialog'
import { RunDrawer } from './RunDrawer'
import { createDesignerStore, DesignerContext, type DesignerStore } from './store'
import { useLiveRun } from './useLiveRun'
import { localValidate, toValidationState } from './validate'

export function Designer({
  definition,
  workflowId,
  publishedVersion,
  openAi,
  onCreated,
}: {
  definition: WorkflowDefinition
  workflowId: string | null
  publishedVersion: number | null
  openAi?: boolean
  onCreated: (id: string) => void
}) {
  const [store] = useState(() => createDesignerStore({ definition, workflowId, publishedVersion }))
  return (
    <DesignerContext.Provider value={store}>
      <ReactFlowProvider>
        <DesignerWorkspace store={store} openAi={openAi} onCreated={onCreated} />
      </ReactFlowProvider>
    </DesignerContext.Provider>
  )
}

function DesignerWorkspace({
  store,
  openAi,
  onCreated,
}: {
  store: DesignerStore
  openAi?: boolean
  onCreated: (id: string) => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const catalog = useCatalog()
  const runId = useStore(store, (s) => s.run?.runId ?? null)
  const dirty = useStore(store, (s) => s.dirty)
  const [busy, setBusy] = useState<ToolbarBusy>({ saving: false, validating: false, publishing: false })
  const [runOpen, setRunOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(!!openAi)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonDef, setJsonDef] = useState<WorkflowDefinition | null>(null)
  useLiveRun(store, runId)

  const save = useCallback(
    async (opts: { quiet?: boolean } = {}): Promise<string | null> => {
      const s = store.getState()
      if (s.workflowId && !s.dirty) return s.workflowId
      setBusy((b) => ({ ...b, saving: true }))
      try {
        const def = s.toDefinition()
        let detail: WorkflowDetail
        if (s.workflowId) detail = await api.saveWorkflow(s.workflowId, def)
        else {
          const { id: _omit, ...rest } = def
          void _omit
          detail = await api.createWorkflow(rest)
        }
        const isNew = !s.workflowId
        store.getState().markSaved(detail.id, detail.publishedVersion ?? null)
        qc.setQueryData(qk.workflow(detail.id), detail)
        void qc.invalidateQueries({ queryKey: qk.workflows, exact: true })
        if (isNew) {
          onCreated(detail.id)
          navigate(`/workflows/${detail.id}`, { replace: true })
        }
        if (!opts.quiet) toast.success(isNew ? 'Workflow created' : 'Saved')
        return detail.id
      } catch (e) {
        toast.error('Save failed', { description: errorMessage(e) })
        return null
      } finally {
        setBusy((b) => ({ ...b, saving: false }))
      }
    },
    [navigate, onCreated, qc, store],
  )

  const check = useCallback(async () => {
    const def = store.getState().toDefinition()
    let state
    try {
      const res = await api.validate(def)
      state = toValidationState(res.errors ?? [], 'server')
    } catch (e) {
      if (!(e instanceof ApiError) || !e.isNetwork) throw e
      state = toValidationState(localValidate(def, catalog), 'local')
    }
    store.getState().setValidation(state.list.length ? state : null)
    return state
  }, [catalog, store])

  const validate = useCallback(async () => {
    setBusy((b) => ({ ...b, validating: true }))
    try {
      const state = await check()
      if (state.list.length === 0)
        toast.success('No problems found', { description: state.source === 'local' ? 'Checked locally (server offline).' : undefined })
    } catch (e) {
      toast.error('Validation failed', { description: errorMessage(e) })
    } finally {
      setBusy((b) => ({ ...b, validating: false }))
    }
  }, [check])

  const publish = useCallback(async () => {
    setBusy((b) => ({ ...b, publishing: true }))
    try {
      const problems = (await check()).list.length
      if (problems) {
        toast.error('Publish blocked', { description: `Fix ${problems} problem${problems === 1 ? '' : 's'} first.` })
        return
      }
      const id = await save({ quiet: true })
      if (!id) return
      const { version } = await api.publish(id)
      store.getState().setPublishedVersion(version)
      void qc.invalidateQueries({ queryKey: qk.workflows })
      toast.success(`Published v${version}`, { description: 'Webhook and schedule triggers now use this version.' })
    } catch (e) {
      toast.error('Publish failed', { description: errorMessage(e) })
    } finally {
      setBusy((b) => ({ ...b, publishing: false }))
    }
  }, [check, qc, save, store])

  const run = useCallback(
    async (input: Json | undefined, triggerNodeId: string | undefined) => {
      const id = await save({ quiet: true })
      if (!id) return false
      try {
        const { runId } = await api.runWorkflow(id, { input, triggerNodeId })
        store.getState().startRun(runId)
        toast.success('Run started')
        return true
      } catch (e) {
        const problems = validationErrorsOf(e)
        if (!problems) {
          toast.error('Could not start run', { description: errorMessage(e) })
          return false
        }
        // The server refused an invalid draft: surface the problems on the canvas like Validate does.
        const s = store.getState()
        s.clearRun()
        s.setValidation(toValidationState(problems, 'server'))
        const first = problems.find((p) => p.nodeId)?.nodeId
        if (first) s.selectOnly(first)
        toast.error(`Run blocked: ${problems.length} problem${problems.length === 1 ? '' : 's'} to fix`, {
          description: <span className="whitespace-pre-line">{describeProblems(problems)}</span>,
        })
        return true
      }
    },
    [save, store],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 's') {
        e.preventDefault()
        void save()
        return
      }
      if (!mod || isEditableTarget(e.target) || document.querySelector('[role="dialog"]')) return
      const s = store.getState()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        s.undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        s.redo()
      } else if (key === 'c') {
        if (window.getSelection()?.toString()) return
        if (s.copySelection()) e.preventDefault()
      } else if (key === 'v') {
        if (s.paste()) e.preventDefault()
      } else if (key === 'd') {
        e.preventDefault()
        s.duplicateSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, store])

  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => store.getState().dirty && currentLocation.pathname !== nextLocation.pathname,
  )

  const triggers = useStore(store, (s) => s.nodes)
    .filter((n) => isTriggerType(n.data.activityType, catalog.byType.get(n.data.activityType)))
    .map((n) => ({ id: n.id, label: n.data.name || catalog.byType.get(n.data.activityType)?.displayName || n.id }))

  return (
    <div className="flex h-full min-h-0">
      <DesignerToolbar
        busy={busy}
        onSave={() => void save()}
        onValidate={() => void validate()}
        onPublish={() => void publish()}
        onRun={() => setRunOpen(true)}
        onAi={() => setAiOpen(true)}
        onJson={() => {
          setJsonDef(store.getState().toDefinition())
          setJsonOpen(true)
        }}
      />
      <Palette />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <Canvas fitKey={runId ? 'run' : 'edit'} minimap={!runId}>
            <ValidationPanel />
            <GhostBanner />
          </Canvas>
          <EmptyCanvasHint onAi={() => setAiOpen(true)} />
        </div>
        <RunDrawer />
      </div>
      <Inspector />

      <RunDialog open={runOpen} onOpenChange={setRunOpen} triggers={triggers} dirty={dirty || !store.getState().workflowId} onRun={run} />
      <AiDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        hasContent={store.getState().nodes.length > 1}
        current={() => store.getState().toDefinition()}
        onResult={(r) => store.getState().setGhost(r.definition, r.explanation)}
      />
      {jsonDef && (
        <JsonDialog
          open={jsonOpen}
          onOpenChange={setJsonOpen}
          definition={jsonDef}
          onApply={(def) => {
            store.getState().replaceDefinition(def, { keepName: false })
            toast.success('Canvas updated from JSON')
          }}
        />
      )}
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(v) => !v && blocker.state === 'blocked' && blocker.reset()}
        destructive
        title="Discard unsaved changes?"
        description="You have edits that are not saved. Leaving now will lose them."
        confirmLabel="Discard and leave"
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      />
    </div>
  )
}
