import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// mock the tRPC module so hooks resolve deterministically without a backend
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      // A passthrough Provider so <AppProviders> (which renders <trpc.Provider>)
      // doesn't blow up under the mock.
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      // `useUtils` backs the auth pages' `auth.me.fetch()` on setup/login success.
      useUtils: () => ({ auth: { me: { fetch: vi.fn(async () => null) } }, settings: { get: { invalidate: vi.fn(async () => undefined) } } }),
      auth: {
        me: { useQuery: () => ({ data: null, isLoading: false }) },
        login: { useMutation: () => ({ mutateAsync: vi.fn(async () => ({ id: 1, email: 'a@b.co', name: 'A', role: 'user' })), isPending: false, error: null }) },
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
import { AppProviders } from '../src/app/AppProviders'

describe('auth pages', () => {
  it('renders login form and submits credentials', async () => {
    render(<AppProviders><LoginPage /></AppProviders>)
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/signed in/i)).toBeInTheDocument()
  })
})
