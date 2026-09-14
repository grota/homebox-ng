import type { ReactNode } from 'react'
import { cn } from './cn'

// A hint that appears on hover or keyboard focus.
//
// CSS only, and deliberately no dependency: what makes a tooltip hard is its
// behaviour — open on hover *and* on focus, never take the pointer, stay out of
// the way of what it describes — and all of that is a handful of `group` classes.
// A positioning library would be earning its place if bubbles had to flip near a
// viewport edge; this app needs one hint, in one place, with room beneath it.
//
// Two details are load-bearing:
//
// `opacity-0`, not `hidden`: the bubble stays in the accessibility tree, so a
// screen reader finds the hint, and `group-focus-within` makes it appear for a
// keyboard user tabbing to the trigger.
//
// `pointer-events-none`: the bubble overlaps whatever is underneath it, and a
// hint must never swallow a click meant for that.
export function Tooltip({
  label,
  className,
  children,
}: {
  label: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-max max-w-xs rounded-md border border-border bg-surface-raised p-2 text-xs leading-relaxed text-text opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}
