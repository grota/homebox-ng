// Joins class names, dropping falsy entries. Deliberately not clsx +
// tailwind-merge: it resolves nothing, so a caller cannot override a
// same-property utility the primitive already sets — later classes in the string
// do not win, because Tailwind emits same-property utilities in scale order
// regardless of class order. That is why such knobs are props (`Card`'s
// `padding`, which `p-0` on a caller could never override) or a merge hook
// (`Field`'s `className`, which adds a different property rather than fighting
// one). Appending a class here only works when it sets something the primitive
// does not.
export const cn = (...xs: (string | false | null | undefined)[]): string =>
  xs.filter(Boolean).join(' ')
