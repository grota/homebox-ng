import type { HTMLAttributes } from 'react'
import { cn } from './cn'

// `color` is a user-chosen tag colour (arbitrary data), so it becomes an inline
// background rather than a class. Everything else comes from the tokens.
export function Badge({ color, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { color?: string | null }) {
  return (
    <span
      className={cn('inline-block rounded px-1.5 py-0.5 text-xs', className)}
      style={color ? { background: color } : undefined}
      {...rest}
    />
  )
}
