import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import en from '../src/locales/en/translation.json'

vi.mock('react-i18next', () => ({
  // Everything still returns its key — that is what the existing assertions
  // expect. The messages that carry copy are the exception: all three are read
  // from the real locale file, so a case can read the rendered text, and a
  // single-brace placeholder fails the assertion instead of silently rendering
  // `{count}`. `unpackedNone` has no count to interpolate, so it is passed
  // through the same `replace` unchanged.
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number }) => {
      const message =
        k === 'drafts.discardSelectedConfirm' ? en.drafts.discardSelectedConfirm
        : k === 'drafts.unpacked' ? en.drafts.unpacked
        : k === 'drafts.unpackedNone' ? en.drafts.unpackedNone
        : null
      return message ? message.replace('{{count}}', String(opts?.count)) : k
    },
  }),
}))

// The draft rows returned by `trpc.drafts.list`; reassigned per test so the
// results and empty states can both be exercised without a backend.
let draftData: any[] = []

// The bulk-trash action's `mutateAsync`, exposed so a case can assert what the
// button sends. Reaching it from a test is the same deferred-reference pattern as
// `draftData` below: the factory closes over it and only reads it at render.
const trashAllMutate = vi.fn()

// The bulk-publish action's, for the same reason: it also clears the selection
// on success now, and that is only assertable if the callback is wired through.
const publishAllMutate = vi.fn()

// A minimal draft row. `DraftsPage` reads only `id`, `name` and `images`.
const draft = (id: number, name: string) => ({
  id,
  name,
  images: [{ id: id * 10, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true }],
})

