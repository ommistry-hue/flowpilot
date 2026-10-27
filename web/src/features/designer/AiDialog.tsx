import { useMutation } from '@tanstack/react-query'
import { ArrowUp, Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '@/api/client'
import { useAiStatus } from '@/api/hooks'
import type { AiGenerateResult, WorkflowDefinition } from '@/api/types'
import { AiSetupHint } from '@/components/AiSetupHint'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Label } from '@/components/ui/input'
import { Kbd, Skeleton, Switch } from '@/components/ui/misc'
import { modKey } from '@/lib/utils'

const EXAMPLES = [
  'When a webhook receives an order over $100, post it to Slack and log the order id',
  'Every morning at 9:00, fetch https://api.example.com/metrics and ask AI to summarize it',
  'On a support event, classify the ticket with AI and route bugs, billing and other to different HTTP endpoints',
  'Manual run that loops over input.items, calls an API for each, then waits for manager approval',
]

export function AiDialog({
  open,
  onOpenChange,
  current,
  hasContent,
  onResult,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  current: () => WorkflowDefinition
  hasContent: boolean
  onResult: (r: AiGenerateResult) => void
}) {
  const status = useAiStatus()
  const [prompt, setPrompt] = useState('')
  const [refine, setRefine] = useState<boolean | null>(null)
  const useCurrent = hasContent && (refine ?? true)
  const gen = useMutation({
    mutationFn: () => api.aiGenerate(prompt.trim(), useCurrent ? current() : undefined),
    meta: { silent: true },
    onSuccess: (r) => {
      onResult(r)
      onOpenChange(false)
    },
  })

  const submit = () => {
    if (prompt.trim().length < 4 || gen.isPending) return
    gen.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !gen.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader
          title="Generate with AI"
          description="Describe the automation. You can review the draft on the canvas before accepting it."
          icon={<Sparkles />}
          className="[&>div:first-child]:bg-gradient-to-br [&>div:first-child]:from-violet-500 [&>div:first-child]:to-fuchsia-500 [&>div:first-child]:text-white"
        />
        {status.isLoading ? (
          <DialogBody>
            <Skeleton className="h-36" />
          </DialogBody>
        ) : !status.data?.enabled ? (
          <>
            <DialogBody>
              <AiSetupHint error={status.isError ? errorMessage(status.error) : undefined} />
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => void status.refetch()}>
                Check again
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody className="space-y-4">
              <div className="rounded-xl border bg-card shadow-soft transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
                <textarea
                  autoFocus
                  value={prompt}
                  disabled={gen.isPending}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      submit()
                    }
                  }}
                  rows={4}
                  placeholder="When a new order arrives via webhook, check if the total is above 100…"
                  className="block w-full resize-none bg-transparent px-3.5 pt-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70"
                  aria-label="Prompt"
                />
                <div className="flex items-center justify-between px-3 pt-1 pb-2.5">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch checked={useCurrent} onCheckedChange={setRefine} disabled={!hasContent} />
                    Refine the current workflow
                  </label>
                  <Button size="icon-sm" className="rounded-full" aria-label="Generate" onClick={submit} disabled={prompt.trim().length < 4 || gen.isPending}>
                    {gen.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                  </Button>
                </div>
              </div>

              {gen.isPending ? (
                <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-4 text-sm">
                  <Sparkles className="size-4 animate-pulse text-primary" />
                  <span className="bg-[linear-gradient(90deg,var(--muted-foreground)_30%,var(--primary)_50%,var(--muted-foreground)_70%)] bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer">
                    Drafting your workflow with {status.data.model ?? 'the model'}…
                  </span>
                </div>
              ) : gen.isError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                  {errorMessage(gen.error)}
                </p>
              ) : (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Try an example</Label>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => setPrompt(ex)}
                        className="rounded-lg border bg-card px-3 py-2 text-left text-xs leading-relaxed text-muted-foreground outline-none transition hover:border-primary/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </DialogBody>
            <DialogFooter className="justify-between">
              <span className="text-[11px] text-muted-foreground">
                {status.data.provider} · <span className="font-mono">{status.data.model}</span>
              </span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Kbd>{modKey}</Kbd>
                <Kbd>Enter</Kbd> to generate
              </span>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
