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

// Detection provider selection (Phase 5 ships the setting + interface only; the
// concrete providers are wired in a later phase).
export const DETECTION_PROVIDERS = ['local', 'google', 'openai'] as const
export type DetectionProvider = (typeof DETECTION_PROVIDERS)[number]

// Single row of instance-wide settings.
export const instanceSettingsSchema = z.object({
  maxUploadMb: z.number().int().positive(),
  detectionProvider: z.enum(DETECTION_PROVIDERS),
  detectionConfig: z.record(z.unknown()).nullish(),
})
export type InstanceSettingsDto = z.infer<typeof instanceSettingsSchema>

// `instanceSettings.update` takes any subset.
export const instanceSettingsUpdateSchema = instanceSettingsSchema.partial()
export type InstanceSettingsInput = z.infer<typeof instanceSettingsUpdateSchema>

// Used when no row exists yet.
export const DEFAULT_INSTANCE_SETTINGS: InstanceSettingsDto = {
  maxUploadMb: 10,
  detectionProvider: 'google',
  detectionConfig: null,
}
