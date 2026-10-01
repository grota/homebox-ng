import { useEffect, useRef, useState } from 'react'

// A location path clamped to its tail: the leaf is what disambiguates ("which
// `garage`"), so when the path does not fit, the head goes — `…c › d › e`,
// cutting mid-word when the budget demands it — rather than the tail. CSS
// cannot do this: `text-overflow` only eats the right, and `direction: rtl`
// flips bidi handling for mixed-script names. So the longest fitting suffix is
// found by probing, over at most two lines.
//
// Probing sets `textContent` directly and reads `scrollHeight` against the
// clamped `clientHeight`; state updates once, with the winner, so the browser
// paints once. Anything without layout (SSR, jsdom) keeps the full text.
export function TailClamp({
  text,
  lines = 2,
  className,
  title,
  testId,
}: {
  text: string
  lines?: number
  className?: string
  title?: string
  testId?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(text)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let live = true

    const fits = (candidate: string): boolean => {
      el.textContent = candidate
      return el.scrollHeight <= el.clientHeight
    }
    const ellipsize = (tail: string): string => '…' + tail.replace(/^ +/, '')

    const fit = () => {
      if (fits(text)) {
        if (live) setShown(text)
        return
      }
      // Longest suffix that fits behind the ellipsis. `lo` always fits ('…'
      // alone may still overflow a zero box — then the ellipsis stands alone).
      let lo = 0
      let hi = text.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (fits(ellipsize(text.slice(text.length - mid)))) lo = mid
        else hi = mid - 1
      }
      if (live) setShown(ellipsize(text.slice(text.length - lo)))
    }

    fit()
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => fit())
      ro.observe(el)
    }
    // A font swap re-wraps without resizing the box, so the resize observer
    // alone would keep a stale cut.
    void (typeof document !== 'undefined' ? document.fonts?.ready.then(() => fit()).catch(() => {}) : null)
    return () => {
      live = false
      ro?.disconnect()
    }
  }, [text, lines])

  return (
    <div
      ref={ref}
      className={className}
      // The measuring box and the paint box are the same element: the clamp
      // gives `clientHeight` its height and `scrollHeight` the full one, which
      // is the comparison the probe reads. `anywhere` lets a long unbroken
      // segment use the line instead of overflowing it.
      style={{
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: lines,
        overflow: 'hidden',
        overflowWrap: 'anywhere',
      }}
      title={title}
      data-testid={testId}
    >
      {shown}
    </div>
  )
}
