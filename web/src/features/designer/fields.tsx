import { Braces, Info, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ActivityInput, Json } from '@/api/types'
import { CodeEditor } from '@/components/code/CodeEditor'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { CasesChange, SwitchCase } from './model'

const SCOPE_HELP = (
  <div className="space-y-1 py-0.5">
    <p className="font-medium">Supports {'{{ expressions }}'}</p>
    <p className="opacity-80">
      Scope: <code>input</code>, <code>vars</code>, <code>nodes.&lt;id&gt;.output</code>, <code>trigger</code>,{' '}
      <code>run</code>, <code>item</code>, <code>index</code>
    </p>
    <p className="opacity-80">A lone {'{{ expr }}'} keeps its JS type.</p>
  </div>
)

export function ExpressionChip({ active }: { active?: boolean }) {
  return (
    <Tooltip content={SCOPE_HELP}>
      <span
        className={cn(
          'inline-flex h-4.5 cursor-help items-center rounded border px-1 font-mono text-[9.5px] font-medium',
          active ? 'border-primary/40 bg-primary-soft text-primary-soft-foreground' : 'border-border text-muted-foreground',
        )}
      >
        {'{{ }}'}
      </span>
    </Tooltip>
  )
}

export function FieldRow({
  label,
  htmlFor,
  required,
  description,
  aside,
  children,
  error,
}: {
  label: ReactNode
  htmlFor?: string
  required?: boolean
  description?: string | null
  aside?: ReactNode
  children: ReactNode
  error?: string | null
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-4.5 items-center gap-1.5">
        <Label htmlFor={htmlFor} className="flex items-center gap-1">
          {label}
          {required && <span className="text-destructive">*</span>}
        </Label>
        {description && (
          <Tooltip content={description}>
            <Info className="size-3 cursor-help text-muted-foreground/70" />
          </Tooltip>
        )}
        <span className="ml-auto flex items-center gap-1">{aside}</span>
      </div>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

function asString(v: Json | undefined): string {
  if (v === undefined || v === null) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

const hasExpr = (v: Json | undefined) => typeof v === 'string' && v.includes('{{')

export function InputField({
  input,
  value,
  onChange,
  nodeId,
}: {
  input: ActivityInput
  value: Json | undefined
  onChange: (v: Json | undefined) => void
  nodeId: string
}) {
  const id = `f-${nodeId}-${input.name}`
  const kind = (input.kind ?? 'Text').toString().toLowerCase()
  const placeholder = input.defaultValue != null ? asString(input.defaultValue) : undefined
  const common = { label: input.displayName || input.name, htmlFor: id, required: input.required, description: input.description }

  switch (kind) {
    case 'boolean':
      return (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
          <div className="min-w-0">
            <Label htmlFor={id}>{common.label}</Label>
            {input.description && <p className="mt-0.5 text-[11px] text-muted-foreground">{input.description}</p>}
          </div>
          <Switch id={id} checked={value === true || value === 'true'} onCheckedChange={(v) => onChange(v)} />
        </div>
      )
    case 'number':
      return (
        <FieldRow {...common} aside={<ExpressionChip active={hasExpr(value)} />}>
          <Input
            id={id}
            inputMode="decimal"
            value={asString(value)}
            placeholder={placeholder}
            onChange={(e) => {
              const raw = e.target.value
              if (raw.trim() === '') return onChange(undefined)
              const n = Number(raw)
              onChange(Number.isFinite(n) && !raw.endsWith('.') ? n : raw)
            }}
            className="font-mono text-[13px]"
          />
        </FieldRow>
      )
    case 'select': {
      const options = (input.options ?? []).map((o) => ({ value: o, label: o }))
      return (
        <FieldRow {...common}>
          <Select
            id={id}
            value={asString(value)}
            onValueChange={(v) => onChange(v === '' ? undefined : v)}
            placeholder={placeholder ?? 'Select…'}
            options={input.required ? options : [{ value: '', label: <span className="text-muted-foreground">None</span> }, ...options]}
          />
        </FieldRow>
      )
    }
    case 'multiline':
      return (
        <FieldRow {...common} aside={<ExpressionChip active={hasExpr(value)} />}>
          <Textarea
            id={id}
            rows={4}
            value={asString(value)}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            className="text-[13px]"
          />
        </FieldRow>
      )
    case 'expression':
      return (
        <FieldRow
          {...common}
          aside={
            <Tooltip content="Raw JavaScript expression. No {{ }} needed.">
              <span className="inline-flex h-4.5 items-center gap-0.5 rounded border px-1 font-mono text-[9.5px] text-muted-foreground">
                <Braces className="size-2.5" /> JS
              </span>
            </Tooltip>
          }
        >
          <CodeEditor
            language="javascript"
            value={asString(value)}
            onChange={(v) => onChange(v === '' ? undefined : v)}
            minHeight={36}
            maxHeight={180}
            placeholder={placeholder ?? 'input.value > 0'}
          />
        </FieldRow>
      )
    case 'code':
      return (
        <FieldRow {...common}>
          <CodeEditor
            language="javascript"
            value={asString(value)}
            onChange={(v) => onChange(v === '' ? undefined : v)}
            minHeight={160}
            maxHeight={440}
            lineNumbers
            placeholder={placeholder ?? 'return input;'}
          />
        </FieldRow>
      )
    case 'json':
      return <JsonField common={common} value={value} onChange={onChange} placeholder={placeholder} />
    default:
      return (
        <FieldRow {...common} aside={<ExpressionChip active={hasExpr(value)} />}>
          <Input
            id={id}
            value={asString(value)}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            className={cn('text-[13px]', hasExpr(value) && 'font-mono')}
          />
        </FieldRow>
      )
  }
}

function JsonField({
  common,
  value,
  onChange,
  placeholder,
}: {
  common: { label: string; htmlFor: string; required: boolean; description?: string | null }
  value: Json | undefined
  onChange: (v: Json | undefined) => void
  placeholder?: string
}) {
  const external = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const [text, setText] = useState(external)
  const [error, setError] = useState<string | null>(null)
  const [lastExternal, setLastExternal] = useState(external)
  if (external !== lastExternal) {
    setLastExternal(external)
    if (!error) setText(external)
  }

  return (
    <FieldRow {...common} error={error} aside={<ExpressionChip active={hasExpr(value)} />}>
      <CodeEditor
        language="json"
        value={text}
        invalid={!!error}
        minHeight={64}
        maxHeight={300}
        placeholder={placeholder ?? '{ }'}
        onChange={(t) => {
          setText(t)
          if (t.trim() === '') {
            setError(null)
            return onChange(undefined)
          }
          try {
            const parsed = JSON.parse(t) as Json
            setError(null)
            setLastExternal(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2))
            onChange(parsed)
          } catch (e) {
            if (t.includes('{{')) {
              setError(null)
              setLastExternal(t)
              onChange(t)
            } else setError((e as Error).message)
          }
        }}
      />
    </FieldRow>
  )
}

export function CasesEditor({
  cases,
  onChange,
}: {
  cases: SwitchCase[]
  onChange: (cases: SwitchCase[], change?: CasesChange) => void
}) {
  const names = cases.map((c) => c.name)
  const update = (i: number, patch: Partial<SwitchCase>, change?: CasesChange) =>
    onChange(
      cases.map((c, j) => (j === i ? { ...c, ...patch } : c)),
      change,
    )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Cases</Label>
        <span className="text-[11px] text-muted-foreground">First match wins · falls back to default</span>
      </div>
      {cases.length === 0 && (
        <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
          No cases. Every item goes to <span className="font-mono">default</span>.
        </p>
      )}
      {cases.map((c, i) => {
        const dup = names.indexOf(c.name) !== i
        const invalid = !c.name || c.name === 'default' || c.name === 'error' || dup
        return (
          <div key={i} className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
            <div className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-sky-500/15 text-[10px] font-semibold text-sky-700 tabular-nums dark:text-sky-300">
                {i + 1}
              </span>
              <CaseNameInput
                value={c.name}
                invalid={invalid}
                onCommit={(name) => {
                  if (name !== c.name) update(i, { name }, { rename: { from: c.name, to: name } })
                }}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove case ${c.name}`}
                onClick={() => onChange(cases.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
            <CodeEditor
              language="javascript"
              value={c.expression}
              onChange={(v) => update(i, { expression: v }, { coalesceKey: `case:${i}` })}
              minHeight={34}
              maxHeight={120}
              placeholder="input.type === 'order'"
            />
          </div>
        )
      })}
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={() => {
          let n = cases.length + 1
          while (names.includes(`case${n}`)) n++
          onChange([...cases, { name: `case${n}`, expression: '' }])
        }}
      >
        <Plus /> Add case
      </Button>
    </div>
  )
}

function CaseNameInput({ value, invalid, onCommit }: { value: string; invalid: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [last, setLast] = useState(value)
  if (value !== last) {
    setLast(value)
    setDraft(value)
  }
  return (
    <Input
      value={draft}
      aria-invalid={invalid || undefined}
      aria-label="Case name"
      onChange={(e) => setDraft(e.target.value.replace(/\s+/g, '_'))}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="h-7 font-mono text-xs"
    />
  )
}
