import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// The draft rows returned by `trpc.drafts.list`; reassigned per test so the
// results and empty states can both be exercised without a backend.
let draftData: any[] = []

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
})
