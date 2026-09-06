import { z } from 'zod'

// Single, curated language list. Phase 4 ships English only; adding a language
// later is a resource file + a new entry here (no code change elsewhere).
export const LANGUAGES = ['en'] as const
export type Language = (typeof LANGUAGES)[number]

// Curated locale list shown on `/settings`. `Intl` formatting is built on the
// user's selected locale.
export const LOCALES = ['en-US', 'en-GB', 'bg-BG', 'de-DE', 'fr-FR', 'it-IT'] as const
export type Locale = (typeof LOCALES)[number]

// Theme mode. `auto` follows `prefers-color-scheme` and resolves client-side to
// the user's chosen light or dark palette.
export const THEME_MODES = ['auto', 'light', 'dark'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const userSettingsSchema = z.object({
  language: z.enum(LANGUAGES),
  locale: z.enum(LOCALES),
  themeMode: z.enum(THEME_MODES),
  lightThemeId: z.string().min(1),
  darkThemeId: z.string().min(1),
})
export type UserSettingsDto = z.infer<typeof userSettingsSchema>

// `settings.update` takes any subset of the settings fields.
export const userSettingsUpdateSchema = userSettingsSchema.partial()
export type UserSettingsInput = z.infer<typeof userSettingsUpdateSchema>

// Returned by `settings.get` when no `user_settings` row exists yet (a fresh
// user gets these without a write).
export const DEFAULT_USER_SETTINGS: UserSettingsDto = {
  language: 'en',
  locale: 'en-US',
  themeMode: 'auto',
  lightThemeId: 'light-default',
  darkThemeId: 'dark-default',
}
