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
})
