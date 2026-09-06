import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// Stub the tRPC router so the tab renders without a backend. `updateMutateAsync`
// and `invalidate` are created HERE (not at module top level) because `vi.mock`
// is hoisted above the file's `const`s; they're re-exposed under `__test` so the
// test body can assert on the persisted payload.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const invalidate = vi.fn()
  const updateMutateAsync = vi.fn(async (input: any) => input)
  // React Query keeps a stable reference across renders; the component's
  // hydration `useEffect` depends on `[data]`, so the mock must too, otherwise
  // the effect re-runs every render and resets the edited fields.
  const settingsData = { maxUploadMb: 10, detectionProvider: 'remote', detectionConfig: null }

  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ instanceSettings: { get: { invalidate } } }),
      instanceSettings: {
        get: {
          useQuery: () => ({ data: settingsData, isLoading: false }),
        },
        update: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: updateMutateAsync, isPending: false, error: null }) },
      },
    },
    __test: { updateMutateAsync, invalidate },
  }
})

import { AdminSettingsTab } from '../src/features/admin/AdminSettingsTab'

beforeEach(() => vi.clearAllMocks())

describe('AdminSettingsTab', () => {
  it('persists the edited settings via update', async () => {
    const m = (await import('../src/api/trpc')) as any
    render(<AdminSettingsTab />)

    fireEvent.change(await screen.findByLabelText('admin.settings.maxUploadMb'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('radio', { name: 'admin.settings.local' }))
    fireEvent.change(screen.getByLabelText('admin.settings.model'), { target: { value: 'mymodel' } })
    fireEvent.click(screen.getByRole('button', { name: 'admin.settings.save' }))

    await waitFor(() =>
      expect(m.__test.updateMutateAsync).toHaveBeenCalledWith({
        maxUploadMb: 25,
        detectionProvider: 'local',
        detectionConfig: { model: 'mymodel' },
      }),
    )
    await waitFor(() => expect(m.__test.invalidate).toHaveBeenCalled())
  })
})
