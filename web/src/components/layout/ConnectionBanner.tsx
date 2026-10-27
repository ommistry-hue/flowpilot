import { useQueryClient } from '@tanstack/react-query'
import { Loader2, WifiOff } from 'lucide-react'
import { useEffect } from 'react'
import { onServerRecovered, retryNow, useConnection } from '@/api/connection'
import { useNow } from '@/lib/useNow'

/**
 * Non-blocking notice shown while the server is unreachable (e.g. during a restart). Data already on
 * screen stays usable; queries pause and are refetched silently once the server answers again.
 */
export function ConnectionBanner() {
  const qc = useQueryClient()
  const { reachable, nextProbeAt, probing } = useConnection()
  const now = useNow(!reachable, 1000)

  useEffect(() => onServerRecovered(() => void qc.invalidateQueries()), [qc])

  if (reachable) return null
  const secs = nextProbeAt ? Math.max(0, Math.ceil((nextProbeAt - now) / 1000)) : 0

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex animate-slide-up items-center gap-2.5 rounded-full border border-amber-500/30 bg-card/95 py-1.5 pr-1.5 pl-3 text-xs shadow-elevated backdrop-blur"
      >
        <WifiOff className="size-3.5 text-amber-600 dark:text-amber-400" />
        <span className="font-medium">Reconnecting to the server…</span>
        <span className="text-muted-foreground tabular-nums">
          {probing ? 'checking' : secs > 0 ? `retrying in ${secs}s` : 'retrying'}
        </span>
        <button
          type="button"
          onClick={retryNow}
          disabled={probing}
          className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60"
        >
          {probing && <Loader2 className="size-3 animate-spin" />}
          Retry now
        </button>
      </div>
    </div>
  )
}
