import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from '@microsoft/signalr'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { getApiKey } from '@/lib/settings'
import { checkServer, onServerRecovered, reportReachable } from './connection'
import type { NodeUpdatedEvent, RunSummary } from './types'

export type HubStatus = 'connecting' | 'connected' | 'disconnected'

interface HubEvents {
  nodeUpdated: NodeUpdatedEvent
  runUpdated: RunSummary
  approvalsChanged: undefined
}
type EventName = keyof HubEvents
type Handler<E extends EventName> = (payload: HubEvents[E]) => void

const handlers: { [E in EventName]: Set<Handler<E>> } = {
  nodeUpdated: new Set(),
  runUpdated: new Set(),
  approvalsChanged: new Set(),
}
const statusListeners = new Set<() => void>()
/** Run groups this client belongs to, with the callbacks to run after each successful (re)join. */
const joinedRuns = new Map<string, Set<() => void>>()
const reconnectListeners = new Set<() => void>()

let connection: HubConnection | null = null
let status: HubStatus = 'disconnected'
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryCount = 0
let started = false
let everConnected = false

const MAX_DELAY = 30_000

/** Exponential backoff with jitter, capped at 30s. Never gives up. */
function backoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attempt - 1), MAX_DELAY)
  return attempt === 0 ? 0 : Math.round(base * (0.8 + Math.random() * 0.4))
}

function setStatus(s: HubStatus) {
  if (status === s) return
  status = s
  statusListeners.forEach((l) => l())
}

async function joinRun(runId: string, only?: () => void) {
  if (!(await invokeSafe('JoinRun', runId))) return
  const callbacks = joinedRuns.get(runId)
  if (!callbacks) return
  if (only) {
    if (callbacks.has(only)) only()
  } else callbacks.forEach((cb) => cb())
}

/** After a (re)connect the server has forgotten our groups: join them again and catch up on missed events. */
function onConnected() {
  retryCount = 0
  setStatus('connected')
  reportReachable()
  for (const runId of joinedRuns.keys()) void joinRun(runId)
  if (everConnected) reconnectListeners.forEach((l) => l())
  everConnected = true
}

function build(): HubConnection {
  const conn = new HubConnectionBuilder()
    .withUrl('/hubs/runs', { accessTokenFactory: () => getApiKey() })
    .withAutomaticReconnect({ nextRetryDelayInMilliseconds: (ctx) => backoff(ctx.previousRetryCount) })
    .configureLogging(LogLevel.None)
    .build()

  conn.on('nodeUpdated', (p: NodeUpdatedEvent) => handlers.nodeUpdated.forEach((h) => h(p)))
  conn.on('runUpdated', (p: RunSummary) => handlers.runUpdated.forEach((h) => h(p)))
  conn.on('approvalsChanged', () => handlers.approvalsChanged.forEach((h) => h(undefined)))
  // Callbacks of a connection replaced by restartHub() must not touch the shared state.
  conn.onreconnecting(() => {
    if (conn !== connection) return
    setStatus('connecting')
    void checkServer()
  })
  conn.onreconnected(() => {
    if (conn === connection) onConnected()
  })
  conn.onclose(() => {
    if (conn !== connection) return
    setStatus('disconnected')
    scheduleStart()
  })
  return conn
}

async function invokeSafe(method: string, ...args: unknown[]): Promise<boolean> {
  if (connection?.state !== HubConnectionState.Connected) return false
  try {
    await connection.invoke(method, ...args)
    return true
  } catch {
    return false
  }
}

function scheduleStart() {
  clearTimeout(retryTimer)
  retryCount++
  retryTimer = setTimeout(() => void start(), Math.max(1000, backoff(retryCount)))
}

async function start() {
  if (!connection) connection = build()
  if (connection.state !== HubConnectionState.Disconnected) return
  setStatus('connecting')
  try {
    await connection.start()
    onConnected()
  } catch {
    setStatus('disconnected')
    scheduleStart()
  }
}

export function ensureHub() {
  if (started) return
  started = true
  void start()
}

export async function restartHub() {
  clearTimeout(retryTimer)
  const old = connection
  connection = null
  retryCount = 0
  if (old) await old.stop().catch(() => {})
  started = true
  await start()
}

// The HTTP probe noticed the server is back: reconnect now rather than waiting out the hub's backoff.
onServerRecovered(() => {
  if (started && status !== 'connected') void restartHub()
})

export function useHubStatus(): HubStatus {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
    () => status,
    () => 'disconnected',
  )
}

export function useHubEvent<E extends EventName>(event: E, handler: Handler<E>) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    ensureHub()
    const h: Handler<E> = (p) => ref.current(p)
    const set = handlers[event] as Set<Handler<E>>
    set.add(h)
    return () => {
      set.delete(h)
    }
  }, [event])
}

/** Runs after the realtime connection comes back from a drop, so callers can refetch what they missed. */
export function useHubReconnected(handler: () => void) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    const h = () => ref.current()
    reconnectListeners.add(h)
    return () => {
      reconnectListeners.delete(h)
    }
  }, [])
}

/**
 * Subscribes to a run's group while mounted, re-joining it after every reconnect. Events sent before a
 * join completes are missed, so `onJoined` fires after every successful (re)join to let the caller refetch.
 */
export function useRunChannel(runId: string | null | undefined, onJoined?: () => void) {
  const onJoinedRef = useRef(onJoined)
  useEffect(() => {
    onJoinedRef.current = onJoined
  })
  useEffect(() => {
    if (!runId) return
    ensureHub()
    const cb = () => onJoinedRef.current?.()
    let callbacks = joinedRuns.get(runId)
    if (!callbacks) joinedRuns.set(runId, (callbacks = new Set()))
    callbacks.add(cb)
    if (status === 'connected') void joinRun(runId, cb)
    return () => {
      const set = joinedRuns.get(runId)
      set?.delete(cb)
      if (set && set.size === 0) {
        joinedRuns.delete(runId)
        void invokeSafe('LeaveRun', runId)
      }
    }
  }, [runId])
}
