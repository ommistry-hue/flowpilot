import { toast } from 'sonner'
import { api, describeProblems, errorMessage, validationErrorsOf } from '@/api/client'
import type { Json } from '@/api/types'

export async function startRun(
  workflowId: string,
  opts: { input?: Json; triggerNodeId?: string; navigate?: (to: string) => void; silent?: boolean } = {},
): Promise<string | null> {
  try {
    const { runId } = await api.runWorkflow(workflowId, { input: opts.input, triggerNodeId: opts.triggerNodeId })
    if (!opts.silent) {
      toast.success('Run started', {
        description: runId.slice(0, 8),
        action: opts.navigate ? { label: 'View run', onClick: () => opts.navigate?.(`/runs/${runId}`) } : undefined,
      })
    }
    return runId
  } catch (e) {
    const problems = validationErrorsOf(e)
    if (problems) {
      toast.error(`Run blocked: ${problems.length} problem${problems.length === 1 ? '' : 's'} in the draft`, {
        description: <span className="whitespace-pre-line">{describeProblems(problems)}</span>,
        action: opts.navigate ? { label: 'Open designer', onClick: () => opts.navigate?.(`/workflows/${workflowId}`) } : undefined,
      })
      return null
    }
    toast.error('Could not start run', { description: errorMessage(e) })
    return null
  }
}
