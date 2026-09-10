import type { HTMLAttributes } from 'react'
import { hexColor } from '@homebox/shared'
import { cn } from './cn'

// `color` is a user-chosen tag colour (arbitrary data), so it becomes an inline
// background rather than a class. Everything else comes from the tokens.
//
// The hex check is defence in depth, not the fix (`hexColor` on `tagInput` is):
// rows written before that validation existed would otherwise still paint
// whatever they hold. A non-hex value is ignored rather than sanitised.
//
// `Omit<..., 'color'>` is load-bearing: React's `HTMLAttributes` already declares
// `color?: string`, and intersecting that with `color?: string | null` narrows the
// prop to `string | undefined` — so callers could never pass the null a tag
// actually carries (`<Badge color={tag.color}>` failed to typecheck).
export function Badge({ color, className, ...rest }: Omit<HTMLAttributes<HTMLSpanElement>, 'color'> & { color?: string | null }) {
  return (
    <span
      className={cn('inline-block rounded px-1.5 py-0.5 text-xs', className)}
      style={color && hexColor.test(color) ? { background: color } : undefined}
      {...rest}
    />
  )
}
