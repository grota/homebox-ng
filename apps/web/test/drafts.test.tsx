import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import en from '../public/locales/en/translation.json'

vi.mock('react-i18next', () => ({
  // Everything still returns its key — that is what the existing assertions
  // expect. The confirmation is the exception: it is the only observable string
  // that carries a value, so it is interpolated from the real locale file.
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number }) =>
      k === 'drafts.discardSelectedConfirm' ? en.drafts.discardSelectedConfirm.replace('{{count}}', String(opts?.count)) : k,
  }),
}))

// The draft rows returned by `trpc.drafts.list`; reassigned per test so the
// results and empty states can both be exercised without a backend.
let draftData: any[] = []

// The bulk-discard action's `mutateAsync`, exposed so a case can assert what the
// button sends. Reaching it from a test is the same deferred-reference pattern as
// `draftData` below: the factory closes over it and only reads it at render.
const discardAllMutate = vi.fn()

// A minimal draft row. `DraftsPage` reads only `id`, `name` and `images`.
const draft = (id: number, name: string) => ({
  id,
  name,
  images: [{ id: id * 10, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true }],
})

// Stub the tRPC router so `DraftsPage` renders without a backend. The page also
// renders `UnpackModal`, so `itemTypes.list` is stubbed to an empty list too.
// No submit is exercised, so no `fetch` mock is needed.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const invalidate = vi.fn()
  const idleMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ drafts: { list: { invalidate } } }),
      drafts: {
        list: { useQuery: () => ({ data: draftData, isLoading: false }) },
        update: { useMutation: () => idleMutation },
        publish: { useMutation: () => idleMutation },
        publishAll: { useMutation: () => idleMutation },
        discard: { useMutation: () => idleMutation },
        discardAll: {
          // `onSuccess` is wired through to the test rather than dropped: the page
          // clears its selection there, and a stub that swallowed the callback
          // would make that behaviour unassertable.
          useMutation: (options?: { onSuccess?: () => void }) => ({
            ...idleMutation,
            mutateAsync: (input: unknown) => {
              discardAllMutate(input)
              options?.onSuccess?.()
            },
          }),
        },
      },
      itemTypes: {
        list: { useQuery: () => ({ data: [], isLoading: false }) },
      },
    },
  }
})

import { DraftsPage } from '../src/features/drafts'

beforeEach(() => vi.clearAllMocks())

describe('drafts page', () => {
  it('renders a draft with its name, publish/discard actions, and a select-all checkbox', () => {
    draftData = [
      {
        id: 1,
        name: 'Draft Lamp',
        images: [{ id: 10, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true }],
      },
    ]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('textbox')).toHaveValue('Draft Lamp')
    expect(screen.getByRole('button', { name: 'drafts.publish' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'drafts.discard' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'drafts.selectAll' })).toBeInTheDocument()
  })

  it('renders the empty state when there are no drafts', () => {
    draftData = []
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('drafts.empty')).toBeInTheDocument()
  })

  it('offers a danger-styled "Discard selected" beside "Publish selected", disabled at zero selected', () => {
    draftData = [draft(1, 'Draft Lamp')]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: 'drafts.discardSelected' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveClass('text-danger')
  })

  it('confirms with the number of drafts before discarding, then sends the selected ids', () => {
    draftData = [draft(1, 'Draft Lamp'), draft(2, 'Draft Cup')]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    fireEvent.click(screen.getByRole('button', { name: 'drafts.discardSelected' }))
    expect(confirmSpy).toHaveBeenCalledWith('Discard 2 draft(s) and their photos?')
    expect(discardAllMutate).toHaveBeenCalledWith({ ids: [1, 2] })
  })

  it('discards nothing when the confirmation is declined', () => {
    draftData = [draft(1, 'Draft Lamp')]
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    const btn = screen.getByRole('button', { name: 'drafts.discardSelected' })
    fireEvent.click(btn)
    expect(discardAllMutate).not.toHaveBeenCalled()
    expect(btn).toBeEnabled()
  })

  it('clears the selection once the discard succeeds', () => {
    draftData = [draft(1, 'Draft Lamp')]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    const btn = screen.getByRole('button', { name: 'drafts.discardSelected' })
    fireEvent.click(btn)
    expect(discardAllMutate).toHaveBeenCalledWith({ ids: [1] })
    expect(btn).toBeDisabled()
  })

  it('takes the confirmed count from the selection, not from the list', () => {
    // Two drafts, one selected: the count must come from the selection, not the list.
    // Selecting through the select-all checkbox cannot tell those two apart, which
    // is why this case ticks a single row instead.
    draftData = [draft(1, 'Draft Lamp'), draft(2, 'Draft Cup')]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'drafts.discardSelected' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(confirmSpy).toHaveBeenCalledWith('Discard 1 draft(s) and their photos?')
    expect(discardAllMutate).toHaveBeenCalledWith({ ids: [1] })
  })
})
