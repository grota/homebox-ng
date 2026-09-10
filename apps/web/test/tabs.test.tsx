import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Tabs } from '../src/ui/Tabs'

const items = [
  { id: 'users', label: 'Users' },
  { id: 'settings', label: 'Settings' },
]

describe('Tabs', () => {
  it('exposes a tablist with the active tab selected', () => {
    render(<Tabs value="users" onValueChange={() => {}} items={items}>Panel</Tabs>)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'false')
  })

  // A wrapper that dropped `{children}` or hardcoded the panel's `value` passes
  // every other assertion in this file — the tablist is all they look at.
  it('renders its children inside the panel', () => {
    render(
      <Tabs value="users" onValueChange={() => {}} items={items}>
        <p>Users panel</p>
      </Tabs>,
    )
    expect(within(screen.getByRole('tabpanel')).getByText('Users panel')).toBeInTheDocument()
  })

  // A tablist with no accessible name is announced as a bare "tab list"; a page
  // with more than one of them (or a screen-reader user landing on it out of
  // context) cannot tell which it is.
  it('names the tablist when given a label', () => {
    render(
      <Tabs value="users" onValueChange={() => {}} items={items} ariaLabel="Admin sections">
        Panel
      </Tabs>,
    )
    expect(screen.getByRole('tablist', { name: 'Admin sections' })).toBeInTheDocument()
  })

  it('reports a change when another tab is clicked', () => {
    const onValueChange = vi.fn()
    render(<Tabs value="users" onValueChange={onValueChange} items={items}>Panel</Tabs>)
    // Radix activates on `mousedown` (TabsTrigger's own handler), which is what a
    // real browser dispatches before `click` — `fireEvent.click` alone sends only
    // the click event, so the trigger would never activate.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }))
    expect(onValueChange).toHaveBeenCalledWith('settings')
  })

  it('moves selection with the arrow keys', async () => {
    const onValueChange = vi.fn()
    render(<Tabs value="users" onValueChange={onValueChange} items={items}>Panel</Tabs>)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Users' }), { key: 'ArrowRight' })
    // The roving focus group moves focus from a `setTimeout`, and the trigger's
    // `onFocus` is what activates it, so the change lands a tick later.
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith('settings'))
  })
})
