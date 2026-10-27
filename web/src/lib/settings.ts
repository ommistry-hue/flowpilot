import { useSyncExternalStore } from 'react'

const API_KEY = 'fp-api-key'
const listeners = new Set<() => void>()

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function getApiKey(): string {
  return read(API_KEY)
}

export function setApiKey(value: string) {
  try {
    if (value) localStorage.setItem(API_KEY, value)
    else localStorage.removeItem(API_KEY)
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useApiKey() {
  return useSyncExternalStore(subscribe, getApiKey, () => '')
}
