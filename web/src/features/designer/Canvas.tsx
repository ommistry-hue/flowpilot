import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type DefaultEdgeOptions,
  type Edge,
  type IsValidConnection,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react'
import { Network } from 'lucide-react'
import { useCallback, useEffect, useMemo, type DragEvent, type ReactNode } from 'react'
import { useCatalog } from '@/api/hooks'
import { useTheme } from '@/lib/theme'
import { ActivityNode } from './ActivityNode'
import { isTriggerType, NODE_WIDTH, type FlowEdge, type FlowNode } from './model'
import { OutcomeEdge } from './OutcomeEdge'
import { useDesigner, useDesignerApi } from './store'

export const ACTIVITY_DND_TYPE = 'application/x-flowpilot-activity'

const nodeTypes: NodeTypes = { activity: ActivityNode }
const edgeTypes: EdgeTypes = { outcome: OutcomeEdge }
const defaultEdgeOptions: DefaultEdgeOptions = {
  type: 'outcome',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
}

const MINIMAP_COLORS: Record<string, string> = {
  Running: '#6366f1',
  Completed: '#10b981',
  Failed: '#ef4444',
  Suspended: '#f59e0b',
  Cancelled: '#a1a1aa',
}

/** Whole graph in view with a small margin; never zoom in past 100% on small graphs. */
const FIT_OPTIONS = { padding: 0.08, maxZoom: 1 }

export function Canvas({ children, fitKey, minimap = true }: { children?: ReactNode; fitKey?: string; minimap?: boolean }) {
  const store = useDesignerApi()
  const nodes = useDesigner((s) => s.nodes)
  const edges = useDesigner((s) => s.edges)
  const ghost = useDesigner((s) => s.ghost)
  const readOnly = useDesigner((s) => s.readOnly)
  const onNodesChange = useDesigner((s) => s.onNodesChange)
  const onEdgesChange = useDesigner((s) => s.onEdgesChange)
  const onConnect = useDesigner((s) => s.onConnect)
  const catalog = useCatalog()
  const { resolved } = useTheme()
  const rf = useReactFlow<FlowNode, FlowEdge>()

  const shownNodes = ghost ? ghost.nodes : nodes
  const shownEdges = ghost ? ghost.edges : edges
  const edgesWithMarker = useMemo(
    () => shownEdges.map((e) => (e.markerEnd ? e : { ...e, markerEnd: defaultEdgeOptions.markerEnd })),
    [shownEdges],
  )

  useEffect(() => {
    const t = setTimeout(() => void rf.fitView({ padding: 0.2, maxZoom: 1, duration: 250 }), 260)
    return () => clearTimeout(t)
  }, [rf, fitKey, ghost])

  const isValidConnection: IsValidConnection<FlowEdge> = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false
      const target = store.getState().nodes.find((n) => n.id === c.target)
      if (!target) return false
      return !isTriggerType(target.data.activityType, catalog.byType.get(target.data.activityType))
    },
    [catalog, store],
  )

  const onDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes(ACTIVITY_DND_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      const type = e.dataTransfer.getData(ACTIVITY_DND_TYPE)
      if (!type) return
      e.preventDefault()
      const descriptor = catalog.byType.get(type)
      if (!descriptor) return
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      store.getState().addNode(descriptor, { x: Math.round(p.x - NODE_WIDTH / 2), y: Math.round(p.y - 30) })
    },
    [catalog, rf, store],
  )

  return (
    <div className="relative h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow<FlowNode, FlowEdge>
        nodes={shownNodes}
        edges={edgesWithMarker}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStart={() => store.getState().snapshot()}
        onNodeClick={(_, node) => {
          if (store.getState().run) store.getState().setInspectNode(node.id)
        }}
        onPaneClick={() => store.getState().setInspectNode(null)}
        nodesDraggable={!readOnly && !ghost}
        nodesConnectable={!readOnly && !ghost}
        elementsSelectable={!ghost}
        deleteKeyCode={readOnly || ghost ? null : ['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        zoomOnScroll={!readOnly}
        preventScrolling={!readOnly}
        snapToGrid
        snapGrid={[16, 16]}
        minZoom={0.1}
        maxZoom={2}
        colorMode={resolved}
        connectionLineStyle={{ strokeWidth: 1.6 }}
        className={ghost ? 'fp-ghost' : undefined}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} color="var(--canvas-dot)" />
        <Controls position="bottom-left" showInteractive={false} fitViewOptions={FIT_OPTIONS}>
          {!readOnly && !ghost && (
            <ControlButton
              onClick={() => {
                store.getState().layout()
                // Let React Flow apply the new positions before framing them.
                setTimeout(() => void rf.fitView({ ...FIT_OPTIONS, duration: 250 }), 50)
              }}
              title="Auto-layout"
              aria-label="Auto-layout"
            >
              <Network className="!fill-none" />
            </ControlButton>
          )}
        </Controls>
        {minimap && (
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeBorderRadius={8}
          nodeColor={(n) => {
            const execs = store.getState().run?.byNode[n.id]
            const last = execs?.[execs.length - 1]
            return last ? MINIMAP_COLORS[last.status] : 'color-mix(in oklch, var(--muted-foreground) 45%, transparent)'
          }}
          maskColor="color-mix(in oklch, var(--background) 55%, transparent)"
          style={{ width: 168, height: 108 }}
        />
        )}
        {children}
      </ReactFlow>
    </div>
  )
}
