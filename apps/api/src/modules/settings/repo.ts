import { eq } from 'drizzle-orm'
import { userSettings } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import type { UserSettingsDto } from '@homebox/shared'

// Row shape surfaced by the app layer (camelCase keys; the schema is already
// camelCase on the JS surface). `theme_mode` is a TEXT column (`enum` in Drizzle
// only constrains the TS type, not SQLite), so the row type keeps `string`.
export type UserSettingsRow = {
  userId: number
  language: string
  locale: string
  themeMode: string
  lightThemeId: string
  darkThemeId: string
  itemsSort: string
  itemsPerPage: number
  confirmTrash: boolean
  skipSaveDialog: boolean
  expandLocationTree: boolean
  photoOpensItem: boolean
}

// Select only the DTO columns (never the `id`).
const ROW_FIELDS = {
  userId: userSettings.userId,
  language: userSettings.language,
  locale: userSettings.locale,
  themeMode: userSettings.themeMode,
  lightThemeId: userSettings.lightThemeId,
  darkThemeId: userSettings.darkThemeId,
  itemsSort: userSettings.itemsSort,
  itemsPerPage: userSettings.itemsPerPage,
  confirmTrash: userSettings.confirmTrash,
  skipSaveDialog: userSettings.skipSaveDialog,
  expandLocationTree: userSettings.expandLocationTree,
  photoOpensItem: userSettings.photoOpensItem,
} as const

export const getByUserId = (db: DrizzleDb, userId: number): UserSettingsRow | undefined =>
  db.select(ROW_FIELDS).from(userSettings).where(eq(userSettings.userId, userId)).get()

// Upsert by the `user_id` unique index: insert the row, or update it in place on
// conflict. Returns the resulting row so callers can read it back immediately.
export const upsert = (db: DrizzleDb, userId: number, data: UserSettingsDto): UserSettingsRow =>
  db
    .insert(userSettings)
    .values({ userId, ...data })
    .onConflictDoUpdate({ target: userSettings.userId, set: data })
    .returning(ROW_FIELDS)
    .get()
