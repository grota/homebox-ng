import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Selection on the catalog (ADR-0010). It is a set of item ids that lives
// independently of the view that produced it: changing the search, a filter or the
// page does not touch it, and it is lost on reload.
//
// "Select all" means everything the current search and filters match — never the
// twenty rows on screen — so the label carries the count, and the resolve call is
// what makes "all" real rather than "this page".
const state = vi.hoisted(() => ({
  lastInput: null as any,
  // What `resolveSelection` answers with. Tests set it to stand in for the server
  // resolving a clause.
  resolved: { ids: [] as number[], total: 0 },
  criteriaQuery: null as any,
}))

const resolveFetch = vi.hoisted(() => vi.fn(async () => state.resolved))
const trashManyMutate = vi.hoisted(() => vi.fn(async (input: { ids: number[] }) => input))

// The `confirmTrash` preference the items page's "Trash selected" reads. `false`
// is what the API ships; the cases that assert the question opt in.
const settings = vi.hoisted(() => ({ confirmTrash: false, itemsPerPage: 20 }))

vi.mock('../src/lib/settings/useUserSettings', () => ({
  useUserSettings: () => ({ ...settings, updateSettings: vi.fn() }),
  // The rule, spelled out rather than imported: `vi.mock` replaces what *importers*
  // see, so the real helper — whose call to `useUserSettings` is internal to its own
  // module — would keep reading the real (default) settings and never see the flag
  // above. One line, and the drafts page's suite covers the same rule on its side.
  useTrashConfirmation: () => (message: string) => !settings.confirmTrash || window.confirm(message),
}))

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const items = [
    { id: 1, name: 'Brass Lamp', locationId: null, location: null, images: [], tags: [] },
    { id: 2, name: 'Oak Table', locationId: null, location: null, images: [], tags: [] },
  ]
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        items: {
          list: { invalidate: vi.fn() },
          resolveSelection: { fetch: resolveFetch },
        },
      }),
      items: {
        // `onSuccess` is honoured, unlike the other mocks in this suite: the page
        // clears the selection there, and that is half of what the Trash action
        // has to do — the rest of it is the call itself.
        trashMany: {
          useMutation: (options?: { onSuccess?: () => void }) => ({
            mutateAsync: async (input: { ids: number[] }) => {
              const result = await trashManyMutate(input)
              options?.onSuccess?.()
              return result
            },
            isPending: false,
            error: null,
          }),
        },
        list: {
          useQuery: (input: any) => {
            state.lastInput = input
            return {
              data: {
                items,
                total: 2,
                facets: {
                  types: [],
                  tags: [{ id: 9, name: 'fragile', color: null, count: 2 }],
                  locations: [{ id: 1, name: 'home', parentId: null, ownCount: 2, subtreeCount: 2 }],
                },
              },
              isLoading: false,
            }
          },
        },
        resolveSelection: {
          // The live count in the criteria panel: a clause with no criterion
          // resolves to nothing, which is what disables Apply.
          useQuery: (clause: any) => {
            state.criteriaQuery = clause
            const empty = Object.values(clause ?? {}).every((v) => v == null || (Array.isArray(v) && !v.length))
            return { data: empty ? { ids: [], total: 0 } : state.resolved, isLoading: false }
          },
        },
        createdAtRange: {
          useQuery: () => ({ data: { min: '2026-01-10', max: '2026-04-01' }, isLoading: false }),
        },
      },
      locations: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      itemTypes: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      tags: {
        list: {
          useQuery: () => ({
            data: [
              { id: 9, name: 'fragile', color: null },
              { id: 10, name: 'bulky', color: null },
            ],
            isLoading: false,
          }),
        },
      },
    },
  }
})

import { ItemsPage } from '../src/features/items/ItemsPage'

const renderCatalog = () =>
  render(
    <MemoryRouter initialEntries={['/items']}>
      <Routes>
        <Route path="/items" element={<ItemsPage />} />
      </Routes>
    </MemoryRouter>,
  )

const box = (name: string) => screen.getByRole('checkbox', { name })
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

beforeEach(() => {
  state.lastInput = null
  state.resolved = { ids: [], total: 0 }
  state.criteriaQuery = null
  // Off, as the API ships it: a case that asserts the question opts in.
  settings.confirmTrash = false
  settings.itemsPerPage = 20
  vi.clearAllMocks()
})

