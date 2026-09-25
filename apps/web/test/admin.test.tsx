import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import adminJson from '../src/locales/en/admin.json'

vi.mock('react-i18next', () => ({
  // Map the admin page title to its English string so the guard test can assert
  // the page rendered; every other key resolves to itself (the test's concern is
  // routing/guarding, not translation). The rebuilt-count message is the one key
  // that carries a value, so it is interpolated from the real locale file — a
  // single-brace placeholder then fails the assertion instead of silently
  // rendering `{count}`.
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number }) =>
      k === 'admin.title' ? 'Admin'
      : k === 'admin.system.rebuilt' ? adminJson.admin.system.rebuilt.replace('{{count}}', String(opts?.count))
      : k,
  }),
  // `AppRoutes` → `SettingsPage` → `SettingsProvider` touches `i18n.ts`, which
  // calls `i18n.use(initReactI18next)` at module load; satisfy that import.
  initReactI18next: { type: '3rdParty' },
}))

// `AppRoutes` pulls in `ItemDetail` → `PhotoEditor`, which imports the real
// `react-filerobot-image-editor`; its transitive `react-konva` dependency needs
// the (absent) native `canvas` module, so stub the editor out. The `/admin` route
// never renders a photo editor.
vi.mock('react-filerobot-image-editor', async () => await import('./filerobotMock'))

// The active user's role, mutable so each test can exercise admin vs non-admin.
let mockRole: string = 'admin'

// mock the tRPC module so `useAuth` (auth.me) and `SetupGate` (requiresSetup)
// resolve deterministically without a backend. The admin page renders the
// `users` tab by default, so the `users`, `instanceSettings`, `system` routers
// and `useUtils` are stubbed too — otherwise the real client would attempt a
// network call.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const invalidate = vi.fn()
  const idleMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        users: { list: { invalidate } },
        instanceSettings: { get: { invalidate } },
        system: { rebuildFts: { invalidate } },
        items: { list: { invalidate } },
      }),
      auth: {
        me: { useQuery: () => ({ data: { id: 1, email: 'a@b.co', name: 'A', role: mockRole }, isLoading: false }) },
        requiresSetup: { useQuery: () => ({ data: { setupRequired: false }, isLoading: false }) },
      },
      users: {
        list: { useQuery: () => ({ data: [], isLoading: false }) },
        create: { useMutation: () => idleMutation },
        update: { useMutation: () => idleMutation },
        delete: { useMutation: () => idleMutation },
      },
      instanceSettings: {
        get: { useQuery: () => ({ data: { maxUploadMb: 10, detectionProvider: 'google', detectionConfig: null }, isLoading: false }) },
        update: { useMutation: () => idleMutation },
      },
      system: {
        // `onSuccess` is wired through rather than dropped so the rebuild case
        // below can drive the tab's result state; the other cases never click it.
        rebuildFts: {
          useMutation: (options?: { onSuccess?: (data: { reindexed: number }) => void }) => ({
            ...idleMutation,
            mutate: () => options?.onSuccess?.({ reindexed: 3 }),
          }),
        },
      },
      // The non-admin guard lands on `/`, which redirects to the items page, so
      // the catalog's two queries must resolve here too. A stub that omits these
      // does not fail an assertion — it throws inside `ItemsPage` and reports as
      // `Cannot read properties of undefined`.
      items: {
        list: { useQuery: () => ({ data: { items: [], total: 0 }, isLoading: false }) },
      },
      locations: {
        list: { useQuery: () => ({ data: [], isLoading: false }) },
      },
    },
  }
})

import { AppRoutes } from '../src/app/routes'

describe('admin route', () => {
  beforeEach(() => {
    mockRole = 'admin'
  })

  it('renders the admin page for an admin', () => {
    mockRole = 'admin'
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('redirects a non-admin away from /admin to the items page', () => {
    mockRole = 'user'
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    // The admin page must not render…
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
    // …and the user is dropped on the catalog instead: the guard sends them to
    // `/`, which redirects to `/items`. "New item" is a plain literal in
    // `ItemsPage`, so this holds whatever the i18n mock returns for a key.
    expect(screen.getByRole('link', { name: 'New item' })).toBeInTheDocument()
  })

  it('renders the reindexed item count as a number, not a placeholder', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    // Radix selects a tab on `mousedown`, which a real browser dispatches before
    // `click` — `fireEvent.click` alone sends only the latter (see tabs.test.tsx).
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'admin.tabs.system' }))
    fireEvent.click(screen.getByRole('button', { name: 'admin.system.rebuildFts' }))
    expect(screen.getByRole('status')).toHaveTextContent('Reindexed 3 items')
  })
})
