import { describe, it, expect } from 'vitest'
import { createFormatters } from '../src/lib/settings/format'

describe('createFormatters', () => {
  it('formats a date in the chosen locale', () => {
    const { formatDate } = createFormatters('de-DE')
    // 6 September 2026 (built from local components to avoid the test running in a
    // timezone that shifts the UTC instant across midnight) → "6.9.2026" in de-DE.
    expect(formatDate(new Date(2026, 8, 6))).toBe('6.9.2026')
  })
  it('formats a currency with the field currency code', () => {
    const { formatCurrency } = createFormatters('de-DE')
    // No explicit `opts`; the currency code drives the output symbol/placement.
    // de-DE: thousands '.', decimal ',' → 1234.50 EUR → "1.234,50 €" (the space
    // before € may be a no-break space, so assert the numeric token and symbol
    // separately rather than an exact string).
    const out = formatCurrency(1234.5, 'EUR')
    expect(out).toMatch(/1\.234,50/)
    expect(out).toContain('€')
  })
  it('falls back to defaults for unauthenticated consumers (spec defaults)', async () => {
    // The provider reads `data ?? DEFAULT_USER_SETTINGS`; this asserts the shape.
    const { DEFAULT_USER_SETTINGS } = await import('@homebox/shared')
    expect(DEFAULT_USER_SETTINGS.themeMode).toBe('auto')
    expect(DEFAULT_USER_SETTINGS.locale).toBe('en-US')
  })
})
