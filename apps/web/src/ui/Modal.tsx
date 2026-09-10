import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}

// Radix supplies the behavior the app was faking: focus trap, Escape to close,
// focus restore to the trigger, and `aria-modal` that is actually true. Styling
// stays on our tokens.
export function Modal({ open, onOpenChange, title, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-[min(92vw,64rem)] max-h-[92vh] overflow-auto rounded-lg border border-border bg-surface p-4 shadow-lg">
          {/* Radix requires a title for the accessible name; callers that render
              their own visible heading pass a descriptive one here. */}
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