// Sits beside `DraftsPage` under the same router to make the URL observable from
// a case, and to drive the navigation `UnpackModal.onUnpacked` performs — which
// matters because the modal lives *on* the drafts page, so that navigation lands
// on an already-mounted `DraftsPage` rather than a fresh one.
function RouterProbe() {
  const navigate = useNavigate()
  return (
    <>
      <span data-testid="search">{useLocation().search}</span>
      <button type="button" data-testid="go-detected" onClick={() => navigate('/drafts?detected=2')}>unpack</button>
    </>
  )
}

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
        // The paginated envelope `drafts.list` returns: one page plus the
        // unpaginated total. `total` is derived so a case only sets the rows.
        list: { useQuery: () => ({ data: { items: draftData, total: draftData.length }, isLoading: false }) },
        update: { useMutation: () => idleMutation },
        publish: { useMutation: () => idleMutation },
        publishAll: {
          useMutation: (options?: { onSuccess?: () => void }) => ({
            ...idleMutation,
            mutateAsync: (input: unknown) => {
              publishAllMutate(input)
              options?.onSuccess?.()
            },
          }),
        },
        trash: { useMutation: () => idleMutation },
        trashAll: {
          // `onSuccess` is wired through to the test rather than dropped: the page
          // clears its selection there, and a stub that swallowed the callback
          // would make that behaviour unassertable.
          useMutation: (options?: { onSuccess?: () => void }) => ({
            ...idleMutation,
            mutateAsync: (input: unknown) => {
              trashAllMutate(input)
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

  it('disables both unpack actions until a photo is chosen', () => {
    draftData = [draft(1, 'Draft Lamp')]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    // One photo and one type are shared: the two differ only in where the boxes
    // come from, so they enable and disable together.
    expect(screen.getByRole('button', { name: 'drafts.unpackAuto' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'drafts.unpackManual' })).toBeDisabled()
  })

  it('offers no pagination when everything fits on one page', () => {
    draftData = [draft(1, 'Draft Lamp')]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  it('pages a list longer than one page', () => {
    draftData = Array.from({ length: 25 }, (_, i) => draft(i + 1, `Draft ${i + 1}`))
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  // Page-scoped selection: the set must not survive a page change, or a bulk
  // action could act on rows the user cannot see.
  it('clears the selection when the page changes', () => {
    draftData = Array.from({ length: 25 }, (_, i) => draft(i + 1, `Draft ${i + 1}`))
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    expect(screen.getByRole('button', { name: 'drafts.publishSelected' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('button', { name: 'drafts.publishSelected' })).toBeDisabled()
  })

  // The "all" actions call the server's existing "no ids means every draft"
  // branch. Sending the page's ids instead would quietly make them mean "this
  // page" — the same trap the unpaginated repo queries exist to avoid.
  it('sends no ids for the all-actions', () => {
    draftData = [draft(1, 'Draft Lamp'), draft(2, 'Draft Cup')]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'drafts.publishAll' }))
    expect(publishAllMutate).toHaveBeenCalledWith({})

    fireEvent.click(screen.getByRole('button', { name: 'drafts.trashAll' }))
    expect(trashAllMutate).toHaveBeenCalledWith({})
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
    expect(confirmSpy).toHaveBeenCalledWith('Move 2 draft(s) to the trash?')
    expect(trashAllMutate).toHaveBeenCalledWith({ ids: [1, 2] })
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
    expect(trashAllMutate).not.toHaveBeenCalled()
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
    expect(trashAllMutate).toHaveBeenCalledWith({ ids: [1] })
    expect(btn).toBeDisabled()
  })

  it('clears the selection once the publish succeeds, like the discard does', () => {
    draftData = [draft(1, 'Draft Lamp')]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    const btn = screen.getByRole('button', { name: 'drafts.publishSelected' })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(publishAllMutate).toHaveBeenCalledWith({ ids: [1] })
    // A published id survives in `selected` otherwise, and the next bulk action
    // would send it again — the two bulk buttons must not differ here.
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
    expect(confirmSpy).toHaveBeenCalledWith('Move 1 draft(s) to the trash?')
    expect(trashAllMutate).toHaveBeenCalledWith({ ids: [1] })
  })

  it('reports how many items the unpack detected, in the empty state', () => {
    draftData = []
    render(
      <MemoryRouter initialEntries={['/drafts?detected=3']}>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Detected 3 item(s)')
  })

  it('reports the detected count above the list when drafts exist', () => {
    draftData = [draft(1, 'Draft Lamp')]
    render(
      <MemoryRouter initialEntries={['/drafts?detected=2']}>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Detected 2 item(s)')
    expect(screen.getByRole('textbox')).toHaveValue('Draft Lamp')
  })

  it('shows no unpack message when the parameter is absent', () => {
    draftData = [draft(1, 'Draft Lamp')]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows no unpack message when the parameter is present but empty', () => {
    // `?detected=` is a hand-edited URL, and `Number('')` is a real `0`: without
    // the blank check this renders "No items detected" for a parameter that was
    // never a count, which is the failure the absent case exists to prevent.
    draftData = []
    render(
      <MemoryRouter initialEntries={['/drafts?detected=']}>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows no unpack message when the parameter is only whitespace', () => {
    draftData = []
    render(
      <MemoryRouter initialEntries={['/drafts?detected=%20']}>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows no unpack message when the parameter is not a count', () => {
    draftData = []
    render(
      <MemoryRouter initialEntries={['/drafts?detected=nope']}>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says nothing was detected when the unpack found nothing', () => {
    draftData = []
    render(
      <MemoryRouter initialEntries={['/drafts?detected=0']}>
        <DraftsPage />
      </MemoryRouter>,
    )
    // A real zero is not the same answer as no parameter at all: the unpack ran
    // and found nothing, which is the one outcome worth a second look.
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('No items detected')
    expect(notice).toHaveClass('text-danger')
  })

  it('shows no unpack message in the empty state when the parameter is absent', () => {
    // The counterweight to the case above, in the branch a zero lands in: with
    // no parameter there is nothing to report, so the empty state must stay
    // bare rather than inherit the zero message.
    draftData = []
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps the notice after the parameter is consumed', () => {
    draftData = []
    render(
      <MemoryRouter initialEntries={['/drafts?detected=3']}>
        <DraftsPage />
      </MemoryRouter>,
    )
    // The page rewrites the URL on mount, so this renders at all only because the
    // value was captured before the parameter went away.
    expect(screen.getByRole('status')).toHaveTextContent('Detected 3 item(s)')
  })

  it('drops the parameter from the URL, so a reload starts clean', () => {
    draftData = []
    render(
      <MemoryRouter initialEntries={['/drafts?detected=3']}>
        <RouterProbe />
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('reports the count for an unpack that lands on an already-mounted page', () => {
    // Every real unpack takes this path: the modal lives on the drafts page, so
    // its navigation is a search change on a mounted `DraftsPage` — no remount,
    // and nothing for a mount-time read of the parameter to see.
    draftData = [draft(1, 'Draft Lamp')]
    render(
      <MemoryRouter initialEntries={['/drafts']}>
        <RouterProbe />
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('go-detected'))
    expect(screen.getByRole('status')).toHaveTextContent('Detected 2 item(s)')
  })

  it('opens the photo viewer from a row thumbnail', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'View photo of Draft Lamp' }))
    const dialog = screen.getByRole('dialog', { name: 'Draft Lamp' })
    // The thumbnail is a 400px upscale of the original, so the viewer shows the
    // original, not the thumbnail.
    expect(within(dialog).getByRole('img', { name: 'Draft Lamp' })).toHaveAttribute(
      'src',
      '/file/uploads/originals/a.png',
    )
  })
})
