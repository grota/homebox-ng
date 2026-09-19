import type { ReactNode } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'

// An anchored panel: tied to the control that opened it, dismissed by clicking
// away or pressing Escape, and never the only thing on screen (ADR-0008).
//
// This is deliberately **not** a third `Modal` geometry. ADR-0002 says a third
// geometry means stop widening `Modal` and decompose instead, and an anchored
// panel is a different interaction rather than another shape of the same one: a
// `Modal` takes the viewport and must be dealt with, while this sits next to the
// button the user is still looking at. `Modal` keeps its two geometries.
//
// Radix supplies what ADR-0001 adopted it for and what is expensive to re-derive:
// outside-click dismissal, Escape, focus trap and restore, `aria-expanded` on the
// trigger and the wiring between them.
const panel =
  // `md` and up: anchored, the ordinary popover.
  'z-[101] w-[min(92vw,28rem)] max-h-[min(70vh,32rem)] overflow-auto rounded-lg border border-border bg-surface p-4 shadow-lg ' +
  // Below `md`: the viewport. These need `!` because Radix positions the content
  // with *inline* styles from its collision-aware floating logic, and an inline
  // style outranks a class — `!important` is the only thing that beats it. The
  // alternative is a second component for phones, which is the duplication
  // ADR-0008 rejected.
  'max-md:!fixed max-md:!inset-0 max-md:!w-auto max-md:!max-w-none max-md:!max-h-none max-md:!transform-none max-md:!rounded-none'

type PopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The accessible name. There is no visible heading in these panels — they are
  // forms, and a heading would be a third line of chrome above them.
  title: string
  // The control the panel is anchored to. Must be a single element; Radix clones
  // it to wire `aria-expanded`/`aria-controls` and to position against it.
  trigger: ReactNode
  children: ReactNode
}

export function Popover({ open, onOpenChange, title, trigger, children }: PopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className={panel} aria-label={title} align="start" sideOffset={4}>
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
