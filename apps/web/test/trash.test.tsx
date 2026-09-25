import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', async (importOriginal) => ({
  // Spread the real module: the page now reaches `lib/i18n` through
  // `useUserSettings` → `SettingsProvider`, and that calls `initReactI18next`. A
  // mock that leaves it out makes the import fail rather than the assertion.
  ...(await importOriginal<typeof import('react-i18next')>()),
  // Keys come through as keys, which is what the assertions below read.
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

// `vi.hoisted` runs before the `vi.mock` factories — they are hoisted above the
// imports, so a plain top-level const here would still be in its dead zone when
// the factory reads it. `state.rows` is mutable so each case sets its own list.
const { restoreMutate, purgeMutate, purgeAllMutate, state } = vi.hoisted(() => ({
  restoreMutate: vi.fn(),
  purgeMutate: vi.fn(),
  purgeAllMutate: vi.fn(),
  state: { rows: [] as unknown[] },
}))

const setRows = (rows: unknown[]) => { state.rows = rows }

// What the list was asked for: the window is a settings preference now, not a
// constant, so the request is the thing to assert it on.
let lastListInput: { page: number; pageSize: number } | null = null

// The page-size preference. Module-scoped and mutable so a case can set the window
// it wants; `useTrashConfirmation` is stubbed only so the import resolves, since
// this page's confirms are purges and are deliberately not this preference's
// business.
const settings = vi.hoisted(() => ({ itemsPerPage: 20 }))

vi.mock('../src/lib/settings/useUserSettings', () => ({
  useUserSettings: () => ({ itemsPerPage: settings.itemsPerPage, updateSettings: vi.fn() }),
  useTrashConfirmation: () => () => true,
}))

// The location tree the row's path is built from, read lazily by the mock factory
// (which runs on import, after this declaration).
let locationData: any[] = []

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Kettle',
  published: true,
  trashedAt: new Date('2026-09-10T12:00:00Z'),
  images: [{ id: 10, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true }],
  ...over,
})

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const invalidate = vi.fn()
  const mutation = (spy: (x: unknown) => void) => () => ({
    mutate: spy, mutateAsync: async (x: unknown) => { spy(x) }, isPending: false, error: null,
  })
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ trash: { list: { invalidate } } }),
      locations: { list: { useQuery: () => ({ data: locationData, isLoading: false }) } },
      trash: {
        list: {
          useQuery: (input: { page: number; pageSize: number }) => {
            lastListInput = input
            return { data: { items: state.rows, total: state.rows.length }, isLoading: false }
          },
        },
        restore: { useMutation: mutation(restoreMutate) },
        purge: { useMutation: mutation(purgeMutate) },
        purgeAll: { useMutation: mutation(purgeAllMutate) },
      },
    },
  }
})

import { TrashPage } from '../src/features/trash'

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/trash']}>
      <TrashPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  locationData = []
  // The shipped default; the case below sets its own window.
  settings.itemsPerPage = 20
  lastListInput = null
})

describe('trash page', () => {
  // The window is the `itemsPerPage` preference rather than a constant, and the
  // pagination arithmetic has to follow it or the control and the request would
  // disagree about how many pages there are.
  it('takes the page window from the preference, and paginates by it', () => {
    settings.itemsPerPage = 1
    setRows([row({ id: 1 }), row({ id: 2, name: 'Kettle Two' })])

    renderPage()

    expect(lastListInput?.pageSize).toBe(1)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  // Where a thing came from is what tells you whether restoring it is right — and
  // a leaf name does not say which `garage`.
  it("shows a trashed item's location as its path", () => {
    locationData = [
      { id: 1, name: 'home', parentId: null, depth: 1, children: [{ id: 2, name: 'garage', parentId: 1, depth: 2 }] },
    ]
    setRows([row({ locationId: 2, location: { id: 2, name: 'garage' } })])

    renderPage()

    expect(screen.getByText(/home › garage/)).toBeInTheDocument()
  })
  it('says so when the trash is empty', () => {
    setRows([])
    renderPage()
    expect(screen.getByText('trash.empty')).toBeInTheDocument()
  })

  // Drafts and items share the trash, and which one a row is decides where
  // Restore puts it — so the label is not decoration.
  it('labels a trashed item and a trashed draft differently', () => {
    setRows([row({ id: 1, name: 'Kettle', published: true }), row({ id: 2, name: 'Draft Cup', published: false })])
    renderPage()
    expect(screen.getByText('Kettle')).toBeInTheDocument()
    expect(screen.getByText('Draft Cup')).toBeInTheDocument()
    // Substring matchers: the label shares its element with the timestamp.
    expect(screen.getAllByText(/trash\.kindItem/)).toHaveLength(1)
    expect(screen.getAllByText(/trash\.kindDraft/)).toHaveLength(1)
    expect(screen.getAllByText(/trash\.trashedWhen/)).toHaveLength(2)
  })

  it('restores a row without asking', () => {
    setRows([row({ id: 7 })])
    const confirm = vi.spyOn(window, 'confirm')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'trash.restore' }))
    expect(restoreMutate).toHaveBeenCalledWith({ id: 7 })
    // Restoring is recoverable in the other direction, so it must not be gated.
    expect(confirm).not.toHaveBeenCalled()
  })

  it('confirms before deleting a row for good, and names it', () => {
    setRows([row({ id: 7, name: 'Kettle' })])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'trash.purgeOne' }))
    expect(confirm).toHaveBeenCalled()
    expect(purgeMutate).toHaveBeenCalledWith({ id: 7 })
  })

  it('deletes nothing when the confirmation is declined', () => {
    setRows([row({ id: 7 })])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'trash.purgeOne' }))
    expect(purgeMutate).not.toHaveBeenCalled()
  })

  // No ids: the server's existing "everything" branch, so this cannot quietly
  // come to mean "the page you are looking at".
  it('empties the whole trash with no ids after confirming', () => {
    setRows([row({ id: 1 }), row({ id: 2 })])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'trash.purgeAll' }))
    expect(purgeAllMutate).toHaveBeenCalledWith({})
  })
})
