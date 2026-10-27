import {
  Bell,
  Bot,
  Box,
  Braces,
  Calendar,
  CalendarClock,
  CircleCheck,
  Clock,
  Cloud,
  Code,
  Database,
  FileText,
  Filter,
  GitBranch,
  GitFork,
  GitMerge,
  Globe,
  Hourglass,
  Layers,
  Link,
  List,
  Mail,
  Merge,
  MessageSquare,
  Play,
  Radio,
  Repeat,
  ScrollText,
  Send,
  Shuffle,
  Sparkles,
  Split,
  SquareFunction,
  Terminal,
  Timer,
  UserCheck,
  Variable,
  Webhook,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  bell: Bell,
  bot: Bot,
  box: Box,
  braces: Braces,
  calendar: Calendar,
  'calendar-clock': CalendarClock,
  'check-circle': CircleCheck,
  'circle-check': CircleCheck,
  clock: Clock,
  cloud: Cloud,
  code: Code,
  database: Database,
  'file-text': FileText,
  filter: Filter,
  'git-branch': GitBranch,
  'git-fork': GitFork,
  'git-merge': GitMerge,
  globe: Globe,
  hourglass: Hourglass,
  layers: Layers,
  link: Link,
  list: List,
  mail: Mail,
  merge: Merge,
  'message-square': MessageSquare,
  play: Play,
  radio: Radio,
  repeat: Repeat,
  'scroll-text': ScrollText,
  send: Send,
  shuffle: Shuffle,
  sparkles: Sparkles,
  split: Split,
  function: SquareFunction,
  terminal: Terminal,
  timer: Timer,
  'user-check': UserCheck,
  variable: Variable,
  webhook: Webhook,
  workflow: Workflow,
  zap: Zap,
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  'trigger.manual': Play,
  'trigger.webhook': Webhook,
  'trigger.cron': Clock,
  'trigger.event': Radio,
  condition: GitBranch,
  switch: Split,
  'loop.forEach': Repeat,
  'flow.parallel': GitFork,
  'flow.join': Merge,
  delay: Timer,
  approval: UserCheck,
  'variable.set': Variable,
  'http.request': Globe,
  script: Code,
  log: ScrollText,
  'ai.prompt': Sparkles,
  'wait.event': Hourglass,
}

function normalizeIconName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
    .replace(/-icon$/, '')
}

export function activityIcon(type: string, iconName?: string | null): LucideIcon {
  if (iconName) {
    const icon = ICONS[normalizeIconName(iconName)]
    if (icon) return icon
  }
  return TYPE_ICONS[type] ?? (type.startsWith('trigger.') ? Zap : Box)
}

export interface CategoryTone {
  icon: string
  bar: string
  dot: string
}

const TONES: Record<string, CategoryTone> = {
  amber: { icon: 'bg-amber-500/14 text-amber-600 dark:text-amber-300', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  sky: { icon: 'bg-sky-500/14 text-sky-600 dark:text-sky-300', bar: 'bg-sky-500', dot: 'bg-sky-500' },
  indigo: { icon: 'bg-indigo-500/14 text-indigo-600 dark:text-indigo-300', bar: 'bg-indigo-500', dot: 'bg-indigo-500' },
  orange: { icon: 'bg-orange-500/14 text-orange-600 dark:text-orange-300', bar: 'bg-orange-500', dot: 'bg-orange-500' },
  rose: { icon: 'bg-rose-500/14 text-rose-600 dark:text-rose-300', bar: 'bg-rose-500', dot: 'bg-rose-500' },
  emerald: { icon: 'bg-emerald-500/14 text-emerald-600 dark:text-emerald-300', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  blue: { icon: 'bg-blue-500/14 text-blue-600 dark:text-blue-300', bar: 'bg-blue-500', dot: 'bg-blue-500' },
  fuchsia: { icon: 'bg-fuchsia-500/14 text-fuchsia-600 dark:text-fuchsia-300', bar: 'bg-fuchsia-500', dot: 'bg-fuchsia-500' },
  teal: { icon: 'bg-teal-500/14 text-teal-600 dark:text-teal-300', bar: 'bg-teal-500', dot: 'bg-teal-500' },
  cyan: { icon: 'bg-cyan-500/14 text-cyan-600 dark:text-cyan-300', bar: 'bg-cyan-500', dot: 'bg-cyan-500' },
  lime: { icon: 'bg-lime-500/14 text-lime-700 dark:text-lime-300', bar: 'bg-lime-500', dot: 'bg-lime-500' },
  pink: { icon: 'bg-pink-500/14 text-pink-600 dark:text-pink-300', bar: 'bg-pink-500', dot: 'bg-pink-500' },
}

const CATEGORY_TONE: [RegExp, keyof typeof TONES][] = [
  [/trigger/i, 'amber'],
  [/logic|condition|control/i, 'sky'],
  [/flow|loop/i, 'indigo'],
  [/tim|delay|wait|schedul/i, 'orange'],
  [/human|approv|user/i, 'rose'],
  [/data|variable|script|code|util|general/i, 'emerald'],
  [/http|integration|network|web|api/i, 'blue'],
  [/\bai\b|llm|agent|intelligence/i, 'fuchsia'],
]
const FALLBACK_TONES: (keyof typeof TONES)[] = ['teal', 'cyan', 'lime', 'pink']

export function categoryTone(category: string): CategoryTone {
  for (const [re, tone] of CATEGORY_TONE) if (re.test(category)) return TONES[tone]
  let h = 0
  for (const c of category) h = (h * 31 + c.charCodeAt(0)) | 0
  return TONES[FALLBACK_TONES[Math.abs(h) % FALLBACK_TONES.length]]
}

const CATEGORY_ORDER = ['trigger', 'logic', 'flow', 'timing', 'human', 'data', 'integration', 'ai']

export function categoryRank(category: string): number {
  const c = category.toLowerCase()
  const i = CATEGORY_ORDER.findIndex((k) => c.includes(k))
  return i === -1 ? CATEGORY_ORDER.length : i
}
