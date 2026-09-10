import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Modal } from '../src/ui/Modal'
import { Button } from '../src/ui'

describe('Modal', () => {
  it('renders its content while open', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Edit photo">
        <p>Editor</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Edit photo' })).toBeInTheDocument()
    expect(screen.getByText('Editor')).toBeInTheDocument()
  })

  it('renders nothing while closed', () => {
    render(
      <Modal open={false} onOpenChange={() => {}} title="Edit photo">
        <p>Editor</p>
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('calls onOpenChange(false) when Escape is pressed', async () => {
    const onOpenChange = vi.fn()
    render(
      <Modal open onOpenChange={onOpenChange} title="Edit photo">
        <Button>Inside</Button>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    // Exactly once: a double close is the risk this branch took Radix on to
    // remove — a second `false` would run the caller's `onClose` twice. The
    // `toHaveBeenCalledWith` above cannot see it.
    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })

  // Radix closes on outside pointer-down by default. For an unsaved-work editor
  // that is a silent discard, so Modal suppresses it deliberately — this fails
  // the moment the `onPointerDownOutside` handler is dropped.
  it('stays open on an outside pointer-down', async () => {
    const onOpenChange = vi.fn()
    render(
      <Modal open onOpenChange={onOpenChange} title="Edit photo">
        <p>Editor</p>
      </Modal>,
    )
    // Radix attaches its outside-pointerdown listener from a `setTimeout`, so the
    // sequence has to land after a tick or it is never heard. And it defers the
    // dismissal to the *click* that confirms the gesture, so a bare pointerdown
    // is not enough to reproduce the behaviour being suppressed.
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Edit photo' })).toBeInTheDocument())
    fireEvent.pointerDown(document.body, { button: 0 })
    fireEvent.pointerUp(document.body, { button: 0 })
    fireEvent.click(document.body)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Edit photo' })).toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  // The opener is a sibling of the modal, not a `Dialog.Trigger`, so Radix has no
  // trigger to restore focus to. This is the behaviour Modal has to own itself.
  it('restores focus to the previously focused element on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Opener</Button>
          <Modal open={open} onOpenChange={setOpen} title="Edit photo">
            <p>Editor</p>
          </Modal>
        </>
      )
    }
    render(<Harness />)

    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    expect(opener).toHaveFocus()

    fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Edit photo' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Radix dispatches its unmount autofocus from a setTimeout, so this lands late.
    await waitFor(() => expect(opener).toHaveFocus())
  })

  // The shape production actually uses: PhotoEditor early-returns `null` when
  // `!open`, so the whole `Modal` unmounts rather than staying mounted with its
  // content removed. The test above keeps `Modal` mounted throughout, so it
  // would not catch a restore that only works on Radix's own close path.
  it('restores focus when the Modal itself unmounts', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Opener</Button>
          {open && (
            <Modal open onOpenChange={setOpen} title="Edit photo">
              <p>Editor</p>
            </Modal>
          )}
        </>
      )
    }
    render(<Harness />)

    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    expect(opener).toHaveFocus()

    fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Edit photo' })).toBeInTheDocument()
    // Radix moves focus into the dialog, so the opener genuinely loses it here —
    // without this the restore assertion below could pass without anything to
    // restore from.
    await waitFor(() => expect(opener).not.toHaveFocus())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })
})
