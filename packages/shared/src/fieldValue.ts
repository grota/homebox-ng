// One definition of "does this stored value make sense as this field type",
// shared by the API's gate and the web's pre-warning so the two cannot drift.
//
// The predicate mirrors what the *browser* accepts, because that is what
// actually breaks: the item form renders `type="url"` for `url` (a value that is
// not a valid absolute URL fails constraint validation and blocks submit
// entirely) and `type="number"`/`type="date"` for the rest, whose value
// sanitization silently BLANKS the display while React state keeps the old
// value. A value that does not fit must never be allowed to survive a type
// change.
//
// It errs strict: `number` uses an explicit floating-point grammar rather than
// `Number()`, which would wrongly accept '0x10' and 'Infinity'.

export const FIELD_TYPES = ['text', 'number', 'currency', 'date', 'boolean', 'url'] as const

export type FieldType = (typeof FIELD_TYPES)[number]

// HTML's "valid floating-point number", which is what a number input holds.
const FLOAT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

// `<input type="date">` holds exactly YYYY-MM-DD, and only a real calendar date
// fits it — the Date constructor rolls '2026-02-30' over into March, so the
// round-trip check is what rejects it.
const isRealDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const BOOLEANS = new Set(['true', 'false', '0', '1'])

const isAbsoluteUrl = (value: string): boolean => {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

export const fitsFieldType = (fieldType: FieldType, value: string): boolean => {
  switch (fieldType) {
    case 'text':
      return true
    case 'number':
    case 'currency': {
      const trimmed = value.trim()
      // `trimmed !== ''` matters: Number('') is 0, and Number('  ') too.
      return trimmed !== '' && FLOAT.test(trimmed)
    }
    case 'date':
      return isRealDate(value)
    case 'boolean':
      return BOOLEANS.has(value.trim().toLowerCase())
    case 'url':
      return isAbsoluteUrl(value)
  }
}
