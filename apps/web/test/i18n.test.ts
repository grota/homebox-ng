import { describe, it, expect } from 'vitest'
import i18n from '../src/lib/i18n'

describe('i18n', () => {
  it('renders the bundled English string', () => {
    expect(i18n.t('settings.title')).toBe('Settings')
  })
  it('defaults to English', () => {
    expect(i18n.language).toBe('en')
  })
})
