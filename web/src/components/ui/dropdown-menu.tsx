import { DropdownMenu as D } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const DropdownMenu = D.Root
export const DropdownMenuTrigger = D.Trigger

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Content
        sideOffset={sideOffset}
        className={cn(
          'z-[90] min-w-44 animate-fade-in overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-elevated',
          className,
        )}
        {...props}
      />
    </D.Portal>
  )
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof D.Item> & { destructive?: boolean }) {
  return (
    <D.Item
      className={cn(
        'relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground',
        destructive && 'text-destructive data-[highlighted]:bg-destructive/10 [&_svg]:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof D.Separator>) {
  return <D.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof D.Label>) {
  return <D.Label className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />
}
