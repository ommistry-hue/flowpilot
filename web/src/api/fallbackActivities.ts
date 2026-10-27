import type { ActivityDescriptor, ActivityInput, InputKind, Json } from './types'

function input(
  name: string,
  displayName: string,
  kind: InputKind,
  extra: Partial<Omit<ActivityInput, 'name' | 'displayName' | 'kind'>> = {},
): ActivityInput {
  return { name, displayName, kind, required: false, options: null, defaultValue: null, ...extra }
}

function activity(
  type: string,
  displayName: string,
  category: string,
  icon: string,
  description: string,
  outcomes: string[],
  inputs: ActivityInput[],
  flags: { isTrigger?: boolean; dynamicOutcomes?: boolean } = {},
): ActivityDescriptor {
  return {
    type,
    displayName,
    category,
    icon,
    description,
    outcomes,
    inputs,
    isTrigger: flags.isTrigger ?? false,
    dynamicOutcomes: flags.dynamicOutcomes ?? false,
  }
}

const req = { required: true }
const def = (defaultValue: Json) => ({ defaultValue })

/** Mirrors docs/SPEC.md section 2. Used only when /api/activities is unreachable. */
export const FALLBACK_ACTIVITIES: ActivityDescriptor[] = [
  activity('trigger.manual', 'Manual trigger', 'Triggers', 'play', 'Start the workflow from the UI or API.', ['done'], [
    input('inputSchema', 'Input schema', 'Json', { description: 'Optional JSON schema for the run input.' }),
  ], { isTrigger: true }),
  activity('trigger.webhook', 'Webhook', 'Triggers', 'webhook', 'Start when an HTTP request hits /hooks/{path}.', ['done'], [
    input('path', 'Path', 'Text', { ...req, description: 'Served at /hooks/{path}' }),
    input('method', 'Method', 'Select', { options: ['GET', 'POST', 'PUT', 'ANY'], ...def('POST') }),
  ], { isTrigger: true }),
  activity('trigger.cron', 'Schedule', 'Triggers', 'clock', 'Run on a cron schedule (published workflows only).', ['done'], [
    input('cron', 'Cron expression', 'Text', { ...req, description: 'Cronos syntax, seconds optional', ...def('0 */5 * * * *') }),
    input('timezone', 'Timezone', 'Text', { description: 'IANA zone, e.g. Europe/Berlin' }),
  ], { isTrigger: true }),
  activity('trigger.event', 'Event', 'Triggers', 'radio', 'Start when POST /api/events/{event} is called.', ['done'], [
    input('event', 'Event name', 'Text', req),
  ], { isTrigger: true }),
  activity('condition', 'Condition', 'Logic', 'git-branch', 'Branch on a JavaScript expression.', ['true', 'false'], [
    input('expression', 'Expression', 'Expression', { ...req, description: 'Raw JS, e.g. input.total > 100' }),
  ]),
  activity('switch', 'Switch', 'Logic', 'split', 'Route to the first case whose expression is true.', ['default'], [
    input('cases', 'Cases', 'Json', { ...def([]) }),
  ], { dynamicOutcomes: true }),
  activity('loop.forEach', 'For each', 'Flow', 'repeat', 'Iterate over a list. Connect the body back to this node.', ['item', 'done'], [
    input('items', 'Items', 'Expression', { ...req, description: 'Expression returning an array' }),
  ]),
  activity('flow.parallel', 'Parallel', 'Flow', 'git-fork', 'Pass-through. Draw several edges to fan out.', ['done'], []),
  activity('flow.join', 'Join', 'Flow', 'merge', 'Wait for incoming branches.', ['done'], [
    input('mode', 'Mode', 'Select', { options: ['all', 'any'], ...def('all') }),
  ]),
  activity('delay', 'Delay', 'Timing', 'timer', 'Pause for a duration or until a time.', ['done'], [
    input('durationMs', 'Duration (ms)', 'Number', def(1000)),
    input('until', 'Until (ISO)', 'Text'),
  ]),
  activity('wait.event', 'Wait for event', 'Timing', 'hourglass', 'Suspend until a matching event arrives.', ['done'], [
    input('event', 'Event name', 'Text', req),
    input('correlationKey', 'Correlation key', 'Text', req),
  ]),
  activity('approval', 'Approval', 'Human', 'user-check', 'Suspend until a person approves or rejects.', ['approved', 'rejected'], [
    input('title', 'Title', 'Text', req),
    input('description', 'Description', 'Multiline'),
    input('assignee', 'Assignee', 'Text'),
  ]),
  activity('variable.set', 'Set variable', 'Data', 'variable', 'Set a run variable.', ['done'], [
    input('name', 'Name', 'Text', req),
    input('value', 'Value', 'Text'),
  ]),
  activity('script', 'Script', 'Data', 'code', 'Run JavaScript in a sandbox and return a value.', ['done'], [
    input('code', 'Code', 'Code', { ...req, ...def('return input;') }),
  ]),
  activity('log', 'Log', 'Data', 'scroll-text', 'Write a message into the node output.', ['done'], [
    input('message', 'Message', 'Text', req),
    input('level', 'Level', 'Select', { options: ['Information', 'Warning', 'Error', 'Debug'], ...def('Information') }),
  ]),
  activity('http.request', 'HTTP request', 'Integration', 'globe', 'Call an HTTP endpoint. Non-2xx fails.', ['done'], [
    input('url', 'URL', 'Text', req),
    input('method', 'Method', 'Select', { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], ...def('GET') }),
    input('headers', 'Headers', 'Json'),
    input('body', 'Body', 'Multiline'),
    input('timeoutMs', 'Timeout (ms)', 'Number'),
  ]),
  activity('ai.prompt', 'AI prompt', 'AI', 'sparkles', 'Call the configured LLM provider.', ['done'], [
    input('prompt', 'Prompt', 'Multiline', req),
    input('system', 'System prompt', 'Multiline'),
    input('model', 'Model', 'Text'),
    input('json', 'JSON output', 'Boolean', def(false)),
  ]),
]
