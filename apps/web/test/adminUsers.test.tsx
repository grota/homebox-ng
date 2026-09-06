import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// Stub the tRPC router so the tab renders without a backend. The mutation fns
// and `invalidate` are created HERE (not at module top level) because `vi.mock`
// is hoisted above the file's `const`s; they're re-exposed under `__test` so the
// test body can assert on them.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const invalidate = vi.fn()
  // The create mutation resolves to the API's UserDto; `mustChangePassword: true`
  // is what drives the "share this one-time temp password" banner.
  const createMutateAsync = vi.fn(async (input: any) => ({
    id: 2,
    name: input.name,
    email: input.email,
    role: input.role,
    mustChangePassword: true,
  }))
  const updateMutateAsync = vi.fn(async (input: any) => input)
  const deleteMutateAsync = vi.fn(async (input: any) => input)

  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ users: { list: { invalidate } } }),
      users: {
        list: {
          useQuery: () => ({
            data: [{ id: 1, name: 'Alice', email: 'a@b.co', role: 'admin', mustChangePassword: false }],
            isLoading: false,
          }),
        },
        create: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: createMutateAsync, isPending: false, error: null }) },
        update: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: updateMutateAsync, isPending: false, error: null }) },
        delete: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: deleteMutateAsync, isPending: false, error: null }) },
      },
    },
    __test: { createMutateAsync, updateMutateAsync, deleteMutateAsync, invalidate },
  }
})

import { AdminUsersTab } from '../src/features/admin/AdminUsersTab'

beforeEach(() => vi.clearAllMocks())

describe('AdminUsersTab', () => {
  it('lists users', async () => {
    render(<AdminUsersTab />)
    expect(await screen.findByText(/Alice/)).toBeInTheDocument()
  })

  it('creates a user and surfaces the one-time temp password', async () => {
    const m = (await import('../src/api/trpc')) as any
    render(<AdminUsersTab />)

    fireEvent.change(await screen.findByLabelText('admin.users.name'), { target: { value: 'Bob' } })
    fireEvent.change(screen.getByLabelText('admin.users.email'), { target: { value: 'bob@c.co' } })
    fireEvent.change(screen.getByLabelText('admin.users.tempPassword'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.create' }))

    await waitFor(() =>
      expect(m.__test.createMutateAsync).toHaveBeenCalledWith({
        name: 'Bob',
        email: 'bob@c.co',
        password: 'secret123',
        role: 'user',
      }),
    )
    expect(await screen.findByTestId('temp-password')).toHaveTextContent('secret123')
    await waitFor(() => expect(m.__test.invalidate).toHaveBeenCalled())
  })
})
