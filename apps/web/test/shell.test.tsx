import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { Shell } from '../src/app/Shell'

describe('Shell', () => {
  it('renders a hamburger drawer toggle for narrow viewports', () => {
    render(<MemoryRouter><Shell /></MemoryRouter>)
    expect(screen.getByTestId('drawer-toggle')).toBeInTheDocument()
  })
})
