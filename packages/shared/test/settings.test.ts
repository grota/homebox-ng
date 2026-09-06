import { describe, it, expect } from 'vitest'
import {
  userSettingsSchema,
  userSettingsUpdateSchema,
  DEFAULT_USER_SETTINGS,
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
    })
  })
})
