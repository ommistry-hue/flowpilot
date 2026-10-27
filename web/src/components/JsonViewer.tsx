import { Check, Copy } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { stringifyJson } from '@/lib/json'
import { cn } from '@/lib/utils'

const TOKEN = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g

function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of json.matchAll(TOKEN)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(json.slice(last, idx))
    const tok = m[0]
    let cls = 'text-amber-700 dark:text-amber-300'
    if (tok.startsWith('"')) cls = m[2] ? 'text-violet-700 dark:text-violet-300' : 'text-emerald-700 dark:text-emerald-300'
    else if (/true|false/.test(tok)) cls = 'text-sky-700 dark:text-sky-300'
    else if (tok === 'null') cls = 'text-muted-foreground'
    out.push(
      <span key={i++} className={cls}>
        {tok}
      </span>,
    )
    last = idx + tok.length
  }
  if (last < json.length) out.push(json.slice(last))
  return out
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      className={cn(
        'inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function JsonViewer({
  value,
  className,
  emptyLabel = 'No data',
  label,
}: {
  value: unknown
  className?: string
  emptyLabel?: string
  label?: ReactNode
}) {
  const text = useMemo(() => stringifyJson(value), [value])
  const nodes = useMemo(() => (text.length > 200_000 ? [text] : highlight(text)), [text])
  const empty = value === undefined || value === null || text === ''
  return (
    <div className={cn('group relative overflow-hidden rounded-lg border bg-muted/40', className)}>
      {(label || !empty) && (
        <div className="flex h-8 items-center justify-between border-b bg-card/60 pr-1 pl-3">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
          {!empty && <CopyButton text={text} />}
        </div>
      )}
      {empty ? (
        <p className="px-3 py-3 text-xs text-muted-foreground italic">{emptyLabel}</p>
      ) : (
        <pre className="max-h-80 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-[1.6] scrollbar-thin">
          {nodes}
        </pre>
      )}
    </div>
  )
}
