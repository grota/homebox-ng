import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { Popover } from '../src/ui'

// The panel's dismissal, focus and Escape come from Radix (ADR-0008). What is
// ours — and therefore what this pins — is the wiring: the trigger reports whether
// the panel is open, the panel carries an accessible name, and the content is
// really gone from the tree when closed rather than merely hidden.
function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange?.(next)
      }}
      title="Add to selection criteria"
      trigger={<button type="button">Add to selection</button>}
    >
      <p>panel body</p>
    </Popover>
  )
}

describe('Popover', () => {
  it('opens from its trigger, and names the panel', () => {
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Add to selection' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('panel body')).not.toBeInTheDocument()

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('panel body')).toBeInTheDocument()
    // An accessible name, because these panels are forms with no visible heading.
    expect(screen.getByLabelText('Add to selection criteria')).toBeInTheDocument()
  })

  it('reports dismissal, so the caller owns the open state', () => {
    const onOpenChange = vi.fn()
    render(<Harness onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add to selection' }))

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  // Escape is the keyboard route out of a panel whose trigger may be off screen.
  it('closes on Escape', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to selection' }))

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(screen.queryByText('panel body')).not.toBeInTheDocument()
  })
})
