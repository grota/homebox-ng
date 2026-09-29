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
    t: (k: string, opts?: { count?: number; name?: string }) => {
      const message =
        k === 'drafts.trashSelectedConfirm' ? en.drafts.trashSelectedConfirm
        : k === 'drafts.trashConfirm' ? en.drafts.trashConfirm
        : k === 'drafts.unpacked' ? en.drafts.unpacked
        : k === 'drafts.unpackedNone' ? en.drafts.unpackedNone
        : null
      return message ? message.replace('{{count}}', String(opts?.count)).replace('{{name}}', String(opts?.name)) : k
    },
  }),
}))

// The two per-user preferences this page now reads: whether a move-to-trash asks
// (`false` is what the API ships, and the cases that assert the question opt in)
// and how many drafts a page holds.
const settings = vi.hoisted(() => ({ confirmTrash: false, itemsPerPage: 20 }))

vi.mock('../src/lib/settings/useUserSettings', () => ({
  useUserSettings: () => ({
    itemsPerPage: settings.itemsPerPage,
    confirmTrash: settings.confirmTrash,
    updateSettings: vi.fn(),
  }),
  // The rule, spelled out rather than imported: `vi.mock` replaces what *importers*
  // see, so the real helper — whose call to `useUserSettings` is internal to its own
  // module — would keep reading the real (default) settings and never see the flag
  // above. One line, and it is the line under test on the items page.
  useTrashConfirmation: () => (message: string) => !settings.confirmTrash || window.confirm(message),
}))

// The draft rows returned by `trpc.drafts.list`; reassigned per test so the
// results and empty states can both be exercised without a backend.
let draftData: any[] = []

// The instance's item types, read by `UnpackModal`'s select. Empty by default —
// which is also why the tests below that never touch it keep working.
let typeData: { id: number; name: string; fields: never[] }[] = []

// The bulk-trash action's `mutateAsync`, exposed so a case can assert what the
// button sends. Reaching it from a test is the same deferred-reference pattern as
// `draftData` below: the factory closes over it and only reads it at render.
const trashAllMutate = vi.fn()

// What the list was asked for — the window is a settings preference now, not a
// constant, so the request is the thing to assert it on.
let lastListInput: { page: number; pageSize: number } | null = null

// The single-row trash's, so the row button can be asserted the same way.
const trashOneMutate = vi.fn()

// The bulk-publish action's, for the same reason: it also clears the selection
// on success now, and that is only assertable if the callback is wired through.
const publishAllMutate = vi.fn()

// A minimal draft row. `DraftsPage` reads `id`, `name` and `images` — plus
// `locationId`/`location`, which the card shows as a path.
const draft = (id: number, name: string, location: { id: number; name: string } | null = null) => ({
  id,
  name,
  locationId: location?.id ?? null,
  location,
  images: [{ id: id * 10, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true }],
})

// The location tree the card's path is built from. Nested, because that is what
// `locations.list` returns and the path is the whole point.
let locationData: any[] = []

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
// renders `UnpackModal`, so `itemTypes.list` reads `typeData` above — empty
// unless a case sets it, which is the state most of these want.
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
      locations: { list: { useQuery: () => ({ data: locationData, isLoading: false }) } },
      drafts: {
        // The paginated envelope `drafts.list` returns: one page plus the
        // unpaginated total. `total` is derived so a case only sets the rows.
        list: {
          useQuery: (input: { page: number; pageSize: number }) => {
            lastListInput = input
            return { data: { items: draftData, total: draftData.length }, isLoading: false }
          },
        },
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
        trash: {
          useMutation: () => ({
            ...idleMutation,
            mutateAsync: (input: unknown) => {
              trashOneMutate(input)
            },
          }),
        },
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
        list: { useQuery: () => ({ data: typeData, isLoading: false }) },
      },
    },
  }
})

import { DraftsPage } from '../src/features/drafts'

beforeEach(() => {
  vi.clearAllMocks()
  typeData = []
  locationData = []
  // Off, as the API ships it: a case that asserts the question opts in.
  settings.confirmTrash = false
  settings.itemsPerPage = 20
  lastListInput = null
})

