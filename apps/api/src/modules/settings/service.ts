import type { DrizzleDb } from '@homebox/db'
import {
  DEFAULT_USER_SETTINGS,
  type UserSettingsDto,
  type UserSettingsInput,
} from '@homebox/shared'
import * as repo from './repo.js'
import type { UserSettingsRow } from './repo.js'

// Normalize a DB row (whose `theme_mode`/`language`/`locale` are `string`) into
// the validated `UserSettingsDto` shape. The `as` casts are safe because the
// values are validated by the zod `userSettingsUpdateSchema` on the write path
// and constrained to the enum sets before they reach the DB.
const toDto = (row: UserSettingsRow): UserSettingsDto => ({
  language: row.language as UserSettingsDto['language'],
  locale: row.locale as UserSettingsDto['locale'],
  themeMode: row.themeMode as UserSettingsDto['themeMode'],
  lightThemeId: row.lightThemeId,
  darkThemeId: row.darkThemeId,
  itemsSort: row.itemsSort as UserSettingsDto['itemsSort'],
  // No casts: the columns are an integer and booleans, and the range is enforced
  // on the wire.
  itemsPerPage: row.itemsPerPage,
  confirmTrash: row.confirmTrash,
  skipSaveDialog: row.skipSaveDialog,
  expandLocationTree: row.expandLocationTree,
  photoOpensItem: row.photoOpensItem,
})

// Returns the user's settings row, or the spec defaults when none exists (a
// fresh user gets `auto`/`en`/`en-US` without a write).
export const getSettings = (db: DrizzleDb, userId: number): UserSettingsDto => {
  const row = repo.getByUserId(db, userId)
  return row ? toDto(row) : { ...DEFAULT_USER_SETTINGS }
}

// Merges the partial `input` over the current settings and upserts the row.
// This is how a fresh user's first update creates the row (a partial update that
// only touches `themeMode` still writes the remaining defaults).
export const updateSettings = (db: DrizzleDb, userId: number, input: UserSettingsInput): UserSettingsDto => {
  const current = getSettings(db, userId)
  const merged: UserSettingsDto = { ...current, ...input }
  return toDto(repo.upsert(db, userId, merged))
}
