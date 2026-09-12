import { useRef, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

// The two geometries Modal serves. `md` is the box this primitive has always
// rendered, kept as one string so the default cannot drift; `full` is the
// viewer's — edge to edge, no radius/border/padding, and `overflow-hidden`
// rather than `overflow-auto` because a pan surface must not scroll (ADR-0002).
const boxes = {
  md: 'fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-[min(92vw,64rem)] max-h-[92vh] overflow-auto rounded-lg border border-border bg-surface p-4 shadow-lg',
  full: 'fixed inset-0 z-[101] overflow-hidden',
} as const

type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  // `keyof typeof boxes` is exactly `'md' | 'full'` and cannot drift from the
  // table above.
  size?: keyof typeof boxes
  children: ReactNode
}

// Radix supplies the behavior the app was faking: focus trap, Escape to close,
// focus restore to the trigger, and `aria-modal` that is actually true. Styling
// stays on our tokens.
export function Modal({ open, onOpenChange, title, size = 'md', children }: ModalProps) {
  // Radix restores focus to a `Dialog.Trigger`, but this Modal is controlled and its
  // opener lives elsewhere in the tree (ItemDetail's per-photo "Edit" button), so
  // Radix's `triggerRef` is empty and focus would fall to <body>. Remember the opener
  // here rather than making every caller wrap its button in a Trigger.
  const restoreRef = useRef<HTMLElement | null>(null)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/70" />
        <Dialog.Content
          className={boxes[size]}
          // Radix dispatches this before it moves focus into the content, so
          // `activeElement` is still the opener at this point.
          onOpenAutoFocus={() => { restoreRef.current = document.activeElement as HTMLElement | null }}
          // Radix closes on outside pointer-down by default. The image editor — the
          // consumer this primitive was written for — has a margin around the
          // content that is a live "discard my crop, rotate and text edits" target
          // with no confirmation, so the suppression stays. A full-viewport
          // consumer has no such margin to lose: the photo viewer detects a
          // background click itself instead of relying on this (ADR-0002).
          // Escape (required) stays either way; a stray click must not destroy work.
          onPointerDownOutside={(event) => event.preventDefault()}
          // Ours is composed ahead of Radix's own handler, so preventDefault suppresses
          // both the empty `triggerRef` lookup and FocusScope's fallback to <body>.
          // Leaving either in play would race our focus() below.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const opener = restoreRef.current
            if (opener?.isConnected) opener.focus()
          }}
        >
          {/* Radix requires a title for the accessible name; callers that render
              their own visible heading pass a descriptive one here. */}
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
