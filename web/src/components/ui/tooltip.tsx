import { Tooltip as T } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const TooltipProvider = T.Provider

export function Tooltip({
  content,
  children,
  side = 'top',
  className,
  delay,
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
  delay?: number
}) {
  if (!content) return <>{children}</>
  return (
    <T.Root delayDuration={delay}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-[100] max-w-xs animate-fade-in rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-elevated',
            className,
          )}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
