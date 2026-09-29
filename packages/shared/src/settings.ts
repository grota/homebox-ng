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

// Orderings the catalog list accepts. Every one of them is *total* — the server
// appends the item id — because `items.list` pages with LIMIT/OFFSET, and an
// ordering that is not total can return a row in two places or in none across a
// page boundary.
export const ITEM_SORTS = [
  'relevance',
  'createdAt:desc',
  'createdAt:asc',
  'updatedAt:desc',
  'updatedAt:asc',
  'name:asc',
  'name:desc',
] as const
export type ItemSort = (typeof ITEM_SORTS)[number]

// The orderings offered as a *stored preference*, which is `ITEM_SORTS` without
// `relevance`. Relevance is a consequence of searching rather than a preference:
// the items page uses it while a search term is active and the user has not
// chosen otherwise, and it is never written down. With no search term there is no
// rank to order by, so a stored `relevance` would silently mean newest-first.
export const ITEM_SORT_PREFERENCES = [
  'createdAt:desc',
  'createdAt:asc',
  'updatedAt:desc',
  'updatedAt:asc',
  'name:asc',
  'name:desc',
] as const
export type ItemSortPreference = (typeof ITEM_SORT_PREFERENCES)[number]

export const DEFAULT_ITEM_SORT: ItemSortPreference = 'createdAt:desc'

// How many rows a page of a paged list holds — the catalog, the drafts, the
// trash. A per-user preference for `itemsSort`'s reason: how much of a list you
// want in front of you at once is yours, not the instance's.
//
// The bound is shared rather than local to the field, because both ends of the
// wire have to agree on what a legal window is: this is what the settings field
// refuses to store, and the same numbers are what the list procedures refuse to
// be asked for, so a hand-made request cannot ask for a window the stored
// preference could never hold.
export const ITEMS_PER_PAGE_MIN = 1
export const ITEMS_PER_PAGE_MAX = 100
export const DEFAULT_ITEMS_PER_PAGE = 20

export const userSettingsSchema = z.object({
  language: z.enum(LANGUAGES),
  locale: z.enum(LOCALES),
  themeMode: z.enum(THEME_MODES),
  lightThemeId: z.string().min(1),
  darkThemeId: z.string().min(1),
  itemsSort: z.enum(ITEM_SORT_PREFERENCES),
  itemsPerPage: z.number().int().min(ITEMS_PER_PAGE_MIN).max(ITEMS_PER_PAGE_MAX),
  // Ask before moving anything to the trash. Defaults to `false` — off — so the
  // trash acts immediately unless the user opts into being asked. It governs
  // *every* move-to-trash (the catalog's selection, a draft, one item), which is
  // why it lives here rather than beside any one of those buttons.
  confirmTrash: z.boolean(),
  // Skip the photo editor's save-as dialog (name/format/quality) and save with
  // its defaults straight away. Defaults to `true` — on — so picking a photo is
  // one dialog rather than two unless the user opts into the second one. It
  // governs both photo dialogs (the at-create crop and Edit photo), which is
  // why it lives here rather than beside either of them.
  skipSaveDialog: z.boolean(),
  // Start the catalog's location facet fully expanded. Defaults to `true` — the
  // tree is already fetched and counted on every list request whether it is
  // drawn open or not, so expanding only renders more rows. Manual open/close
  // clicks stay in-memory view state; this only seeds the initial set.
  expandLocationTree: z.boolean(),
  // Which part of the catalog card opens the item and which selects it. `true` —
  // on, and the default — says the card's photo opens the item surface and its
  // title toggles the selection; `false` swaps the two, which is what the card did
  // before ADR-0013 and is kept as a per-user opt-in rather than deleted. An item
  // with no photo is the same card either way: there is no photo target to swap.
  photoOpensItem: z.boolean(),
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
  itemsSort: DEFAULT_ITEM_SORT,
  itemsPerPage: DEFAULT_ITEMS_PER_PAGE,
  confirmTrash: false,
  skipSaveDialog: true,
  expandLocationTree: true,
  photoOpensItem: true,
}

// Detection provider selection. `DETECTION_PROVIDERS[number]` is the value stored
// in `instance_settings.detection_provider` and the name `register.ts` registers
// each built-in provider under.
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
