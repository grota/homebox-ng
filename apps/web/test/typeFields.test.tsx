import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// The mutation and query spies live outside the factory so the tests can assert
// on the calls; `vi.hoisted` is required because `vi.mock` factories are hoisted
// above plain consts. `confirm` stands in for `window.confirm`, which the test
// routes to it in `beforeEach`.
const mocks = vi.hoisted(() => ({
  updateFields: vi.fn(async (input: unknown) => input),
  // The component reads the usage imperatively (before a confirm, and before a
  // retype), so the mock has to provide `utils.client`, not a `useQuery`.
  usageQuery: vi.fn(async (): Promise<{ total: number; missing: number; items: { itemId: number; name: string; value: string }[] }> => ({ total: 0, missing: 0, items: [] })),
  invalidate: vi.fn(),
  confirm: vi.fn((_message: string) => true),
}))

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        itemTypes: { list: { invalidate: mocks.invalidate } },
        items: { list: { invalidate: mocks.invalidate } },
        client: { itemTypes: { fieldValueUsage: { query: mocks.usageQuery } } },
      }),
      itemTypes: {
        updateFields: { useMutation: () => ({ mutateAsync: mocks.updateFields, isPending: false, error: null }) },
      },
      settings: { get: { useQuery: () => ({ data: undefined, isLoading: false }) }, update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) } },
    },
  }
})

import { TypeFields } from '../src/features/itemTypes/TypeFields'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockImplementation((message) => mocks.confirm(String(message)))
})

const fields = [
  { id: 11, name: 'size', fieldType: 'text' as const, required: false, sortOrder: 0 },
  { id: 12, name: 'note', fieldType: 'text' as const, required: false, sortOrder: 1 },
]

// The editor talks only to tRPC and the `ui` primitives, so no provider wrapper is
// needed. The dialog's offender links are plain <a href>, so no router either.
const renderFields = ({ canEdit = true }: { canEdit?: boolean } = {}) =>
  render(<TypeFields typeId={7} fields={fields} canEdit={canEdit} />)

describe('type fields editor', () => {
  it('renders a row per field with a required toggle', async () => {
    renderFields()
    expect(screen.getByDisplayValue('size')).toBeInTheDocument()
    expect(screen.getByDisplayValue('note')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: /required/i })).toHaveLength(2)
  })

  // Saving one row must send ONE upsert, so the server's diff can never read it
  // as "delete the others".
  it('renames a single field with a single upsert and no deletions', async () => {
    renderFields()
    fireEvent.change(screen.getByDisplayValue('size'), { target: { value: 'size (cm)' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^save/i })[0])
    await waitFor(() =>
      expect(mocks.updateFields).toHaveBeenCalledWith({
        id: 7,
        upserts: [{ id: 11, name: 'size (cm)', fieldType: 'text', required: false, sortOrder: 0 }],
        deletedIds: [],
      })
    )
  })

  it('adds a field without a sortOrder, letting the server append it', async () => {
    renderFields()
    fireEvent.change(screen.getByLabelText('New field name'), { target: { value: 'colour' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    await waitFor(() =>
      expect(mocks.updateFields).toHaveBeenCalledWith({ id: 7, upserts: [{ name: 'colour', fieldType: 'text' }], deletedIds: [] })
    )
  })

  it('toggles required on one row only', async () => {
    renderFields()
    fireEvent.click(screen.getAllByRole('checkbox', { name: /required/i })[0])
    fireEvent.click(screen.getAllByRole('button', { name: /^save/i })[0])
    await waitFor(() => expect(mocks.updateFields).toHaveBeenCalledWith(expect.objectContaining({ upserts: [expect.objectContaining({ id: 11, required: true })] })))
  })

  // The server assigns an added field its own id, so it comes back through the
  // `fields` prop on the refetch rather than from anything the editor sent. The
  // rerender is that refetch: without it the new row would stay invisible until
  // the type was reopened, making Add look like it did nothing.
  it('shows a field the server has just added', async () => {
    const view = renderFields()
    fireEvent.change(screen.getByLabelText('New field name'), { target: { value: 'colour' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    await waitFor(() => expect(mocks.updateFields).toHaveBeenCalled())

    view.rerender(
      <TypeFields
        typeId={7}
        fields={[...fields, { id: 13, name: 'colour', fieldType: 'text' as const, required: false, sortOrder: 2 }]}
        canEdit
      />
    )

    expect(await screen.findByDisplayValue('colour')).toBeInTheDocument()
  })

  // Deleting destroys, so the confirmation must name the count and the request
  // must carry the acknowledgment.
  it('asks for the value count, confirms, then acknowledges the loss', async () => {
    mocks.usageQuery.mockResolvedValueOnce({ total: 3, missing: 0, items: [] })
    renderFields()
    fireEvent.click(screen.getAllByRole('button', { name: /^delete/i })[0])
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('3 stored values')))
    await waitFor(() => expect(mocks.updateFields).toHaveBeenCalledWith({ id: 7, upserts: [], deletedIds: [11], acknowledgeValueLoss: true }))
  })

  it('does nothing when the deletion is declined', async () => {
    mocks.confirm.mockReturnValueOnce(false)
    renderFields()
    fireEvent.click(screen.getAllByRole('button', { name: /^delete/i })[0])
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.updateFields).not.toHaveBeenCalled()
  })

  it('hides every control from a non-admin', () => {
    renderFields({ canEdit: false })
    expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^delete/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /required/i })).toBeNull()
  })
})
