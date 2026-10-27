export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

export interface Position {
  x: number
  y: number
}

export interface RetryPolicy {
  maxAttempts: number
  initialDelayMs: number
  backoffMultiplier: number
  maxDelayMs: number
}

export interface NodeDefinition {
  id: string
  type: string
  name?: string | null
  config: JsonObject
  retry?: RetryPolicy | null
  timeoutMs?: number | null
  position: Position
}

export interface EdgeDefinition {
  id: string
  source: string
  sourceHandle: string
  target: string
}

export interface WorkflowDefinition {
  schemaVersion: string
  id?: string
  name: string
  description?: string | null
  variables: JsonObject
  nodes: NodeDefinition[]
  edges: EdgeDefinition[]
}

export type InputKind = 'Text' | 'Multiline' | 'Expression' | 'Number' | 'Boolean' | 'Json' | 'Select' | 'Code'

export interface ActivityInput {
  name: string
  displayName: string
  description?: string | null
  kind: InputKind
  options?: string[] | null
  required: boolean
  defaultValue?: Json
}

export interface ActivityDescriptor {
  type: string
  displayName: string
  category: string
  description?: string | null
  icon?: string | null
  outcomes: string[]
  dynamicOutcomes: boolean
  isTrigger: boolean
  inputs: ActivityInput[]
}

export interface WorkflowSummary {
  id: string
  name: string
  description?: string | null
  publishedVersion?: number | null
  updatedAt: string
  createdAt: string
  triggerTypes: string[]
  nodeCount: number
}

export interface WorkflowDetail extends WorkflowSummary {
  definition: WorkflowDefinition
}

export interface WorkflowVersion {
  version: number
  createdAt: string
}

export type RunStatus = 'Pending' | 'Running' | 'Suspended' | 'Completed' | 'Failed' | 'Cancelled'
export type NodeStatus = 'Running' | 'Completed' | 'Failed' | 'Suspended' | 'Cancelled'

export interface RunSummary {
  id: string
  workflowId: string
  workflowName: string
  version?: number | null
  status: RunStatus
  triggerNodeId?: string | null
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
  durationMs?: number | null
  error?: string | null
}

export interface NodeExecution {
  id: string
  nodeId: string
  nodeType: string
  attempt: number
  status: NodeStatus
  input?: Json
  output?: Json
  outcome?: string | null
  error?: string | null
  startedAt: string
  completedAt?: string | null
  durationMs?: number | null
}

export interface NodeUpdatedEvent extends NodeExecution {
  runId: string
}

export interface Bookmark {
  id: string
  nodeId: string
  kind: string
  correlationKey?: string | null
  payload?: Json
  resumeAt?: string | null
  createdAt: string
  resolvedAt?: string | null
  resolution?: Json
}

export interface RunDetail extends RunSummary {
  definition: WorkflowDefinition
  input?: Json
  variables?: Json
  nodes: NodeExecution[]
  bookmarks: Bookmark[]
}

export interface Approval {
  id: string
  runId: string
  workflowId: string
  workflowName: string
  nodeId: string
  title: string
  description?: string | null
  assignee?: string | null
  createdAt: string
  resolvedAt?: string | null
  resolution?: Json
}

export interface ValidationError {
  nodeId?: string | null
  edgeId?: string | null
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

export interface AiStatus {
  enabled: boolean
  provider?: string | null
  model?: string | null
}

export interface AiGenerateResult {
  definition: WorkflowDefinition
  explanation?: string | null
}

export interface Stats {
  workflows: number
  runs24h: number
  failed24h: number
  pendingApprovals: number
  runsByDay: { date: string; completed: number; failed: number }[]
}

export interface Paged<T> {
  items: T[]
  total: number
}
