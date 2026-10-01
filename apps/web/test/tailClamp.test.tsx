import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { TailClamp } from '../src/ui/TailClamp'

// jsdom lays nothing out, so the probe's two facts — the clamped box height
// and the content height — are modelled here: every char is 10px, every line
// 200px (20 chars), and the box holds `budgetLines` lines. Nothing else is
// stubbed: the search runs for real against these numbers.
let budgetLines = 2
const measure = (el: HTMLElement) => {
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => budgetLines * 20 })
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => Math.ceil((el.textContent?.length ?? 0) / 20) * 20,
  })
}

let roCallback: (() => void) | null = null
beforeEach(() => {
  budgetLines = 2
  roCallback = null
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        roCallback = cb
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const show = (text: string) => {
  render(<TailClamp text={text} testId="tail" />)
  const el = screen.getByTestId('tail')
  measure(el)
  act(() => {
    roCallback?.()
  })
  return el.textContent ?? ''
}

describe('TailClamp', () => {
  it('renders short text whole, with no ellipsis', () => {
    render(<TailClamp text="trastero › Maleta azul" testId="tail" />)
    expect(screen.getByTestId('tail')).toHaveTextContent('trastero › Maleta azul')
  })

  // 2 lines hold 40 chars: the head goes and the tail stays readable.
  it('keeps the longest fitting tail behind an ellipsis', () => {
    const text = 'aa › bb › cc › dd › ee › ff › gg › hh › ii › jj'
    const shown = show(text)
    expect(shown[0]).toBe('…')
    expect(shown.length).toBeLessThanOrEqual(41)
    expect(text.endsWith(shown.slice(1))).toBe(true)
  })

  // No word to break on: the cut lands mid-word rather than giving up.
  it('cuts mid-word when nothing fits whole', () => {
    const shown = show('a'.repeat(100))
    expect(shown[0]).toBe('…')
    expect(shown.length).toBeLessThanOrEqual(41)
  })

  it('refits when the text or the budget changes', () => {
    const { rerender } = render(<TailClamp text={'a'.repeat(100)} testId="tail" />)
    const el = screen.getByTestId('tail')
    measure(el)
    act(() => {
      roCallback?.()
    })
    const cut = el.textContent ?? ''
    expect(cut[0]).toBe('…')

    // Shorter text fits whole again.
    rerender(<TailClamp text="garage" testId="tail" />)
    expect(el).toHaveTextContent('garage')

    // More room fits more tail.
    rerender(<TailClamp text={'a'.repeat(100)} testId="tail" />)
    budgetLines = 4
    act(() => {
      roCallback?.()
    })
    expect((el.textContent ?? '').length).toBeGreaterThan(cut.length)
  })
})
