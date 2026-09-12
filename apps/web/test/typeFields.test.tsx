import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

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
  // `mockClear` keeps implementations, so a case that stubs the usage with
  // `mockResolvedValue` would otherwise leak it into the next one.
  mocks.usageQuery.mockImplementation(async () => ({ total: 0, missing: 0, items: [] }))
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

  // Asserting the payload alone let this through: the row itself has to go. The
  // rerender is the refetch that follows the write, and the deleted id is absent
  // from it — the editor has to converge, or a row the server no longer has stays
  // on screen with its Save enabled (its `isDirty` reads a missing `saved` as a
  // change) and fails the ownership check when clicked.
  it('drops a deleted field once the server no longer reports it', async () => {
    const view = renderFields()
    fireEvent.click(screen.getAllByRole('button', { name: /^delete/i })[0])
    await waitFor(() => expect(mocks.updateFields).toHaveBeenCalledWith({ id: 7, upserts: [], deletedIds: [11], acknowledgeValueLoss: true }))

    view.rerender(<TypeFields typeId={7} fields={[fields[1]]} canEdit />)

    await waitFor(() => expect(screen.queryByDisplayValue('size')).toBeNull())
    expect(screen.getByDisplayValue('note')).toBeInTheDocument()
  })

  // A refetch that brings a new field must not reset what is being typed: the
  // list invalidates on every write, so overwriting existing rows would wipe a
  // half-typed name.
  it('keeps an unsaved edit when a refetch brings a new field', async () => {
    const view = renderFields()
    fireEvent.change(screen.getByDisplayValue('size'), { target: { value: 'size (cm)' } })

    view.rerender(
      <TypeFields
        typeId={7}
        fields={[...fields, { id: 13, name: 'colour', fieldType: 'text' as const, required: false, sortOrder: 2 }]}
        canEdit
      />
    )

    expect(screen.getByDisplayValue('size (cm)')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('colour')).toBeInTheDocument()
  })

  // A failed count read used to reject out of the click handler: no message, no
  // write, nothing on screen. It has to be a visible failure instead.
  it('reports a failed value-count read and does not delete', async () => {
    mocks.usageQuery.mockRejectedValueOnce(new Error('Session expired'))
    renderFields()

    fireEvent.click(screen.getAllByRole('button', { name: /^delete/i })[0])

    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired')
    expect(mocks.updateFields).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('hides every control from a non-admin', () => {
    renderFields({ canEdit: false })
    expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^delete/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /required/i })).toBeNull()
  })
})

