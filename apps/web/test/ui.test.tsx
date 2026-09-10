import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { cn, Button, Card, Badge, Field, Input, PageHeader, Select } from '../src/ui'

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

describe('Field', () => {
  it('associates its label with the control so getByLabelText works', () => {
    render(
      <Field label="Name" htmlFor="item-name">
        <Input id="item-name" defaultValue="Lamp" />
      </Field>,
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Lamp')
  })

  it('marks a required field in the label text', () => {
    render(
      <Field label="Serial" htmlFor="serial" required>
        <Input id="serial" />
      </Field>,
    )
    expect(screen.getByText('Serial *')).toBeInTheDocument()
  })
})

describe('Input', () => {
  it('forwards value and onChange', () => {
    const onChange = vi.fn()
    render(<Input aria-label="q" value="a" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('q'), { target: { value: 'ab' } })
    expect(onChange).toHaveBeenCalled()
  })

  it('applies the shared input styling and merges extra classes', () => {
    render(<Input aria-label="q" className="w-full" />)
    const input = screen.getByLabelText('q')
    expect(input).toHaveClass('border-border', 'rounded-md', 'bg-surface', 'w-full')
  })
})

describe('Select', () => {
  it('renders options and forwards onChange', () => {
    render(
      <Select aria-label="type" defaultValue="1">
        <option value="1">Light</option>
        <option value="2">Tool</option>
      </Select>,
    )
    const select = screen.getByLabelText('type')
    expect(screen.getByRole('option', { name: 'Tool' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: '2' } })
    expect(select).toHaveValue('2')
  })
})

describe('Card', () => {
  it('renders children on a raised surface', () => {
    render(<Card>Body</Card>)
    const card = screen.getByText('Body')
    expect(card).toHaveClass('bg-surface', 'border-border', 'shadow-sm', 'rounded-lg')
  })
})

describe('Badge', () => {
  it('renders its label', () => {
    render(<Badge>Primary</Badge>)
    expect(screen.getByText('Primary')).toBeInTheDocument()
  })

  it('applies a user-supplied tag colour as an inline background', () => {
    render(<Badge color="#ff0000">urgent</Badge>)
    expect(screen.getByText('urgent')).toHaveStyle({ background: '#ff0000' })
  })
})

describe('PageHeader', () => {
  it('renders the title as a level-1 heading with an actions slot', () => {
    render(<PageHeader title="Items" actions={<Button>New item</Button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New item' })).toBeInTheDocument()
  })
})
