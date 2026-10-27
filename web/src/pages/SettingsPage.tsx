import { useQueryClient } from '@tanstack/react-query'
import { Bot, CircleCheck, CircleX, Eye, EyeOff, KeyRound, Loader2, Monitor, Moon, Plug, Sun } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/api/client'
import { useAiStatus } from '@/api/hooks'
import { restartHub, useHubStatus } from '@/api/realtime'
import { APP_VERSION, GITHUB_URL, GitHubIcon, LogoMark } from '@/components/layout/Brand'
import { AiSetupHint } from '@/components/AiSetupHint'
import { Page, PageHeader } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { setApiKey, useApiKey } from '@/lib/settings'
import { useTheme, type ThemePref } from '@/lib/theme'

function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <Card className="grid gap-6 p-5 md:grid-cols-[240px_1fr]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </Card>
  )
}

export default function SettingsPage() {
  const stored = useApiKey()
  const [key, setKey] = useState(stored)
  const [show, setShow] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const qc = useQueryClient()
  const ai = useAiStatus()
  const hub = useHubStatus()
  const { pref, setTheme } = useTheme()

  const save = async () => {
    setApiKey(key.trim())
    toast.success(key.trim() ? 'API key saved' : 'API key cleared')
    await qc.invalidateQueries()
    void restartHub()
  }

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      await api.health()
      await api.stats()
      setResult({ ok: true, message: 'Connected. The API accepted your credentials.' })
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Page className="max-w-4xl">
      <PageHeader title="Settings" description="Connection, appearance and environment." />
      <div className="space-y-3">
        <Section
          title="API key"
          description={
            <>
              Required when the server sets <code className="font-mono text-xs">FlowPilot:ApiKey</code>. Stored in this
              browser only and sent as <code className="font-mono text-xs">X-Api-Key</code>.
            </>
          }
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="api-key">Key</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="api-key"
                    type={show ? 'text' : 'password'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="Not set"
                    className="pr-9 pl-8 font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide key' : 'Show key'}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
                <Button onClick={() => void save()} disabled={key === stored}>
                  Save
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => void test()} disabled={testing}>
                {testing ? <Loader2 className="animate-spin" /> : <Plug />} Test connection
              </Button>
              {result && (
                <span className={`inline-flex items-center gap-1.5 text-xs ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                  {result.ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
                  {result.message}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Realtime channel:{' '}
              <span className="font-medium text-foreground">
                {hub === 'connected' ? 'connected' : hub === 'connecting' ? 'connecting…' : 'disconnected'}
              </span>
            </p>
          </div>
        </Section>

        <Section title="AI generation" description="Generate workflows from a prompt with the configured LLM provider.">
          {ai.isLoading ? (
            <Skeleton className="h-16" />
          ) : ai.data?.enabled ? (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
              <span className="flex size-8 items-center justify-center rounded-lg bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-300">
                <Bot className="size-4" />
              </span>
              <div className="text-sm">
                <p className="font-medium">
                  Enabled <Badge variant="success" className="ml-1">{ai.data.provider ?? 'provider'}</Badge>
                </p>
                <p className="font-mono text-xs text-muted-foreground">{ai.data.model ?? 'default model'}</p>
              </div>
            </div>
          ) : (
            <AiSetupHint error={ai.isError ? errorMessage(ai.error) : undefined} />
          )}
        </Section>

        <Section title="Appearance" description="Follows your operating system by default.">
          <Tabs value={pref} onValueChange={(v) => setTheme(v as ThemePref)}>
            <TabsList>
              <TabsTrigger value="light">
                <Sun /> Light
              </TabsTrigger>
              <TabsTrigger value="dark">
                <Moon /> Dark
              </TabsTrigger>
              <TabsTrigger value="system">
                <Monitor /> System
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </Section>

        <Section title="About" description="Open-source visual workflow automation for .NET.">
          <div className="flex flex-wrap items-center gap-4">
            <LogoMark className="size-10" />
            <div className="flex-1">
              <p className="font-semibold">FlowPilot</p>
              <p className="text-xs text-muted-foreground">Web UI v{APP_VERSION}</p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GitHubIcon className="size-3.5" /> GitHub
              </a>
            </Button>
          </div>
        </Section>
      </div>
    </Page>
  )
}
