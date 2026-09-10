// Locale-aware formatting built on `Intl` and the user's `locale` preference.
// Kept as pure functions (not tied to a hook) so they're trivially unit-testable
// and reusable without a provider.
export function createFormatters(locale: string) {
  const date = new Intl.DateTimeFormat(locale)
  const currencyCache = new Map<string, Intl.NumberFormat>()

  return {
    formatDate(value: Date | number | string): string {
      return date.format(new Date(value))
    },
    // Currency-typed custom fields render through this using the field's currency
    // code; the formatter is cached per-currency so repeated calls don't rebuild.
    formatCurrency(amount: number, currency: string): string {
      let fmt = currencyCache.get(currency)
      if (!fmt) {
        fmt = new Intl.NumberFormat(locale, { style: 'currency', currency })
        currencyCache.set(currency, fmt)
      }
      return fmt.format(amount)
    },
  }
}

export type Formatters = ReturnType<typeof createFormatters>
