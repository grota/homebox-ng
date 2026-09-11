import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import en from '../public/locales/en/translation.json'

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
})
