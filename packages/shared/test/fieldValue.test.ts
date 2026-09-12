import { describe, it, expect } from 'vitest'
import { FIELD_TYPES, fitsFieldType } from '../src/fieldValue'

describe('fitsFieldType', () => {
  // text accepts anything, including an empty string: the emptiness rule is
  // about whether a value counts as *data*, not about fitting a type.
  it('accepts anything for text', () => {
    for (const v of ['', 'large', '120 cm', 'not a url']) expect(fitsFieldType('text', v)).toBe(true)
  })

  it('accepts only real numbers for number and currency', () => {
    for (const v of ['1', '-2.5', '1e3', '.5', '120.00', ' 7 ']) {
      expect(fitsFieldType('number', v)).toBe(true)
      expect(fitsFieldType('currency', v)).toBe(true)
    }
    // '' is not a number (Number('') is 0), and these are the cases where
    // Number() is more permissive than the browser's valid floating-point number.
    for (const v of ['', '   ', 'large', '120 cm', '1,000', '0x10', 'Infinity', 'NaN']) {
      expect(fitsFieldType('number', v)).toBe(false)
      expect(fitsFieldType('currency', v)).toBe(false)
    }
  })

  it('requires an HTML date the browser will keep', () => {
    expect(fitsFieldType('date', '2026-09-12')).toBe(true)
    // <input type="date"> only holds YYYY-MM-DD, and only a real calendar date.
    for (const v of ['', '12/09/2026', '2026-9-1', '2026-13-01', '2026-02-30', 'large']) {
      expect(fitsFieldType('date', v)).toBe(false)
    }
  })

  it('accepts only the four boolean spellings, case-insensitively', () => {
    for (const v of ['true', 'false', '0', '1', 'TRUE', ' False ']) expect(fitsFieldType('boolean', v)).toBe(true)
    for (const v of ['', 'yes', 'no', '2', 'large']) expect(fitsFieldType('boolean', v)).toBe(false)
  })

  it('requires an absolute URL for url', () => {
    for (const v of ['https://example.com', 'http://a.b/c?d=1', 'mailto:a@b.co']) {
      expect(fitsFieldType('url', v)).toBe(true)
    }
    for (const v of ['', 'example.com', 'not a url', '/relative', 'large']) {
      expect(fitsFieldType('url', v)).toBe(false)
    }
  })

  it('lists exactly the six field types', () => {
    expect([...FIELD_TYPES]).toEqual(['text', 'number', 'currency', 'date', 'boolean', 'url'])
  })
})
