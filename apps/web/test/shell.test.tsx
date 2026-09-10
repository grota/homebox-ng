import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// The active user's role, mutable so the admin nav item can be toggled.
let mockRole: string = 'user'

// `Shell` now reads the current user via `useAuth`, so mock the tRPC module
// (auth.me) — otherwise the real client would attempt a network call.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      auth: {
        me: { useQuery: () => ({ data: { id: 1, email: 'a@b.co', name: 'A', role: mockRole }, isLoading: false }) },
      },
    },
  }
})

import { Shell } from '../src/app/Shell'

describe('Shell', () => {
  beforeEach(() => {
    mockRole = 'user'
  })

  it('renders a hamburger drawer toggle for narrow viewports', () => {
    render(<MemoryRouter><Shell /></MemoryRouter>)
    expect(screen.getByTestId('drawer-toggle')).toBeInTheDocument()
  })

  it('shows the Admin nav link to an admin', () => {
    mockRole = 'admin'
    render(<MemoryRouter><Shell /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'nav.admin' })).toBeInTheDocument()
  })

  it('hides the Admin nav link from a non-admin', () => {
    mockRole = 'user'
    render(<MemoryRouter><Shell /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: 'nav.admin' })).not.toBeInTheDocument()
  })

  // Named for what it actually checks. This render has no route, so `<Outlet/>`
  // renders nothing and no content assertion is possible here — the class list
  // IS the subject. `w-full` is included because it is what makes `mx-auto`
  // centre the container rather than a shrink-wrapped box.
  it('gives the content container the centred max-width shell classes', () => {
    render(<MemoryRouter><Shell /></MemoryRouter>)
    const content = screen.getByTestId('content')
    expect(content).toHaveClass('mx-auto', 'max-w-6xl', 'px-4', 'w-full', 'py-6')
  })
})
