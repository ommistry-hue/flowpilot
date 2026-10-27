import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({
  className,
  children,
  hideClose,
  ...props
}: ComponentProps<typeof D.Content> & { hideClose?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-[80] animate-fade-in bg-black/40 backdrop-blur-[2px]" />
      <D.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-[80] flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 animate-zoom-in flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-elevated outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <D.Close
            className="absolute top-3.5 right-3.5 rounded-md p-1 text-muted-foreground opacity-70 outline-none transition hover:bg-accent hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label="Close"
          >
            <X className="size-4" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  )
}

export function DialogHeader({
  title,
  description,
  icon,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-3 border-b px-5 pt-4 pb-3.5', className)}>
      {icon && (
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground [&_svg]:size-4">
          {icon}
        </div>
      )}
      <div className="min-w-0 pr-6">
        <D.Title className="text-[15px] font-semibold tracking-tight">{title}</D.Title>
        {description ? (
          <D.Description className="mt-0.5 text-[13px] text-muted-foreground">{description}</D.Description>
        ) : (
          <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>
        )}
      </div>
    </div>
  )
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin', className)} {...props} />
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex items-center justify-end gap-2 border-t bg-muted/40 px-5 py-3', className)} {...props} />
  )
}
