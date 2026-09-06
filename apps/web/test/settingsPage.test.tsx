import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock tRPC so the page renders without a backend. The provider is bypassed by
// mocking `useUserSettings` directly (the page's only dependency on settings).
vi.mock('../src/lib/settings/useUserSettings', () => {
  const updateSettings = vi.fn(async (input: any) => input)
  return {
    useUserSettings: () => ({
      language: 'en',
      locale: 'en-US',
      themeMode: 'auto',
      lightThemeId: 'light-default',
      darkThemeId: 'dark-default',
      formatDate: () => 'Sept 6, 2026',
      updateSettings,
    }),
    __updateSettings: updateSettings,
  }
})

vi.mock('../src/lib/theme/registry', () => ({
  lightThemes: [{ id: 'light-default', name: 'Homebox Light', dark: false }],
  darkThemes: [{ id: 'dark-dracula', name: 'Dracula', dark: true }],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { SettingsPage } from '../src/features/settings/SettingsPage'

beforeEach(() => vi.clearAllMocks())

describe('SettingsPage', () => {
  it('renders the current settings and applies an optimistic update', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)

    expect(screen.getByLabelText('settings.locale')).toHaveValue('en-US')
    expect(screen.getByLabelText('settings.themeMode')).toHaveValue('auto')

    fireEvent.change(screen.getByLabelText('settings.themeMode'), { target: { value: 'dark' } })
    // Grab the mocked-only export the same way searchFacets.test.tsx does, so tsc
    // doesn't check it against the real (unmocked) module's type.
    const { __updateSettings } = (await import('../src/lib/settings/useUserSettings')) as any
    expect(__updateSettings).toHaveBeenCalledWith({ themeMode: 'dark' })
  })
})
