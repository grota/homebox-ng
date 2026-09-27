import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'

// The crop saves only when the user says so, so the shared mock records its props and
// waits to be driven (`test/filerobotMock.tsx`), unlike `photoEditor.test.tsx`'s.
vi.mock('react-filerobot-image-editor', async () => await import('./filerobotMock'))

import { PhotoCrop } from '../src/features/upload/PhotoCrop'
import { editorProps } from './filerobotMock'

describe('the crop dialog', () => {
  beforeEach(() => {
    editorProps.length = 0
    // jsdom does not implement these; the component builds an object URL from the
    // picked file, because the file has no server path yet.
    global.URL.createObjectURL = vi.fn(() => 'blob:fake-file') as any
    global.URL.revokeObjectURL = vi.fn() as any
  })

  const file = () => new File(['x'], 'a.png', { type: 'image/png' })

  it('opens on the file itself, with crop and nothing else', () => {
    render(<PhotoCrop file={file()} onSave={vi.fn()} onClose={vi.fn()} />)
    const props = editorProps.at(-1)
    expect(props.source).toBe('blob:fake-file')
    // One tab: crop, rotate, flip — the library renders no tab strip at all for a
    // single tab, and arms the crop tool by its own default.
    expect(props.tabsIds).toEqual(['Adjust'])
  })

  it('saves as jpeg', () => {
    render(<PhotoCrop file={file()} onSave={vi.fn()} onClose={vi.fn()} />)
    const props = editorProps.at(-1)
    // The ratio that carries the photo's own pixels is measured off a stage this
    // mock never lays out — the sizing itself is asserted in the test below, and
    // the pure arithmetic in `photoEditor.test.tsx`.
    expect(props.savingPixelRatio).toBe(1)
    expect(props.defaultSavedImageType).toBe('jpeg')
  })

  // The regression behind "the created photo is soft": the export canvas is always
  // full-size, but it is FILLED from a cache sized by `savingPixelRatio` × the
  // stage. With a stage far smaller than the photo, the ratio has to grow until
  // that cache is photo-dense — a static 1 saves a screenful of pixels at
  // full-size dimensions.
  it('sizes the export ratio from the photo and the stage', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    // jsdom lays out nothing and loads no image: stand in for both.
    vi.stubGlobal('Image', class {
      naturalWidth = 2268
      naturalHeight = 4032
      onload: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    })
    try {
      render(<PhotoCrop file={file()} onSave={vi.fn()} onClose={vi.fn()} />)
      const host = document.querySelector('[class*="70vh"]')
      expect(host).toBeTruthy()
      const stage = document.createElement('div')
      stage.className = 'konvajs-content'
      stage.getBoundingClientRect = () =>
        ({ width: 400, height: 400, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
      host!.appendChild(stage)

      // 4032/400 = 10.08 — the tall edge is what binds, so one pixel over ten.
      await waitFor(() => expect(editorProps.at(-1).savingPixelRatio).toBe(11))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('hands the cropped bytes back, and closes without cropping on dismiss', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<PhotoCrop file={file()} onSave={onSave} onClose={onClose} />)
    const cropped = new Blob(['cropped'], { type: 'image/jpeg' })

    editorProps.at(-1).onSave({ imageCanvas: { toBlob: (cb: any) => cb(cropped) }, mimeType: 'image/jpeg' })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(cropped))

    editorProps.at(-1).onClose()
    expect(onClose).toHaveBeenCalled()
  })

  it('reports a failed conversion instead of rejecting silently', async () => {
    const onSave = vi.fn()
    render(<PhotoCrop file={file()} onSave={onSave} onClose={vi.fn()} />)

    // `atob` throws on this: the base64 fallback is the one path in `toBlob` that can
    // reject, and without a catch it became an unhandled rejection and no message.
    editorProps.at(-1).onSave({ imageBase64: 'not base64!', mimeType: 'image/png' })

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  // The constant stub above makes the live URL and the revoked URL the same string, which
  // is exactly the bug this pair of tests is about — so both count instead, and hand out a
  // different URL per call.
  const countingStub = () => {
    let n = 0
    const revoked: string[] = []
    global.URL.createObjectURL = vi.fn(() => `blob:fake-${++n}`) as any
    global.URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url) }) as any
    return revoked
  }

  // A URL created during render is revoked by an effect cleanup, and `StrictMode` throws
  // away one of its two renders: in dev the committed URL was not the one the cleanup
  // revoked against, so the mounted editor pointed at a dead URL and the dialog showed a
  // broken image. The URL's lifetime has to belong to the effect.
  it('never shows the editor a URL it has revoked, even under StrictMode', () => {
    const revoked = countingStub()

    render(
      <StrictMode>
        <PhotoCrop file={file()} onSave={vi.fn()} onClose={vi.fn()} />
      </StrictMode>,
    )

    const shown = editorProps.map((p) => p.source)
    expect(shown.length).toBeGreaterThan(0)
    for (const source of shown) expect(revoked).not.toContain(source)
  })

  // The other half of the pair: the fix is "revoke at the right moment", not "never
  // revoke" — an object URL left alive leaks the file for the life of the document.
  it('revokes the URL the editor was using when the dialog unmounts', () => {
    const revoked = countingStub()

    const { unmount } = render(<PhotoCrop file={file()} onSave={vi.fn()} onClose={vi.fn()} />)
    const shown = editorProps.at(-1).source
    expect(revoked).not.toContain(shown)

    unmount()
    expect(revoked).toContain(shown)
  })
})
