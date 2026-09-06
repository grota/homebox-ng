import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  // `AppRoutes` → `SettingsPage` → `SettingsProvider` touches `i18n.ts`, which
  // calls `i18n.use(initReactI18next)` at module load; satisfy that import.
  initReactI18next: { type: '3rdParty' },
}))

// `AppRoutes` pulls in `ItemDetail` → `PhotoEditor`, which imports the real
// `react-filerobot-image-editor`; its transitive `react-konva` dependency needs
// the (absent) native `canvas` module, so stub the editor out (as
// `photoEditor.test.tsx` does). The `/admin` route never renders a photo editor.
vi.mock('react-filerobot-image-editor', () => ({
  default: () => null,
}))

// The active user's role, mutable so each test can exercise admin vs non-admin.
let mockRole: string = 'admin'

// mock the tRPC module so `useAuth` (auth.me) and `SetupGate` (requiresSetup)
// resolve deterministically without a backend.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      auth: {
        me: { useQuery: () => ({ data: { id: 1, email: 'a@b.co', name: 'A', role: mockRole }, isLoading: false }) },
        requiresSetup: { useQuery: () => ({ data: { setupRequired: false }, isLoading: false }) },
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

  it('redirects a non-admin away from /admin to /', () => {
    mockRole = 'user'
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    // The admin page must not render…
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
    // …and the user is dropped on the home page instead.
    expect(screen.getByRole('heading', { name: 'Homebox' })).toBeInTheDocument()
  })
})
