// Joins class names, dropping falsy entries. Deliberately not clsx +
// tailwind-merge: variants are chosen by prop, not by callers overriding
// classes, so there is no conflict-resolution case to pay a dependency for.
export const cn = (...xs: (string | false | null | undefined)[]): string =>
  xs.filter(Boolean).join(' ')