describe('drafts page', () => {
  // A leaf name does not say *which* `garage` — the same argument the catalog card
  // makes, and the drafts card had the same gap.
  it("shows a draft's location as its path", () => {
    locationData = [
      { id: 1, name: 'home', parentId: null, depth: 1, children: [{ id: 2, name: 'garage', parentId: 1, depth: 2 }] },
    ]
    draftData = [draft(1, 'Draft Lamp', { id: 2, name: 'garage' })]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('draft-location')).toHaveTextContent('home › garage')
  })

  it('renders a draft with its name, publish/trash actions, and a select-all checkbox', () => {
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
    expect(screen.getByRole('button', { name: 'drafts.trash' })).toBeInTheDocument()
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

  // A fresh instance has exactly one type, so the select starts with it chosen:
  // opening a select whose only option is the one you must pick is a step that
  // can only go wrong. This is the common case, not the corner one.
  it('preselects the type when the instance has exactly one', () => {
    draftData = []
    typeData = [{ id: 3, name: 'Box', fields: [] }]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('combobox')).toHaveValue('3')
  })

  // The other half of the rule: with a real choice to make, nothing is chosen for
  // you, and the submit guard still has something to say.
  it('leaves the type unpicked when there is more than one', () => {
    draftData = []
    typeData = [{ id: 3, name: 'Box', fields: [] }, { id: 4, name: 'Shelf', fields: [] }]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('combobox')).toHaveValue('')
  })

  // The native photo picker keeps focus after it closes, so choosing a photo hands
  // focus to the first of the two actions: the next move is a keystroke rather
  // than a trip back to the mouse.
  it('moves focus to the manual unpack button once a photo is chosen', () => {
    draftData = []
    typeData = [{ id: 3, name: 'Box', fields: [] }]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )

    const manual = screen.getByRole('button', { name: 'drafts.unpackManual' })
    expect(manual).not.toHaveFocus()

    fireEvent.change(document.querySelector('input[type=file]')!, {
      target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
    })

    expect(manual).toHaveFocus()
  })

  // An instance with no types at all: the select holds nothing but its
  // placeholder, so unpacking cannot finish however good the photo is. Both
  // actions used to answer "Choose a type…" — advice you cannot follow when there
  // are no types to choose from.
  it('says there are no item types instead of telling you to choose one', () => {
    draftData = []
    typeData = []
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )

    // Said beside the controls, not only after a failed submit.
    expect(screen.getByText(/^drafts\.noTypes/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'drafts.createOne' })).toHaveAttribute('href', '/types')
    expect(screen.getByRole('combobox')).toBeDisabled()

    // Both actions are disabled until a photo is picked, so pick one first.
    fireEvent.change(document.querySelector('input[type=file]')!, {
      target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'drafts.unpackManual' }))

    expect(screen.getByRole('alert')).toHaveTextContent('drafts.noTypes')
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

  // The window is the `itemsPerPage` preference, so the drafts page honours the
  // setting the same way the catalog does — and its pagination arithmetic follows.
  it('takes the page window from the preference, and paginates by it', () => {
    settings.itemsPerPage = 1
    draftData = [draft(1, 'Draft Lamp'), draft(2, 'Draft Cup')]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )

    expect(lastListInput?.pageSize).toBe(1)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
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
    const btn = screen.getByRole('button', { name: 'drafts.trashSelected' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveClass('text-danger')
  })

  it('confirms with the number of drafts before discarding, then sends the selected ids', () => {
    draftData = [draft(1, 'Draft Lamp'), draft(2, 'Draft Cup')]
    settings.confirmTrash = true
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    fireEvent.click(screen.getByRole('button', { name: 'drafts.trashSelected' }))
    expect(confirmSpy).toHaveBeenCalledWith('Move 2 draft(s) to the trash?')
    expect(trashAllMutate).toHaveBeenCalledWith({ ids: [1, 2] })
  })

  it('discards nothing when the confirmation is declined', () => {
    draftData = [draft(1, 'Draft Lamp')]
    settings.confirmTrash = true
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    const btn = screen.getByRole('button', { name: 'drafts.trashSelected' })
    fireEvent.click(btn)
    expect(trashAllMutate).not.toHaveBeenCalled()
    expect(btn).toBeEnabled()
  })

  // With the preference off (the default) nothing is asked, anywhere on the page.
  it('moves to the trash without asking when the preference is off', () => {
    draftData = [draft(1, 'Draft Lamp')]
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))

    fireEvent.click(screen.getByRole('button', { name: 'drafts.trashAll' }))
    // The all-action clears the selection once it succeeds, so re-select before
    // the second site — otherwise its button is disabled and the click is a no-op.
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    fireEvent.click(screen.getByRole('button', { name: 'drafts.trashSelected' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(trashAllMutate).toHaveBeenCalledWith({})
    expect(trashAllMutate).toHaveBeenCalledWith({ ids: [1] })
  })

  // The row's own move-to-trash was the one site that never asked. It reads the
  // same preference as the two bulk buttons — "every move-to-trash", not "the
  // scary ones".
  it('asks before trashing a single draft when the preference is on', () => {
    draftData = [draft(1, 'Draft Lamp')]
    settings.confirmTrash = true
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'drafts.trash' }))

    expect(confirmSpy).toHaveBeenCalledWith('Move "Draft Lamp" to the trash?')
    expect(trashOneMutate).not.toHaveBeenCalled()
  })

  it('trashes a single draft without asking when the preference is off', () => {
    draftData = [draft(1, 'Draft Lamp')]
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'drafts.trash' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(trashOneMutate).toHaveBeenCalledWith({ id: 1 })
  })

  it('clears the selection once the discard succeeds', () => {
    draftData = [draft(1, 'Draft Lamp')]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    const btn = screen.getByRole('button', { name: 'drafts.trashSelected' })
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
    settings.confirmTrash = true
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'drafts.trashSelected' }))
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

  // A draft is an item, and its thumbnail opens the same surface a catalog card
  // does. A lightbox here would leave the drafts page with a second, poorer photo
  // experience: no per-photo actions, and no way to publish from it.
  it('links a row thumbnail to the draft\'s own surface', () => {
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
    expect(screen.getByRole('link', { name: 'Open Draft Lamp' })).toHaveAttribute('href', '/items/1')
  })

  // A draft can carry the crops an unpack made of the same photo, so it can have
  // several — and a wheel notch or a swipe over the card is how you look at them
  // before publishing. Same gesture as the catalog card, same badge.
  it('cycles a card’s photos and says where it is', () => {
    draftData = [
      {
        id: 1,
        name: 'Draft Lamp',
        images: [
          { id: 10, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true },
          { id: 11, originalPath: 'uploads/originals/b.png', editedPath: null, thumbPath: 'uploads/thumbs/b.jpg', isPrimary: null },
        ],
      },
    ]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('1/2')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Open Draft Lamp' })
    expect(link.querySelector('img')).toHaveAttribute('src', '/file/uploads/thumbs/a.jpg')

    fireEvent.pointerDown(link, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(link, { pointerId: 1, clientX: 40, clientY: 100 })

    expect(screen.getByText('2/2')).toBeInTheDocument()
    expect(link.querySelector('img')).toHaveAttribute('src', '/file/uploads/thumbs/b.jpg')
  })
})
