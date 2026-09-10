import { describe, it, expect } from 'vitest'
import { hoverScrim } from '../src/ui'

const BLACK = 'rgba(0, 0, 0, 0.18)'
const WHITE = 'rgba(255, 255, 255, 0.18)'

const perceived = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b

// Composite the scrim over the tag colour and report how far the perceived
// brightness moved. A scrim that barely moves it is the failure mode this
// helper exists to avoid — the chip's hover would be invisible.
const shift = (rgb: number[], scrim: string) => {
  const [sr, sg, sb, alpha] = scrim.match(/[\d.]+/g)!.map(Number)
  const out = rgb.map((c, i) => c * (1 - alpha) + [sr, sg, sb][i] * alpha)
  return Math.abs(perceived(out) - perceived(rgb))
}

describe('hoverScrim', () => {
  // The whole point of deriving the wash: a black veil over a near-black tag is
  // invisible, a white veil over a near-white tag likewise. Each colour must get
  // the one that stays visible.
  it('veils a near-black tag in white', () => {
    expect(hoverScrim('#0a0a0a')).toBe(WHITE)
    expect(shift([10, 10, 10], WHITE)).toBeGreaterThan(20)
  })

  it('veils a near-white tag in black', () => {
    expect(hoverScrim('#fafafa')).toBe(BLACK)
    expect(shift([250, 250, 250], BLACK)).toBeGreaterThan(20)
  })

  // The threshold probe: mid-grey sits just above the light/dark line, and
  // either wash moves it the same distance — what matters is that one is chosen
  // and it shows.
  it('veils a mid-tone tag in the wash that still shows', () => {
    expect(hoverScrim('#808080')).toBe(BLACK)
    expect(shift([128, 128, 128], BLACK)).toBeGreaterThan(20)
  })

  // `hexColor` admits the short 3/4-digit forms, so the parser has to as well —
  // a nibble left un-doubled parses to NaN and the comparison falls the wrong way.
  it('parses the short hex forms', () => {
    expect(hoverScrim('#fff')).toBe(BLACK)
    expect(hoverScrim('#000')).toBe(WHITE)
    expect(hoverScrim('#abc')).toBe(BLACK)
  })
})
