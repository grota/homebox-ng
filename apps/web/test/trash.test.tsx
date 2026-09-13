import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
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
      trash: {
        list: { useQuery: () => ({ data: { items: state.rows, total: state.rows.length }, isLoading: false }) },
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

beforeEach(() => vi.clearAllMocks())

describe('trash page', () => {
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
