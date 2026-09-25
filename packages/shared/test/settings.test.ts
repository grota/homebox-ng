import { describe, it, test, expect } from 'vitest'
import {
  userSettingsSchema,
  userSettingsUpdateSchema,
  DEFAULT_USER_SETTINGS,
  instanceSettingsSchema,
  instanceSettingsUpdateSchema,
  DEFAULT_INSTANCE_SETTINGS,
  ITEMS_PER_PAGE_MAX,
  ITEMS_PER_PAGE_MIN,
} from '../src/settings'

describe('shared settings schemas', () => {
  it('accepts the full settings shape', () => {
    expect(userSettingsSchema.safeParse(DEFAULT_USER_SETTINGS).success).toBe(true)
  })
  it('accepts a partial update', () => {
    expect(userSettingsUpdateSchema.safeParse({ themeMode: 'dark' }).success).toBe(true)
  })
  it('rejects an unknown locale', () => {
    expect(userSettingsUpdateSchema.safeParse({ locale: 'xx-XX' }).success).toBe(false)
  })
  it('rejects an unknown theme mode', () => {
    expect(userSettingsUpdateSchema.safeParse({ themeMode: 'sepia' }).success).toBe(false)
  })
  it('defaults match the spec', () => {
    expect(DEFAULT_USER_SETTINGS).toEqual({
      language: 'en', locale: 'en-US', themeMode: 'auto',
      lightThemeId: 'light-default', darkThemeId: 'dark-default',
      itemsSort: 'createdAt:desc', itemsPerPage: 20, confirmTrash: false,
    })
  })

  // The two list preferences are bounded/typed here, not just in the settings
  // page: this is the schema the API validates a write against, so a value outside
  // it can never reach the database, whatever a client sends.
  it('bounds the page size, and requires a whole number inside it', () => {
    expect(userSettingsUpdateSchema.safeParse({ itemsPerPage: ITEMS_PER_PAGE_MIN }).success).toBe(true)
    expect(userSettingsUpdateSchema.safeParse({ itemsPerPage: ITEMS_PER_PAGE_MAX }).success).toBe(true)

    for (const bad of [0, -1, ITEMS_PER_PAGE_MAX + 1, 2.5]) {
      expect(userSettingsUpdateSchema.safeParse({ itemsPerPage: bad }).success).toBe(false)
    }
  })

  it('takes the trash confirmation as a boolean only', () => {
    expect(userSettingsUpdateSchema.safeParse({ confirmTrash: true }).success).toBe(true)
    expect(userSettingsUpdateSchema.safeParse({ confirmTrash: 'yes' }).success).toBe(false)
  })

  it('accepts a catalog ordering, but not relevance', () => {
    expect(userSettingsUpdateSchema.safeParse({ itemsSort: 'name:asc' }).success).toBe(true)
    // `relevance` is legal on the wire while a search term is active, and is not
    // a preference: with no term there is no rank for it to mean, so storing it
    // would be a preference that silently means something else.
    expect(userSettingsUpdateSchema.safeParse({ itemsSort: 'relevance' }).success).toBe(false)
  })

  test('instanceSettings defaults + partial update', () => {
    expect(DEFAULT_INSTANCE_SETTINGS.maxUploadMb).toBe(10)
    expect(instanceSettingsUpdateSchema.parse({ maxUploadMb: 25 })).toEqual({ maxUploadMb: 25 })
    expect(instanceSettingsSchema.parse(DEFAULT_INSTANCE_SETTINGS).detectionProvider).toBe('google')
  })
})
