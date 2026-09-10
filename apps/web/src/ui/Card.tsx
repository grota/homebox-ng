import type { HTMLAttributes } from 'react'
import { cn } from './cn'

// Padding is a prop, not a class the caller overrides: Tailwind emits
// same-property utilities in scale order, so a caller's `p-0` loses to the
// `p-4` here no matter what order the classes appear in. `md` is the old
// hardcoded value; `none` is for cards whose content is flush (an image card),
// `sm` for dense tiles.
const paddings = { none: 'p-0', sm: 'p-2', md: 'p-4' } as const

export type CardProps = HTMLAttributes<HTMLDivElement> & { padding?: keyof typeof paddings }

export function Card({ padding = 'md', className, ...rest }: CardProps) {
  return (
    <div className={cn('bg-surface border border-border rounded-lg shadow-sm', paddings[padding], className)} {...rest} />
  )
}
