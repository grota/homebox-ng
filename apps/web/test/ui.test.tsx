import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { cn, Button } from '../src/ui'

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })
})

describe('Button', () => {
  it('renders a real button with its accessible name', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('defaults to type=button so it never submits a form by accident', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
  })

  it('renders the primary variant with the accent background', () => {
    render(<Button variant="primary">Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('bg-accent')
  })

  it('renders the danger variant with the danger token, not a raw red', () => {
    render(<Button variant="danger">Delete</Button>)
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn).toHaveClass('text-danger')
    expect(btn.className).not.toMatch(/text-red-\d/)
  })

  it('passes through onClick and disabled', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick} disabled>Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
    expect(btn).toBeDisabled()
  })
})
