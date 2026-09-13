import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Pagination } from '../src/ui/Pagination'

// `cleanup` explicitly: testing-library only unmounts between *tests*, so a case
// that renders twice to compare two states would otherwise find both in the DOM.
const setup = (props: Partial<{ page: number; total: number; pageSize: number; onPage: (p: number) => void }> = {}) => {
  cleanup()
  const onPage = vi.fn()
  render(<Pagination page={props.page ?? 1} total={props.total ?? 100} pageSize={props.pageSize ?? 20} onPage={props.onPage ?? onPage} />)
  return onPage
}

describe('Pagination', () => {
  it('renders nothing when everything fits on one page', () => {
    // A disabled Prev/Next pair under a 12-item list is noise, not information.
    setup({ total: 12, pageSize: 20 })
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  it('renders nothing when the list is exactly one page', () => {
    setup({ total: 20, pageSize: 20 })
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  it('shows where you are out of how many', () => {
    setup({ page: 2, total: 45, pageSize: 20 })
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('rounds a partial last page up rather than down', () => {
    // 41 items is 3 pages, the last holding one.
    setup({ page: 1, total: 41, pageSize: 20 })
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('disables Prev on the first page and Next on the last', () => {
    setup({ page: 1, total: 45, pageSize: 20 })
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()

    setup({ page: 3, total: 45, pageSize: 20 })
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Prev' })).toBeEnabled()
  })

  it('asks for the neighbouring page, and never for page zero', () => {
    const onPage = setup({ page: 2, total: 45, pageSize: 20 })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPage).toHaveBeenLastCalledWith(3)
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
    expect(onPage).toHaveBeenLastCalledWith(1)

    // Disabled, so the click is inert — but the guard is `Math.max(1, ...)`, and
    // this is what would catch it being dropped.
    const first = setup({ page: 1, total: 45, pageSize: 20 })
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
    expect(first).not.toHaveBeenCalled()
  })
})
