import { createContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { trpc } from '../../api/trpc'
import { DEFAULT_USER_SETTINGS, type UserSettingsInput } from '@homebox/shared'
import { ThemeProvider } from '../theme/ThemeProvider'
import i18n from '../i18n'

export type SettingsContextValue = {
  settings: typeof DEFAULT_USER_SETTINGS
  updateSettings: (input: UserSettingsInput) => Promise<typeof DEFAULT_USER_SETTINGS>
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_USER_SETTINGS,
  updateSettings: async () => DEFAULT_USER_SETTINGS,
})

// Fetches the current user's settings once, provides them to consumers, and
// drives the theme (via ThemeProvider) and the i18n language. On an
// unauthenticated request, `settings.get` rejects — we fall back to the spec
// defaults so the login/setup screens still render (they show the default light
// theme). Setting `data ?? DEFAULT` (never throwing) is what makes the default
// light palette render for unauthenticated pages.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data } = trpc.settings.get.useQuery(undefined, { retry: false })
  const settings = useMemo(() => data ?? DEFAULT_USER_SETTINGS, [data])
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

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, updateSettings: updateSettings.mutateAsync }),
    [settings, updateSettings.mutateAsync]
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
