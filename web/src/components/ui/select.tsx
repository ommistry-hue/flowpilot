import { Select as S } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: ReactNode
}

const EMPTY = '__empty__'

interface SelectProps {
  value: string
  onValueChange: (v: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  size?: 'default' | 'sm'
  disabled?: boolean
  id?: string
  ariaLabel?: string
}

export function Select({ value, onValueChange, options, placeholder, className, size = 'default', disabled, id, ariaLabel }: SelectProps) {
  return (
    <S.Root
      value={value === '' ? EMPTY : value}
      onValueChange={(v) => onValueChange(v === EMPTY ? '' : v)}
      disabled={disabled}
    >
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-sm shadow-soft outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-50 data-[placeholder]:text-muted-foreground',
          size === 'sm' ? 'h-7 text-xs' : 'h-8',
          className,
        )}
      >
        <span className="truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronDown className="size-3.5 opacity-60" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-[90] max-h-72 min-w-[var(--radix-select-trigger-width)] animate-fade-in overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-elevated"
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value || EMPTY}
                value={o.value === '' ? EMPTY : o.value}
                className="relative flex h-7 cursor-default items-center rounded-md pr-7 pl-2 text-sm outline-none select-none data-[highlighted]:bg-accent data-[disabled]:opacity-50"
              >
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="absolute right-2">
                  <Check className="size-3.5" />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}
