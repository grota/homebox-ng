import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
