import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock tRPC so the page renders without a backend. The provider is bypassed by
// mocking `useUserSettings` directly (the page's only dependency on settings).
const { updateSettings, setPreview, settings, preview } = vi.hoisted(() => ({
  updateSettings: vi.fn(async (input: any) => input),
  // The preview the provider would lay over the stored values, and the setter that
  // moves it. Emulated here because it is the page's contract: `useUserSettings`
  // returns the *previewed* settings, `storedSettings` never is.
  preview: { current: null as Record<string, unknown> | null },
  setPreview: vi.fn((next: Record<string, unknown> | null) => {
    preview.current = next
  }),
  // Mutable, so a case can start the page from the stored values it cares about.
  settings: {
    language: 'en',
    locale: 'en-US',
    themeMode: 'auto',
    lightThemeId: 'light-default',
    darkThemeId: 'dark-dracula',
    itemsSort: 'createdAt:desc',
    itemsPerPage: 20,
    confirmTrash: false,
    skipSaveDialog: true,
  },
}))

vi.mock('../src/lib/settings/useUserSettings', () => ({
  useUserSettings: () => ({
    ...settings,
    ...(preview.current ?? {}),
    // What the page seeds its draft and its dirty check from: the stored values,
    // which a preview never touches.
    storedSettings: settings,
    formatDate: () => 'Sept 6, 2026',
    updateSettings,
    setPreview,
  }),
  // The page itself does not trash anything; the helper is stubbed only so the
  // import resolves.
  useTrashConfirmation: () => () => true,
  __updateSettings: updateSettings,
  __setPreview: setPreview,
}))

