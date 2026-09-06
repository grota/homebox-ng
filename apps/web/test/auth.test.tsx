import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The authenticated user returned by `auth.me` / `auth.login`. Mutable so tests
// can toggle the forced-change flag or simulate a completed change.
type MockUser = { id: number; email: string; name: string; role: string; mustChangePassword: boolean }
let mockMe: MockUser | null = null
let mockMustChangePassword = false

// mock the tRPC module so hooks resolve deterministically without a backend
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      // A passthrough Provider so <AppProviders> (which renders <trpc.Provider>)
      // doesn't blow up under the mock.
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      // `useUtils` backs the auth pages' `auth.me.fetch()` on setup/login success
      // and `auth.me.invalidate()` on a completed password change.
      useUtils: () => ({
        auth: { me: { fetch: vi.fn(async () => mockMe), invalidate: vi.fn(async () => undefined) } },
        settings: { get: { invalidate: vi.fn(async () => undefined) } },
      }),
      auth: {
        me: { useQuery: () => ({ data: mockMe, isLoading: false }) },
        login: {
          useMutation: () => ({
            mutateAsync: vi.fn(async () => {
              const user: MockUser = { id: 1, email: 'a@b.co', name: 'A', role: 'user', mustChangePassword: mockMustChangePassword }
              mockMe = user
              return user
            }),
            isPending: false,
            error: null,
          }),
        },
        changePassword: {
          useMutation: () => ({
            mutateAsync: vi.fn(async () => {
              // The server resets the flag on a successful change.
              mockMe = { ...mockMe!, mustChangePassword: false }
              return { ok: true }
            }),
            isPending: false,
            error: null,
          }),
        },
        setup: { useMutation: () => ({ mutateAsync: vi.fn(async () => ({ id: 1 })), isPending: false, error: null }) },
      },
      // `<AppProviders>` renders `<SettingsProvider>`, which reads `settings.get`
      // and wires `settings.update`. Return `data: undefined` so the provider falls
      // back to the spec defaults (no crash for the unauthenticated view).
      settings: {
        get: { useQuery: () => ({ data: undefined, isLoading: false }) },
        update: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
      },
    },
  }
})

import { LoginPage } from '../src/features/auth/LoginPage'
import { ChangePasswordPage } from '../src/features/auth/ChangePasswordPage'
import { AppProviders } from '../src/app/AppProviders'

// Renders the auth-related routes under a MemoryRouter so we can assert on the
// navigation that `LoginPage` / `ChangePasswordPage` perform (which needs a real
// <Routes> tree, unlike the bare `<LoginPage/>` render below).
function renderAuthRoutes(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/" element={<div data-testid="home">HOME</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('auth pages', () => {
  beforeEach(() => {
    mockMe = null
    mockMustChangePassword = false
  })

  it('renders login form and submits credentials', async () => {
    render(<AppProviders><LoginPage /></AppProviders>)
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/signed in/i)).toBeInTheDocument()
  })

  it('routes a forced-password login to /change-password', async () => {
    mockMustChangePassword = true
    renderAuthRoutes(['/login'])
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByLabelText('New password')).toBeInTheDocument()
  })

  it('sends an already signed-in forced user away from /login', async () => {
    mockMe = { id: 1, email: 'a@b.co', name: 'A', role: 'user', mustChangePassword: true }
    renderAuthRoutes(['/login'])
    expect(await screen.findByLabelText('New password')).toBeInTheDocument()
  })

  it('clears the forced flag on submit and returns home', async () => {
    mockMe = { id: 1, email: 'a@b.co', name: 'A', role: 'user', mustChangePassword: true }
    renderAuthRoutes(['/change-password'])
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass123' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('HOME')).toBeInTheDocument()
  })

  it('redirects away from /change-password when the flag is not set', async () => {
    mockMe = { id: 1, email: 'a@b.co', name: 'A', role: 'user', mustChangePassword: false }
    renderAuthRoutes(['/change-password'])
    expect(await screen.findByText('HOME')).toBeInTheDocument()
  })
})
