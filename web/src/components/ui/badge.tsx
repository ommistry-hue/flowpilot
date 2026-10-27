import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary-soft text-primary-soft-foreground',
        outline: 'border-border text-muted-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success: 'border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
        danger: 'border-transparent bg-red-500/12 text-red-700 dark:text-red-300',
        warning: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
        info: 'border-transparent bg-sky-500/12 text-sky-700 dark:text-sky-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