vi.mock('../src/lib/theme/registry', () => ({
  lightThemes: [{ id: 'light-default', name: 'Homebox Light', dark: false }],
  darkThemes: [{ id: 'dark-dracula', name: 'Dracula', dark: true }],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { SettingsPage } from '../src/features/settings/SettingsPage'

const renderPage = () => render(<MemoryRouter><SettingsPage /></MemoryRouter>)
const label = (key: string) => screen.getByLabelText(key)
const save = () => screen.getByRole('button', { name: 'settings.save' })

beforeEach(() => {
  vi.clearAllMocks()
  preview.current = null
  settings.locale = 'en-US'
  settings.themeMode = 'auto'
  settings.lightThemeId = 'light-default'
  // The mocked registry below offers exactly one dark palette, so this is the
  // only stored value the select can show — `dark-default` is not an option here.
  settings.darkThemeId = 'dark-dracula'
  settings.itemsSort = 'createdAt:desc'
  settings.itemsPerPage = 20
  settings.confirmTrash = false
  settings.skipSaveDialog = true
})

describe('SettingsPage', () => {
  // Every field is filled from the stored settings — including `itemsPerPage`,
  // which is the one a control can render as *empty* rather than wrong when the
  // value is missing. An `<input type="number">` with an `undefined` value shows
  // nothing at all, which reads as "not set" instead of "not loaded".
  it('renders every stored setting, with a value in every control', () => {
    renderPage()

    expect(label('settings.locale')).toHaveValue('en-US')
    expect(label('settings.themeMode')).toHaveValue('auto')
    expect(label('settings.lightPalette')).toHaveValue('light-default')
    expect(label('settings.darkPalette')).toHaveValue('dark-dracula')
    expect(label('settings.itemsSort')).toHaveValue('createdAt:desc')
    expect(label('settings.itemsPerPage')).toHaveValue(20)
    expect(label('settings.confirmTrash')).not.toBeChecked()
    expect(label('settings.skipSaveDialog')).toBeChecked()
  })

  // One Save, not a write per control: nothing reaches the server until it is
  // pressed, which is what leaves something to preview.
  it('writes nothing until Save, then writes the whole set', () => {
    renderPage()

    fireEvent.change(label('settings.themeMode'), { target: { value: 'dark' } })
    fireEvent.change(label('settings.locale'), { target: { value: 'de-DE' } })
    fireEvent.click(label('settings.confirmTrash'))
    fireEvent.click(label('settings.skipSaveDialog'))
    expect(updateSettings).not.toHaveBeenCalled()

    fireEvent.click(save())

    expect(updateSettings).toHaveBeenCalledWith({
      locale: 'de-DE',
      themeMode: 'dark',
      lightThemeId: 'light-default',
      darkThemeId: 'dark-dracula',
      itemsSort: 'createdAt:desc',
      itemsPerPage: 20,
      confirmTrash: true,
      skipSaveDialog: false,
    })
  })

  it('offers Save only when something has changed', () => {
    renderPage()
    expect(save()).toBeDisabled()

    fireEvent.change(label('settings.itemsSort'), { target: { value: 'name:asc' } })
    expect(save()).toBeEnabled()

    // ...and back, so a change that is undone is not a pending change.
    fireEvent.change(label('settings.itemsSort'), { target: { value: 'createdAt:desc' } })
    expect(save()).toBeDisabled()
  })

  // The page size is typed, not picked, so it is the one field that can hold a
  // value the API would refuse. Rather than clamping it behind the user's back,
  // Save is unavailable and the field says what it wants.
  it('will not save a page size outside the bounds, and says why', () => {
    renderPage()

    fireEvent.change(label('settings.itemsPerPage'), { target: { value: '5000' } })
    expect(save()).toBeDisabled()
    expect(screen.getByText('settings.itemsPerPageRange')).toBeInTheDocument()

    fireEvent.change(label('settings.itemsPerPage'), { target: { value: '' } })
    expect(save()).toBeDisabled()

    fireEvent.change(label('settings.itemsPerPage'), { target: { value: '50' } })
    expect(save()).toBeEnabled()
    expect(screen.queryByText('settings.itemsPerPageRange')).not.toBeInTheDocument()

    fireEvent.click(save())
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ itemsPerPage: 50 }))
  })

  // The theme is the control with something to look at, so it can be shown without
  // being stored. It goes through the provider's preview, never through a write —
  // a "preview" that persists is not a preview.
  it('previews the drafted theme without storing it, and drops it when pressed again', () => {
    renderPage()

    fireEvent.change(label('settings.themeMode'), { target: { value: 'dark' } })
    fireEvent.change(label('settings.darkPalette'), { target: { value: 'dark-dracula' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.previewTheme' }))

    expect(setPreview).toHaveBeenCalledWith({
      themeMode: 'dark',
      lightThemeId: 'light-default',
      darkThemeId: 'dark-dracula',
    })
    expect(updateSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'settings.previewTheme' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'settings.previewTheme' }))
    expect(setPreview).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('button', { name: 'settings.previewTheme' })).toHaveAttribute('aria-pressed', 'false')
  })

  // Saving is the commit, so a preview left on would keep overriding the value it
  // was standing in for.
  it('drops the preview once the theme is saved', () => {
    renderPage()

    fireEvent.change(label('settings.themeMode'), { target: { value: 'dark' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.previewTheme' }))
    fireEvent.click(save())

    expect(setPreview).toHaveBeenLastCalledWith(null)
  })

  // The preview stands in for a *stored* value, so it must not feed the form back
  // through the settings the page reads: seeding the draft from the previewed
  // values made toggling the preview off look like a write, and the draft the user
  // was holding went with it. Found in the browser, where the button greyed out.
  it('keeps an unsaved change when the preview is stopped', () => {
    renderPage()

    fireEvent.change(label('settings.themeMode'), { target: { value: 'dark' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.previewTheme' }))
    fireEvent.click(screen.getByRole('button', { name: 'settings.previewTheme' }))

    expect(label('settings.themeMode')).toHaveValue('dark')
    expect(save()).toBeEnabled()
  })

  // The preview describes settings that were never stored, so it must not outlive
  // the page that showed it.
  it('drops the preview when the page goes away', () => {
    const { unmount } = render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )

    unmount()

    expect(setPreview).toHaveBeenCalledWith(null)
  })
})
