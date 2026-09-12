import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// Regression guard for the photo editor's dead popups.
//
// While a Radix modal `Dialog` is open, `@radix-ui/react-dismissable-layer` sets
// `document.body.style.pointerEvents = "none"` and re-enables it only for the
// dialog's own subtree. Filerobot renders its popups through @scaleflex/ui,
// which portals them to <body> — so they are body children, inherit `none`, and
// stop being hit-testable: every button and slider inside them becomes dead
// (measured in Chromium: `elementFromPoint` at the centre of the confirm
// dialog's Cancel button returned the Konva canvas behind it). `src/index.css`
// carries the one rule that gives those roots their pointer events back.
//
// This asserts the rule's cascade — the property it sets, on exactly the
// elements it has to reach — which is all jsdom can see. jsdom has no layout and
// no hit-testing, so it cannot reproduce the *bug* itself; the browser check
// above is what established it. What this pins is that the rule is present and
// still matches, so deleting or narrowing it fails here instead of shipping.
describe('modal portal roots stay clickable', () => {
  beforeAll(() => {
    // Declared BEFORE `index.css` so only specificity decides between the two:
    // the portal rule is written as `:where(…)` precisely so that an explicit
    // `pointer-events: none` like this one still wins.
    const utility = document.createElement('style')
    utility.textContent = '.pointer-events-none { pointer-events: none; }'
    document.head.append(utility)

    const app = document.createElement('style')
    // `import.meta.url` is not a `file:` URL under vitest's jsdom environment,
    // so resolve the stylesheet against the package root instead.
    app.textContent = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    document.head.append(app)

    // The clamp Radix applies to <body> for as long as the dialog is open.
    document.body.style.pointerEvents = 'none'
  })

  const child = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    document.body.append(el)
    return el
  }

  it('re-enables the portal roots that filerobot renders under <body>', () => {
    // The two containers @scaleflex/ui portals into: `#SfxPopper` (its
    // `usePortal` host, for the pen's opacity/stroke menus) and the confirm
    // dialog's own wrapper, which it appends straight to <body>.
    expect(getComputedStyle(child('div', { id: 'SfxPopper' })).pointerEvents).toBe('auto')
    expect(getComputedStyle(child('div', { class: 'SfxModal-Wrapper' })).pointerEvents).toBe('auto')
  })

  it('leaves the app behind the dialog clamped', () => {
    expect(getComputedStyle(child('div', { id: 'root' })).pointerEvents).toBe('none')
    expect(getComputedStyle(document.body).pointerEvents).toBe('none')
  })

  it('does not outrank an explicit pointer-events declaration', () => {
    // `:where()` keeps the portal rule at zero specificity, so a body-level
    // element that means `none` keeps it.
    expect(getComputedStyle(child('div', { class: 'pointer-events-none' })).pointerEvents).toBe('none')
  })
})
