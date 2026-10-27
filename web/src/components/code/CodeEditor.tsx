import { lazy, Suspense } from 'react'
import { cn } from '@/lib/utils'

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language: 'javascript' | 'json'
  minHeight?: number
  maxHeight?: number
  height?: number | string
  readOnly?: boolean
  lineNumbers?: boolean
  placeholder?: string
  onSubmit?: () => void
  className?: string
  invalid?: boolean
}

const MonacoEditor = lazy(() => import('./MonacoEditor'))

export function CodeEditor({ className, invalid, ...props }: CodeEditorProps) {
  const fallbackHeight = props.height ?? props.minHeight ?? 72
  return (
    <div
      className={cn(
        'nokey overflow-hidden rounded-md border border-input bg-card shadow-soft transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
        invalid && 'border-destructive focus-within:border-destructive focus-within:ring-destructive/20',
        className,
      )}
    >
      <Suspense
        fallback={
          <pre
            style={{ height: fallbackHeight }}
            className="overflow-hidden px-3 py-2 font-mono text-[12.5px] whitespace-pre-wrap text-muted-foreground"
          >
            {props.value}
          </pre>
        }
      >
        <MonacoEditor {...props} />
      </Suspense>
    </div>
  )
}
