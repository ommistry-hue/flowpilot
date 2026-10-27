import { Loader2, Play } from 'lucide-react'
import { useState } from 'react'
import type { Json } from '@/api/types'
import { CodeEditor } from '@/components/code/CodeEditor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Label } from '@/components/ui/input'
import { Kbd } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { modKey } from '@/lib/utils'

export function RunDialog({
  open,
  onOpenChange,
  triggers,
  dirty,
  onRun,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  triggers: { id: string; label: string }[]
  dirty: boolean
  onRun: (input: Json | undefined, triggerNodeId: string | undefined) => Promise<boolean>
}) {
  const [text, setText] = useState('{\n  \n}')
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState('')
  const [pending, setPending] = useState(false)
  const triggerId = trigger || triggers[0]?.id || ''

  const submit = async () => {
    let input: Json | undefined
    const t = text.trim()
    if (t && t !== '{}' && t.replace(/\s/g, '') !== '{}') {
      try {
        input = JSON.parse(t) as Json
      } catch (e) {
        setError(`Invalid JSON: ${(e as Error).message}`)
        return
      }
    }
    setPending(true)
    const ok = await onRun(input, triggers.length > 1 ? triggerId : undefined)
    setPending(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title="Run workflow"
          description={dirty ? 'Unsaved changes will be saved first. The run uses the current draft.' : 'The run uses the current draft.'}
          icon={<Play />}
        />
        <DialogBody className="space-y-4">
          {triggers.length > 1 && (
            <div className="space-y-1.5">
              <Label>Trigger</Label>
              <Select value={triggerId} onValueChange={setTrigger} options={triggers.map((t) => ({ value: t.id, label: t.label }))} />
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Input (optional JSON)</Label>
              <span className="text-[11px] text-muted-foreground">
                Available as <code className="font-mono">input</code> and <code className="font-mono">trigger</code>
              </span>
            </div>
            <CodeEditor
              language="json"
              value={text}
              invalid={!!error}
              onChange={(v) => {
                setText(v)
                setError(null)
              }}
              height={220}
              lineNumbers
              onSubmit={() => void submit()}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter className="justify-between">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Kbd>{modKey}</Kbd>
            <Kbd>Enter</Kbd> to run
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={pending || triggers.length === 0}>
              {pending ? <Loader2 className="animate-spin" /> : <Play />} Start run
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