// Retyping is the one edit the API can refuse: the values already stored for the
// field may no longer be readable as the new type, and saving would either blank
// them or fail outright. So the editor asks what a retype would strand BEFORE it
// saves, and turns a refusal into a task — the offenders dialog.
describe('retyping a field', () => {
  const typeSelects = () => screen.getAllByLabelText('Type')
  const saveButtons = () => screen.getAllByRole('button', { name: /^save/i })

  const stranded = {
    total: 2,
    missing: 1,
    items: [
      { itemId: 5, name: 'Hammer', value: 'big' },
      { itemId: 6, name: 'Nail', value: 'small' },
    ],
  }

  // A retype nothing is stranded by is an ordinary save: no dialog, and no clear
  // flag on the wire.
  it('saves a retype that strands nothing, with no dialog and no flag', async () => {
    renderFields()
    fireEvent.change(typeSelects()[0], { target: { value: 'number' } })
    fireEvent.click(saveButtons()[0])

    await waitFor(() =>
      expect(mocks.updateFields).toHaveBeenCalledWith({
        id: 7,
        upserts: [{ id: 11, name: 'size', fieldType: 'number', required: false, sortOrder: 0 }],
        deletedIds: [],
      })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the offenders dialog instead of saving a retype that strands values', async () => {
    mocks.usageQuery.mockResolvedValue(stranded)
    renderFields()
    fireEvent.change(typeSelects()[0], { target: { value: 'number' } })
    fireEvent.click(saveButtons()[0])

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Hammer')).toBeInTheDocument()
    expect(mocks.updateFields).not.toHaveBeenCalled()
    // The gate has to be asked about the type being moved TO. Asked about the saved
    // one, the API answers 0 and waves the stranded values through unlisted.
    expect(mocks.usageQuery).toHaveBeenCalledWith({ typeId: 7, fieldId: 11, fieldType: 'number' })
    expect(mocks.usageQuery).toHaveBeenLastCalledWith({ typeId: 7, fieldId: 11, fieldType: 'number' })
  })

  // The button commits to the count it displayed — the server re-validates that
  // exact number — and the write carries ONE field, because the API refuses a
  // request that would clear two.
  it('converts with clearIncompatible and the count it displayed', async () => {
    mocks.usageQuery.mockResolvedValue(stranded)
    renderFields()
    fireEvent.change(typeSelects()[0], { target: { value: 'number' } })
    fireEvent.click(saveButtons()[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Clear 2 values and convert' }))

    await waitFor(() =>
      expect(mocks.updateFields).toHaveBeenCalledWith({
        id: 7,
        upserts: [{ id: 11, name: 'size', fieldType: 'number', required: false, sortOrder: 0 }],
        deletedIds: [],
        clearIncompatible: true,
        acknowledgedValueCount: 2,
      })
    )
  })

  // Cancel is inert: nothing is written, and the row returns to the type the
  // server still has, so a later save cannot strand values the admin declined to
  // clear.
  it('leaves the row untouched when the dialog is cancelled', async () => {
    mocks.usageQuery.mockResolvedValue(stranded)
    renderFields()
    fireEvent.change(typeSelects()[0], { target: { value: 'number' } })
    fireEvent.click(saveButtons()[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.updateFields).not.toHaveBeenCalled()
    expect(typeSelects()[0]).toHaveValue('text')
  })

  // The warning lands as soon as the type is picked, so the wall the API would
  // raise is on screen before Save is even reachable.
  it('warns on the row when the picked type strands values', async () => {
    mocks.usageQuery.mockResolvedValue(stranded)
    renderFields()
    fireEvent.change(typeSelects()[0], { target: { value: 'number' } })

    expect(await screen.findByText("2 values won't fit number")).toBeInTheDocument()
  })

  // Leaving to fix the items in another tab is the entire point of the dialog's
  // links, so coming back re-reads the list: the count the button commits to has
  // to be the one the server will re-validate, and that is the count it sends.
  it('re-reads the offenders when the window regains focus, and sends the new count', async () => {
    mocks.usageQuery.mockResolvedValue(stranded)
    renderFields()
    fireEvent.change(typeSelects()[0], { target: { value: 'number' } })
    fireEvent.click(saveButtons()[0])
    await screen.findByRole('button', { name: 'Clear 2 values and convert' })

    mocks.usageQuery.mockResolvedValue({ total: 1, missing: 0, items: [{ itemId: 5, name: 'Hammer', value: 'big' }] })
    window.dispatchEvent(new Event('focus'))
    fireEvent.click(await screen.findByRole('button', { name: 'Clear 1 value and convert' }))

    await waitFor(() =>
      expect(mocks.updateFields).toHaveBeenCalledWith({
        id: 7,
        upserts: [{ id: 11, name: 'size', fieldType: 'number', required: false, sortOrder: 0 }],
        deletedIds: [],
        clearIncompatible: true,
        acknowledgedValueCount: 1,
      })
    )
  })

  // The admin fixes the values by hand in the tab the links opened, and the count
  // reaches zero while the dialog is up. Nothing is left to destroy, so the retype
  // is a plain one: one click, no clear flag, no confirmation.
  it('applies the retype plainly when the re-check finds nothing left to clear', async () => {
    mocks.usageQuery.mockResolvedValue(stranded)
    renderFields()
    fireEvent.change(typeSelects()[0], { target: { value: 'number' } })
    fireEvent.click(saveButtons()[0])
    await screen.findByRole('button', { name: 'Clear 2 values and convert' })

    mocks.usageQuery.mockResolvedValue({ total: 0, missing: 0, items: [] })
    window.dispatchEvent(new Event('focus'))
    fireEvent.click(await screen.findByRole('button', { name: 'Convert' }))

    await waitFor(() =>
      expect(mocks.updateFields).toHaveBeenCalledWith({
        id: 7,
        upserts: [{ id: 11, name: 'size', fieldType: 'number', required: false, sortOrder: 0 }],
        deletedIds: [],
      })
    )
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  // A re-check that failed leaves the count on screen unverified. The form's alert
  // cannot say so: it renders outside Radix's portal, behind the overlay and its
  // `aria-hidden`. So the dialog carries the failure itself, and the confirm — which
  // would commit to a count nobody re-read — cannot fire.
  it('reports a failed re-check inside the dialog and refuses the confirm', async () => {
    mocks.usageQuery.mockResolvedValue(stranded)
    renderFields()
    fireEvent.change(typeSelects()[0], { target: { value: 'number' } })
    fireEvent.click(saveButtons()[0])
    await screen.findByRole('button', { name: 'Clear 2 values and convert' })

    mocks.usageQuery.mockRejectedValue(new Error('Session expired'))
    window.dispatchEvent(new Event('focus'))

    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Session expired')
    const destructive = within(dialog).getByRole('button', { name: 'Clear 2 values and convert' })
    expect(destructive).toBeDisabled()
    fireEvent.click(destructive)

    expect(mocks.updateFields).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  // The pre-save read runs outside `run`'s try/catch, which covers only the
  // mutation: unguarded it would reject out of the click handler as a silent
  // no-op. A save that cannot be checked must say so and write nothing.
  it('reports a failed pre-save check and does not save', async () => {
    mocks.usageQuery.mockResolvedValueOnce({ total: 0, missing: 0, items: [] })
    mocks.usageQuery.mockRejectedValueOnce(new Error('Session expired'))
    renderFields()
    fireEvent.change(typeSelects()[0], { target: { value: 'number' } })
    fireEvent.click(saveButtons()[0])

    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired')
    expect(mocks.updateFields).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
