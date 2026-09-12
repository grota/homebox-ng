import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ComponentProps } from 'react'

import { IncompatibleValuesDialog, type Offender } from '../src/features/itemTypes/IncompatibleValuesDialog'

// The destructive button sits behind `window.confirm`, so the spy is the second
// gate these tests drive. `restoreAllMocks` keeps a `mockReturnValue` from one
// case leaking into the next.
beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

const offenders = (count: number): Offender[] =>
  Array.from({ length: count }, (_, index) => ({ itemId: index + 1, name: `Item ${index + 1}`, value: `value ${index + 1}` }))

const defaults: ComponentProps<typeof IncompatibleValuesDialog> = {
  open: true,
  fieldName: 'size',
  targetType: 'number',
  offenders: offenders(2),
  total: 2,
  onConfirm: () => {},
  onCancel: () => {},
}

const renderDialog = (overrides: Partial<ComponentProps<typeof IncompatibleValuesDialog>> = {}) =>
  render(<IncompatibleValuesDialog {...defaults} {...overrides} />)

describe('incompatible values dialog', () => {
  // The number is the commitment, so it is stated in the prose AND on the button
  // that destroys — a bare "Clear" hides how much is about to go.
  it('states how many values cannot be read, and labels the button with the count', () => {
    renderDialog({ total: 2 })
    expect(screen.getByText(/2 stored values cannot be read as number/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear 2 values and convert' })).toBeInTheDocument()
  })

  it('reads as a single value when only one is stranded', () => {
    renderDialog({ offenders: offenders(1), total: 1 })
    expect(screen.getByText(/1 stored value cannot be read as number/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear 1 value and convert' })).toBeInTheDocument()
  })

  // The links are the point: the admin leaves to fix the offending items, so each
  // row has to carry the item's name and the value that blocked the change.
  it('links each offender to its item in a new tab', () => {
    renderDialog({ offenders: [{ itemId: 42, name: 'Hammer', value: 'big' }], total: 1 })

    const link = screen.getByRole('link', { name: 'Hammer' })
    expect(link).toHaveAttribute('href', '/items/42')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('“big”')).toBeInTheDocument()
  })

  // The list is a sample the admin judges from; the count is what the button
  // commits to, so the two have to be able to disagree.
  it('caps the rows it renders and says how many it does not show', () => {
    renderDialog({ offenders: offenders(51), total: 60 })

    expect(screen.getAllByRole('link')).toHaveLength(50)
    expect(screen.getByText('+ 10 more')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear 60 values and convert' })).toBeInTheDocument()
  })

  it('destroys nothing until the second confirmation is accepted', () => {
    const onConfirm = vi.fn()
    renderDialog({ total: 3, offenders: offenders(3), onConfirm })

    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Clear 3 values and convert' }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('3 stored values'))
    expect(onConfirm).not.toHaveBeenCalled()

    vi.mocked(window.confirm).mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clear 3 values and convert' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancels without asking for a confirmation', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    renderDialog({ onCancel, onConfirm })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
  })
})
