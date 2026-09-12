import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mutation spies live outside the factory so the tests can assert on the calls.
// `vi.hoisted` is required: `vi.mock` factories are hoisted above plain consts.
// `role` is mutable so one case can render the page as a non-admin.
const mocks = vi.hoisted(() => ({
  create: vi.fn(async (input: unknown) => input),
  update: vi.fn(async (input: unknown) => input),
  remove: vi.fn(async (input: unknown) => input),
  invalidate: vi.fn(),
  role: 'admin' as 'admin' | 'user',
}))

// mock the tRPC module so hooks resolve deterministically without a backend.
// `Provider` is a passthrough so <AppProviders> (which renders <trpc.Provider>)
// doesn't blow up; `useUtils` supplies the invalidate helper the page calls
// after a successful write. The page reads `auth.me` through `useAuth` to decide
// whether to show the admin-only write controls.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const mutation = (spy: (input: unknown) => unknown) => () => ({ mutateAsync: spy, isPending: false, error: null })
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        itemTypes: { list: { invalidate: mocks.invalidate } },
        items: { list: { invalidate: mocks.invalidate } },
      }),
      auth: { me: { useQuery: () => ({ data: { id: 1, name: 'Admin', email: 'a@b.co', role: mocks.role }, isLoading: false }) } },
      itemTypes: {
        list: {
          useQuery: () => ({
            data: [{ id: 1, name: 'Default', description: null, fields: [{ id: 1, itemTypeId: 1, name: 'qty', fieldType: 'number', required: false, config: null, sortOrder: 0 }] }],
            isLoading: false,
          }),
        },
        create: { useMutation: mutation(mocks.create) },
        update: { useMutation: mutation(mocks.update) },
        delete: { useMutation: mutation(mocks.remove) },
      },
      // `<AppProviders>` renders `<SettingsProvider>`, which reads `settings.get`
      // and wires `settings.update`. Return `data: undefined` so the provider falls
      // back to the spec defaults.
      settings: {
        get: { useQuery: () => ({ data: undefined, isLoading: false }) },
        update: { useMutation: mutation(vi.fn()) },
      },
    },
  }
})

import { ItemTypesPage } from '../src/features/itemTypes/ItemTypesPage'
import { AppProviders } from '../src/app/AppProviders'

const renderPage = () => render(<AppProviders><ItemTypesPage /></AppProviders>)

beforeEach(() => {
  mocks.role = 'admin'
  vi.clearAllMocks()
})

describe('item types page', () => {
  it('renders the type list', async () => {
    renderPage()
    expect(await screen.findByText('Default')).toBeInTheDocument()
    expect(screen.getByText(/qty/)).toBeInTheDocument()
  })

  it('creates a type and resets the form', async () => {
    renderPage()

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Books' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Shelved' } })

    // Add a custom-field row, then name it — a fresh form starts with no rows.
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    fireEvent.change(screen.getByPlaceholderText('Field name'), { target: { value: 'author' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create type' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ name: 'Books', description: 'Shelved', fields: [{ name: 'author', fieldType: 'text' }] }))
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled())
  })

  // The guard that matters: `update` replaces the type's WHOLE field set, and
  // `item_custom_field_values.field_id` cascades — so re-sending an untouched
  // set on a plain rename would delete every item's values for this type.
  it('omits fields when an edit only renames the type', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.update).toHaveBeenCalled())
    const payload = mocks.update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({ id: 1, name: 'Renamed' })
    expect(payload).not.toHaveProperty('fields')
  })

  it('sends fields when the field set actually changed', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    // The loaded field's own input shares the placeholder, so the fresh row is
    // the last match.
    const fieldInputs = screen.getAllByPlaceholderText('Field name')
    fireEvent.change(fieldInputs[fieldInputs.length - 1], { target: { value: 'author' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.update).toHaveBeenCalled())
    const payload = mocks.update.mock.calls[0][0] as { fields?: unknown[] }
    expect(payload.fields).toEqual([
      { name: 'qty', fieldType: 'number' },
      { name: 'author', fieldType: 'text' },
    ])
  })

  it('deletes a type once the confirmation is accepted', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ id: 1 }))
    confirm.mockRestore()
  })

  it('keeps the write controls away from a non-admin', async () => {
    mocks.role = 'user'
    renderPage()

    // The list still renders — a non-admin needs it to create items.
    expect(await screen.findByText('Default')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create type' })).toBeNull()
    expect(screen.getByText(/managed by an administrator/i)).toBeInTheDocument()
  })
})
