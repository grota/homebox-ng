import { createContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { trpc } from '../../api/trpc'
import { DEFAULT_USER_SETTINGS, type UserSettingsInput } from '@homebox/shared'
import { ThemeProvider } from '../theme/ThemeProvider'
import i18n from '../i18n'

export type SettingsContextValue = {
  /** What the app renders with: `storedSettings` with any preview laid over it. */
  settings: typeof DEFAULT_USER_SETTINGS
  /**
   * The user's stored settings, never a preview. A page that edits settings needs
   * this one to seed its draft and to tell "changed" from "saved" — reading the
   * previewed object there makes a preview look like a write, which silently
   * discards whatever the form was in the middle of.
   */
  storedSettings: typeof DEFAULT_USER_SETTINGS
  updateSettings: (input: UserSettingsInput) => Promise<typeof DEFAULT_USER_SETTINGS>
  /**
   * Show a set of settings *without* storing them — the settings page's theme
   * preview. `null` drops it. Never written anywhere, and always on top of the
   * stored values, so it is a stand-in rather than a second source of truth.
   */
  setPreview: (preview: UserSettingsInput | null) => void
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_USER_SETTINGS,
  storedSettings: DEFAULT_USER_SETTINGS,
  updateSettings: async () => DEFAULT_USER_SETTINGS,
  setPreview: () => {},
})

// Fetches the current user's settings once, provides them to consumers, and
// drives the theme (via ThemeProvider) and the i18n language. On an
// unauthenticated request, `settings.get` rejects — we fall back to the spec
// defaults so the login/setup screens still render (they show the default light
// theme).
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data } = trpc.settings.get.useQuery(undefined, { retry: false })
  // Merged *over* the spec defaults rather than `data ?? DEFAULT`: a field is
  // filled in even when the response is an older shape that lacks it. `??` only
  // covered a response that never arrived, so a settings field added by a newer
  // web against an older API came back `undefined` — and an `undefined` in an
  // `<input type="number">` renders as an empty box, which reads as "no value
  // set" rather than "not loaded yet".
  const [preview, setPreview] = useState<UserSettingsInput | null>(null)
  const storedSettings = useMemo(() => ({ ...DEFAULT_USER_SETTINGS, ...data }), [data])
  const settings = useMemo(() => ({ ...storedSettings, ...preview }), [storedSettings, preview])
  const utils = trpc.useUtils()

  const updateSettings = trpc.settings.update.useMutation({
    onMutate: async (input) => {
      await utils.settings.get.cancel()
      const prev = utils.settings.get.getData(undefined)
      utils.settings.get.setData(undefined, (old) => ({ ...(old ?? DEFAULT_USER_SETTINGS), ...input }))
      return { prev }
    },
    onError: (_err, _input, ctx) => {
      if (ctx) utils.settings.get.setData(undefined, ctx.prev)
    },
    onSettled: () => utils.settings.get.invalidate(),
  })

  // The per-user `language` selects the active i18n resource (only `en` ships).
  useEffect(() => {
    void i18n.changeLanguage(settings.language)
  }, [settings.language])

  // `setPreview` is `useState`'s own setter, so it is stable across renders —
  // which is what lets a page clear its preview in an unmount effect without that
  // effect firing (and clearing it) on every render.
  const value = useMemo<SettingsContextValue>(
    () => ({ settings, storedSettings, updateSettings: updateSettings.mutateAsync, setPreview }),
    [settings, storedSettings, updateSettings.mutateAsync]
  )

  return (
    <SettingsContext.Provider value={value}>
      <ThemeProvider
        themeMode={settings.themeMode}
        lightThemeId={settings.lightThemeId}
        darkThemeId={settings.darkThemeId}
      >
        {children}
      </ThemeProvider>
    </SettingsContext.Provider>
  )
}
