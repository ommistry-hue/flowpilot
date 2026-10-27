import { Braces, Download } from 'lucide-react'
import { useState } from 'react'
import type { WorkflowDefinition } from '@/api/types'
import { CodeEditor } from '@/components/code/CodeEditor'
import { parseDefinition } from '@/lib/definition'
import { CopyButton } from '@/components/JsonViewer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { downloadJson, slugify } from '@/lib/utils'

export function JsonDialog({
  open,
  onOpenChange,
  definition,
  readOnly,
  onApply,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  definition: WorkflowDefinition
  readOnly?: boolean
  onApply: (def: WorkflowDefinition) => void
}) {
  const original = JSON.stringify(definition, null, 2)
  const [text, setText] = useState(original)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setText(original)
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader
          title="Workflow JSON"
          description="The exact WorkflowDefinition sent to the server. Edit and apply, or paste another definition."
          icon={<Braces />}
        />
        <DialogBody className="space-y-2">
          <CodeEditor
            language="json"
            value={text}
            readOnly={readOnly}
            invalid={!!error}
            onChange={(v) => {
              setText(v)
              setError(null)
            }}
            height="min(60vh, 560px)"
            lineNumbers
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter className="justify-between">
          <div className="flex items-center gap-1">
            <CopyButton text={text} className="size-8" />
            <Button variant="ghost" onClick={() => downloadJson(`${slugify(definition.name)}.json`, JSON.parse(original))}>
              <Download /> Download
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {!readOnly && (
              <Button
                disabled={text === original}
                onClick={() => {
                  try {
                    onApply(parseDefinition(text))
                    onOpenChange(false)
                  } catch (e) {
                    setError((e as Error).message)
                  }
                }}
              >
                Apply to canvas
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
