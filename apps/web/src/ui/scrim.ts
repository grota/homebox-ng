// The hover wash for a surface painted with a user-chosen colour (the tag facet
// chip). Such a colour is arbitrary data, so no token or class can supply the
// hover state — and an inline `background` beats any `hover:` utility anyway.
//
// Derive the wash from the colour's own luma: a black veil over a light colour,
// a white one over a dark colour, so the hover shifts the surface's brightness
// whichever the user picked. A fixed overlay colour would be invisible on half
// the tags in the catalog.
export function hoverScrim(color: string): string {
  const hex = color.slice(1)
  // `hexColor` also admits the short 3/4-digit forms: double each nibble.
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  // Rec. 601 luma — cheap, and all this has to decide is light vs dark.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luma > 0.5 ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.18)'
}
