import { useEffect, useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'fp-theme'
const listeners = new Set<() => void>()
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let pref: ThemePref = readPref()

function resolve(p: ThemePref): ResolvedTheme {
  if (p === 'system') return media?.matches ? 'dark' : 'light'
  return p
}

function apply() {
  document.documentElement.classList.toggle('dark', resolve(pref) === 'dark')
  listeners.forEach((l) => l())
}

media?.addEventListener('change', () => {
  if (pref === 'system') apply()
})

export function setTheme(p: ThemePref) {
  pref = p
  try {
    localStorage.setItem(KEY, p)
  } catch {
    /* storage unavailable */
  }
  apply()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useTheme() {
  const p = useSyncExternalStore(subscribe, () => pref)
  const resolved = useSyncExternalStore(subscribe, () => resolve(pref))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])
  return {
    pref: p,
    resolved,
    setTheme,
    toggle: () => setTheme(resolved === 'dark' ? 'light' : 'dark'),
  }
}
