export function AiSetupHint({ error }: { error?: string }) {
  return (
    <div className="space-y-2.5 text-sm">
      <p className="text-muted-foreground">
        {error ? `AI status unavailable: ${error}` : 'AI generation is disabled. Configure a provider on the server and restart it:'}
      </p>
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2.5 font-mono text-[12px] leading-relaxed">
        <span className="text-muted-foreground"># Anthropic (default)</span>
        {'\n'}FlowPilot__AI__ApiKey=sk-ant-...{'\n'}
        <span className="text-muted-foreground"># optional</span>
        {'\n'}FlowPilot__AI__Provider=anthropic   <span className="text-muted-foreground"># or openai</span>
        {'\n'}FlowPilot__AI__Model=claude-sonnet-5-5{'\n'}FlowPilot__AI__BaseUrl=https://openrouter.ai/api/v1
      </pre>
    </div>
  )
}
