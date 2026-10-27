import { getApiKey } from '@/lib/settings'
import { isGatewayStatus, reportReachable, reportUnreachable } from './connection'
import type {
  ActivityDescriptor,
  AiGenerateResult,
  AiStatus,
  Approval,
  Json,
  Paged,
  RunDetail,
  RunStatus,
  RunSummary,
  Stats,
  ValidationError,
  ValidationResult,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowSummary,
  WorkflowVersion,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }

  get isNetwork() {
    return this.status === 0
  }
}

interface ProblemDetails {
  title?: string
  detail?: string
  message?: string
  error?: string
  errors?: Record<string, string[]> | { message: string }[]
}

function problemMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return typeof body === 'string' && body ? body : fallback
  const p = body as ProblemDetails
  if (p.detail) return p.detail
  if (p.message) return p.message
  if (p.error) return p.error
  if (Array.isArray(p.errors) && p.errors.length) return p.errors.map((e) => e.message).join('; ')
  if (p.errors && typeof p.errors === 'object') {
    const first = Object.values(p.errors).flat()[0]
    if (first) return first
  }
  return p.title ?? fallback
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const key = getApiKey()
  if (key) headers['X-Api-Key'] = key
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    reportUnreachable()
    throw new ApiError(0, 'Cannot reach the FlowPilot server')
  }
  const text = await res.text().catch(() => '')
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  // A 502/503/504 without a JSON body comes from a proxy (e.g. the Vite dev server) whose backend is down.
  // FlowPilot itself answers such codes with problem details (e.g. the AI provider failed).
  const unreachable = isGatewayStatus(res.status) && (!data || typeof data !== 'object')
  if (unreachable) reportUnreachable()
  else reportReachable()

  if (!res.ok) {
    if (res.status === 401) throw new ApiError(401, 'Unauthorized. Set your API key in Settings.', data)
    if (unreachable) throw new ApiError(0, 'Cannot reach the FlowPilot server', data)
    throw new ApiError(res.status, problemMessage(data, `${res.status} ${res.statusText}`), data)
  }
  return data as T
}

const enc = encodeURIComponent

export interface RunsQuery {
  workflowId?: string
  status?: RunStatus | ''
  skip?: number
  take?: number
}

export const api = {
  activities: () => request<ActivityDescriptor[]>('GET', '/api/activities'),

  workflows: () => request<WorkflowSummary[]>('GET', '/api/workflows'),
  workflow: (id: string) => request<WorkflowDetail>('GET', `/api/workflows/${enc(id)}`),
  createWorkflow: (def: WorkflowDefinition) => request<WorkflowDetail>('POST', '/api/workflows', def),
  saveWorkflow: (id: string, def: WorkflowDefinition) =>
    request<WorkflowDetail>('PUT', `/api/workflows/${enc(id)}`, def),
  deleteWorkflow: (id: string) => request<void>('DELETE', `/api/workflows/${enc(id)}`),
  publish: (id: string) => request<{ version: number }>('POST', `/api/workflows/${enc(id)}/publish`),
  versions: (id: string) => request<WorkflowVersion[]>('GET', `/api/workflows/${enc(id)}/versions`),
  runWorkflow: (id: string, body: { input?: Json; triggerNodeId?: string }) =>
    request<{ runId: string }>('POST', `/api/workflows/${enc(id)}/run`, body),
  validate: (def: WorkflowDefinition) => request<ValidationResult>('POST', '/api/workflows/validate', def),

  aiStatus: () => request<AiStatus>('GET', '/api/ai/status'),
  aiGenerate: (prompt: string, current?: WorkflowDefinition) =>
    request<AiGenerateResult>('POST', '/api/ai/generate', { prompt, current }),

  runs: (q: RunsQuery = {}) => {
    const params = new URLSearchParams()
    if (q.workflowId) params.set('workflowId', q.workflowId)
    if (q.status) params.set('status', q.status)
    if (q.skip) params.set('skip', String(q.skip))
    if (q.take) params.set('take', String(q.take))
    const qs = params.toString()
    return request<Paged<RunSummary>>('GET', `/api/runs${qs ? `?${qs}` : ''}`)
  },
  run: (id: string) => request<RunDetail>('GET', `/api/runs/${enc(id)}`),
  cancelRun: (id: string) => request<void>('POST', `/api/runs/${enc(id)}/cancel`),
  retryRun: (id: string) => request<void>('POST', `/api/runs/${enc(id)}/retry`),

  approvals: (status: 'pending' | 'resolved') => request<Approval[]>('GET', `/api/approvals?status=${status}`),
  approve: (id: string, comment?: string) =>
    request<void>('POST', `/api/approvals/${enc(id)}/approve`, { comment: comment || undefined }),
  reject: (id: string, comment?: string) =>
    request<void>('POST', `/api/approvals/${enc(id)}/reject`, { comment: comment || undefined }),

  stats: () => request<Stats>('GET', '/api/stats'),
  health: async () => {
    const res = await fetch('/health')
    if (!res.ok) throw new ApiError(res.status, `Health check returned ${res.status}`)
    return res.text()
  },
}

/**
 * Validation problems carried by a rejected request, e.g. `POST /api/workflows/{id}/run` answers
 * 400 `{ valid: false, errors: [...] }` when the draft is invalid. Null for any other error.
 */
export function validationErrorsOf(err: unknown): ValidationError[] | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null
  const d = err.details as Partial<ValidationResult> | null | undefined
  if (!d || typeof d !== 'object' || d.valid !== false || !Array.isArray(d.errors)) return null
  const list = d.errors.filter((e): e is ValidationError => !!e && typeof e === 'object' && typeof e.message === 'string')
  return list.length ? list : null
}

export function describeProblems(errors: ValidationError[], max = 3): string {
  const lines = errors.slice(0, max).map((e) => (e.nodeId ? `${e.nodeId}: ${e.message}` : e.message))
  if (errors.length > max) lines.push(`…and ${errors.length - max} more`)
  return lines.join('\n')
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
