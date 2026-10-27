import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const inputClass =
  'flex h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm shadow-soft outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClass, 'h-auto min-h-20 resize-y py-2 leading-relaxed', className)} {...props} />
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-xs font-medium text-foreground/90 select-none', className)} {...props} />
}
