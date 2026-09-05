import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// mock the tRPC module so hooks resolve deterministically without a backend.
// `Provider` is a passthrough so <AppProviders> (which renders <trpc.Provider>)
// doesn't blow up; `useUtils` supplies the invalidate helper the page calls
// after a successful create.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const invalidate = vi.fn()
  const mutateAsync = vi.fn(async (input: unknown) => input)
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ itemTypes: { list: { invalidate } } }),
      itemTypes: {
        list: {
          useQuery: () => ({
            data: [{ id: 1, name: 'Default', description: null, fields: [{ id: 1, itemTypeId: 1, name: 'qty', fieldType: 'number', required: false, config: null, sortOrder: 0 }] }],
            isLoading: false,
          }),
        },
        create: {
          useMutation: () => ({ mutateAsync, isPending: false, error: null }),
        },
      },
    },
    __itemTypes: { invalidate, mutateAsync },
  }
})

import { ItemTypesPage } from '../src/features/itemTypes/ItemTypesPage'
import { AppProviders } from '../src/app/AppProviders'

describe('item types page', () => {
  it('renders the type list', async () => {
    render(<AppProviders><ItemTypesPage /></AppProviders>)
    expect(await screen.findByText('Default')).toBeInTheDocument()
    expect(screen.getByText(/qty/)).toBeInTheDocument()
  })

  it('creates a type and resets the form', async () => {
    const { mutateAsync, invalidate } = await import('../src/api/trpc').then((m) => (m as any).__itemTypes)
    render(<AppProviders><ItemTypesPage /></AppProviders>)

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Books' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Shelved' } })

    // Add a custom-field row, then name it — a fresh form starts with no rows.
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    fireEvent.change(screen.getByPlaceholderText('Field name'), { target: { value: 'author' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create type' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ name: 'Books', description: 'Shelved', fields: [{ name: 'author', fieldType: 'text' }] }))
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
  })
})
