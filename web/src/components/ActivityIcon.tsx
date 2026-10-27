import { createElement } from 'react'
import type { ActivityDescriptor } from '@/api/types'
import { activityIcon, categoryTone } from '@/lib/activityMeta'
import { cn } from '@/lib/utils'

export function ActivityIcon({
  descriptor,
  type,
  className,
  size = 'md',
}: {
  descriptor?: ActivityDescriptor
  type: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const tone = categoryTone(descriptor?.category ?? (type.startsWith('trigger.') ? 'Triggers' : 'General'))
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg',
        tone.icon,
        size === 'sm' && 'size-6 rounded-md [&_svg]:size-3.5',
        size === 'md' && 'size-8 [&_svg]:size-4',
        size === 'lg' && 'size-10 [&_svg]:size-5',
        className,
      )}
    >
      {createElement(activityIcon(type, descriptor?.icon), { strokeWidth: 2 })}
    </span>
  )
}
