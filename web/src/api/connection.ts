import { onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

/**
 * Tracks whether the FlowPilot server is reachable. Any request that cannot reach it flips the app to
 * "reconnecting": React Query pauses (instead of failing) every query, and a probe polls `/health`
 * with backoff until the server answers, then queries resume and refetch.
 */
export interface ConnectionState {
  reachable: boolean
  /** When the server was first found unreachable. */
  since: number | null
  /** When the next automatic probe runs. */
  nextProbeAt: number | null
  probing: boolean
}

const DELAYS = [1000, 2000, 4000, 8000, 15_000]
const GATEWAY = new Set([502, 503, 504])

let state: ConnectionState = { reachable: true, since: null, nextProbeAt: null, probing: false }
let attempt = 0
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const recoveredListeners = new Set<() => void>()

function set(patch: Partial<ConnectionState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function schedule() {
  clearTimeout(timer)
  const delay = DELAYS[Math.min(attempt, DELAYS.length - 1)]
  attempt++
  set({ nextProbeAt: Date.now() + delay })
  timer = setTimeout(() => void probe(), delay)
}

async function probe() {
  clearTimeout(timer)
  if (state.reachable) return
  set({ probing: true, nextProbeAt: null })
  let ok = false
  try {
    const res = await fetch('/health', { cache: 'no-store' })
    ok = !GATEWAY.has(res.status)
  } catch {
    ok = false
  }
  if (state.reachable) return
  set({ probing: false })
  if (ok) reportReachable()
  else schedule()
}

/** Called when a request could not reach the server (network error or proxy gateway error). */
export function reportUnreachable() {
  onlineManager.setOnline(false)
  if (!state.reachable) return
  attempt = 0
  set({ reachable: false, since: Date.now(), probing: false })
  schedule()
}

/** Called whenever the server answered; ends a "reconnecting" phase. */
export function reportReachable() {
  if (state.reachable) return
  clearTimeout(timer)
  attempt = 0
  set({ reachable: true, since: null, nextProbeAt: null, probing: false })
  onlineManager.setOnline(true)
  recoveredListeners.forEach((l) => l())
}

/** Probe right away instead of waiting for the next backoff step. */
export function retryNow() {
  if (!state.reachable && !state.probing) void probe()
}

/** One-off check, e.g. when the realtime connection drops: flips to "reconnecting" if the server is gone. */
export async function checkServer() {
  if (!state.reachable) return
  try {
    const res = await fetch('/health', { cache: 'no-store' })
    if (GATEWAY.has(res.status)) reportUnreachable()
  } catch {
    reportUnreachable()
  }
}

export function onServerRecovered(listener: () => void): () => void {
  recoveredListeners.add(listener)
  return () => recoveredListeners.delete(listener)
}

export function isGatewayStatus(status: number) {
  return GATEWAY.has(status)
}

export function useConnection(): ConnectionState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => state,
  )
}
