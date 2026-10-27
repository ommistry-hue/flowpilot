import { FileJson, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { WorkflowDefinition } from '@/api/types'
import { parseDefinition } from '@/lib/definition'
import { CodeEditor } from '@/components/code/CodeEditor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'

export function ImportDialog({
  open,
  onOpenChange,
  title = 'Import workflow',
  description = 'Paste a WorkflowDefinition JSON or choose a file.',
  confirmLabel = 'Import',
  initialText = '',
  pending,
  onImport,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title?: string
  description?: string
  confirmLabel?: string
  initialText?: string
  pending?: boolean
  onImport: (def: WorkflowDefinition) => void
}) {
  const [text, setText] = useState(initialText)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setText(initialText)
      setError(null)
    }
  }

  const submit = () => {
    try {
      onImport(parseDefinition(text))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader title={title} description={description} icon={<FileJson />} />
        <DialogBody className="space-y-3">
          <CodeEditor
            language="json"
            value={text}
            onChange={(v) => {
              setText(v)
              setError(null)
            }}
            height={360}
            lineNumbers
            invalid={!!error}
            placeholder='{ "name": "…", "nodes": [], "edges": [] }'
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter className="justify-between">
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) setText(await f.text())
                e.target.value = ''
              }}
            />
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload /> Choose file
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!text.trim() || pending}>
              {confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