describe('selecting items on the catalog', () => {
  it('selects a card and counts it, and deselects it again', () => {
    renderCatalog()

    fireEvent.click(box('Select Brass Lamp'))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    fireEvent.click(box('Select Brass Lamp'))
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })

  // The box is 13px; the footer row is the target, so a mis-aimed click still
  // works. A label wrapping the control is what forwards the click.
  it('toggles from anywhere in the card footer, not just the box', () => {
    renderCatalog()

    fireEvent.click(box('Select Brass Lamp').closest('label')!)

    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  // And from the title, which is a `<label>` for the same box. The name is the
  // biggest thing on the card, so it is the target that needs no aiming at all.
  it('toggles from the card title', () => {
    renderCatalog()

    fireEvent.click(screen.getByText('Brass Lamp'))

    expect(box('Select Brass Lamp')).toBeChecked()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  // The window is the `itemsPerPage` preference, not a constant: the setting is
  // what decides how much of the list is on screen, and the pagination arithmetic
  // has to follow it or the Next guard and the request would disagree.
  it('takes the page window from the preference, and paginates by it', () => {
    settings.itemsPerPage = 1
    renderCatalog()

    // Two items in this fixture, so one per page is two pages.
    expect(state.lastInput.pageSize).toBe(1)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  // Two items in this fixture, so a wider window fits them on one page — and the
  // control hides itself rather than rendering a disabled Prev/Next pair.
  it('can show a wider window without paging', () => {
    settings.itemsPerPage = 100
    renderCatalog()

    expect(state.lastInput.pageSize).toBe(100)
    // Both rows on one page, so the control hides itself — a disabled Prev/Next
    // pair is noise, not information.
    expect(screen.queryByText(/^Page \d+ of \d+$/)).not.toBeInTheDocument()
  })

  // A whole selection at once, in one call — and with the preference on, it asks
  // first, the same question the item page asks for one item.
  it('trashes the whole selection, after asking', async () => {
    settings.confirmTrash = true
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderCatalog()
    fireEvent.click(box('Select Brass Lamp'))
    fireEvent.click(box('Select Oak Table'))

    press('Trash selected')

    expect(confirmSpy).toHaveBeenCalledWith('Move 2 items to the trash?')
    await waitFor(() => expect(trashManyMutate).toHaveBeenCalledWith({ ids: [1, 2] }))
    // The selection is gone with the items: a count of things no longer in the
    // catalog would be a lie.
    await waitFor(() => expect(screen.queryByText('2 selected')).not.toBeInTheDocument())
    confirmSpy.mockRestore()
  })

  it('trashes nothing when the question is declined', () => {
    settings.confirmTrash = true
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderCatalog()
    fireEvent.click(box('Select Brass Lamp'))

    press('Trash selected')

    expect(trashManyMutate).not.toHaveBeenCalled()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  // The default: nothing is asked and the trash acts. Being asked is the opt-in,
  // because the trash is recoverable (ADR-0004).
  it('trashes without asking when the preference is off', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderCatalog()
    fireEvent.click(box('Select Brass Lamp'))

    press('Trash selected')

    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(trashManyMutate).toHaveBeenCalledWith({ ids: [1] }))
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  // The label carries the count because "all" does not mean "this page".
  it('selects everything the view matches, not just the page', async () => {
    state.resolved = { ids: [1, 2], total: 2 }
    renderCatalog()

    press('Select all 2 matching')

    await waitFor(() => expect(screen.getByText('2 selected')).toBeInTheDocument())
    expect(box('Select Brass Lamp')).toBeChecked()
    expect(box('Select Oak Table')).toBeChecked()
    // ...and it asked the server what the view matches, rather than assuming.
    expect(resolveFetch).toHaveBeenCalled()
  })

  it('clears the selection', () => {
    renderCatalog()
    fireEvent.click(box('Select Brass Lamp'))

    press('Deselect all')

    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })

  it('adds the items a criteria clause resolves to', async () => {
    state.resolved = { ids: [2], total: 1 }
    renderCatalog()

    press('Add to selection')
    fireEvent.click(screen.getByRole('checkbox', { name: 'fragile' }))
    press('Add 1 item')

    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())
    expect(box('Select Oak Table')).toBeChecked()
  })

  it('removes the items a criteria clause resolves to', async () => {
    state.resolved = { ids: [1], total: 1 }
    renderCatalog()
    fireEvent.click(box('Select Brass Lamp'))
    fireEvent.click(box('Select Oak Table'))

    press('Remove from selection')
    fireEvent.click(screen.getByRole('checkbox', { name: 'fragile' }))
    press('Remove 1 item')

    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())
    expect(box('Select Brass Lamp')).not.toBeChecked()
  })

  // A clause that matches nothing must not be applicable: it would be a no-op that
  // looks like it worked.
  it('will not apply a clause that resolves to nothing', () => {
    renderCatalog()

    press('Add to selection')

    expect(screen.getByRole('button', { name: 'Add 0 items' })).toBeDisabled()
  })

  // The row's controls must not shove each other sideways when a selection starts.
  // The count is the last child and pushed to the far edge, so everything before it
  // keeps its place — it used to be first, which moved the whole row.
  it('keeps the controls in place when the count appears', () => {
    renderCatalog()
    const bar = screen.getByRole('button', { name: /Select all 2 matching/ }).parentElement!
    const before = within(bar).getAllByRole('button').map((b) => b.textContent)

    fireEvent.click(box('Select Brass Lamp'))

    const after = within(bar).getAllByRole('button').map((b) => b.textContent)
    expect(after.slice(0, before.length)).toEqual(before)
    const count = screen.getByText('1 selected')
    expect(count).toHaveClass('ml-auto')
    expect(bar.lastElementChild).toBe(count)
  })

  // They are controls, not body text: `ghost` (a transparent border, no fill) is
  // what made them read as labels, and it belongs to the facet chips, where an
  // unselected chip *should* sit quietly.
  it('renders the selection controls as bordered buttons', () => {
    renderCatalog()

    for (const name of ['Select all 2 matching', 'Deselect all', 'Add to selection', 'Remove from selection']) {
      expect(screen.getByRole('button', { name })).toHaveClass('border-border')
    }
  })

  // A selection can outlive the view that made it, so it must be findable. With
  // the facets hidden, because their counts describe the catalog under the filters
  // while the grid now describes the selection.
  it('can show just the selection, with the facet panel out of the way', () => {
    renderCatalog()
    fireEvent.click(box('Select Brass Lamp'))

    press('Selected only')

    expect(state.lastInput.ids).toEqual([1])
    // Asserted on `Locations`, not `Types`: the mock has an empty type facet, so
    // `Types` would be absent either way and the assertion would prove nothing.
    expect(screen.queryByText('Locations')).not.toBeInTheDocument()
  })
})
