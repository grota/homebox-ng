import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// mock the tRPC module so hooks resolve deterministically without a backend.
// `Provider` is a passthrough so <AppProviders> (which renders <trpc.Provider>)
// doesn't blow up; `useUtils` supplies the invalidate helpers used by the pages;
// `items.update` is added so the create/edit form can call it unconditionally.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        items: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } },
      }),
      items: {
        list: {
          useQuery: () => ({
            data: {
              items: [
                { id: 1, name: 'Lamp', thumbPath: 'uploads/thumbs/x.jpg', location: null, type: null, tags: [] },
              ],
              total: 1,
            },
            isLoading: false,
          }),
        },
        create: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
        update: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
      },
      locations: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      itemTypes: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      tags: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
    },
  }
})

import { ItemsPage } from '../src/features/items/ItemsPage'
import { AppProviders } from '../src/app/AppProviders'

describe('catalog pages', () => {
  it('renders the item list and a create form', async () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    expect(await screen.findByText(/Lamp/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /new item/i }))
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })
})
