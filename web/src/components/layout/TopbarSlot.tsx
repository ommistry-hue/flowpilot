import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { TopbarSlotContext } from './topbarContext'

export function TopbarPortal({ children }: { children: ReactNode }) {
  const el = useContext(TopbarSlotContext)
  return el ? createPortal(children, el) : null
}
