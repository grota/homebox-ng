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
})
