import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// Same shape as `photoEditor.test.tsx`: record the config the component hands the
// editor, and hand `onSave` a fake canvas. Filerobot's canvas is not driven here —
// its interaction is too brittle for that, by the repo's own policy.
const { cropProps } = vi.hoisted(() => ({ cropProps: [] as any[] }))

vi.mock('react-filerobot-image-editor', () => ({
  TABS: { FINETUNE: 'Finetune', FILTERS: 'Filters', ADJUST: 'Adjust', WATERMARK: 'Watermark', ANNOTATE: 'Annotate', RESIZE: 'Resize' },
  TOOLS: { TEXT: 'Text', PEN: 'Pen', CROP: 'Crop' },
  default: (props: any) => {
    cropProps.push(props)
    return null
  },
}))

import { PhotoCrop } from '../src/features/upload/PhotoCrop'

describe('the crop dialog', () => {
  beforeEach(() => {
    cropProps.length = 0
    // jsdom does not implement these; the component builds an object URL from the
    // picked file, because the file has no server path yet.
    global.URL.createObjectURL = vi.fn(() => 'blob:fake-file') as any
    global.URL.revokeObjectURL = vi.fn() as any
  })

  const file = () => new File(['x'], 'a.png', { type: 'image/png' })

  it('opens on the file itself, with crop and nothing else', () => {
    render(<PhotoCrop file={file()} onSave={vi.fn()} onClose={vi.fn()} />)
    const props = cropProps.at(-1)
    expect(props.source).toBe('blob:fake-file')
    // One tab: crop, rotate, flip — the library renders no tab strip at all for a
    // single tab, and arms the crop tool by its own default.
    expect(props.tabsIds).toEqual(['Adjust'])
  })

  it('exports at the source pixels, as jpeg', () => {
    render(<PhotoCrop file={file()} onSave={vi.fn()} onClose={vi.fn()} />)
    const props = cropProps.at(-1)
    // `savingPixelRatio` multiplies the OUTPUT canvas, so the edit flow's 4 would
    // store the crop at four times its pixel size — and this blob becomes the
    // photo's original (ADR-0012), not a rendition of one.
    expect(props.savingPixelRatio).toBe(1)
    expect(props.defaultSavedImageType).toBe('jpeg')
  })

  it('hands the cropped bytes back, and closes without cropping on dismiss', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<PhotoCrop file={file()} onSave={onSave} onClose={onClose} />)
    const cropped = new Blob(['cropped'], { type: 'image/jpeg' })

    cropProps.at(-1).onSave({ imageCanvas: { toBlob: (cb: any) => cb(cropped) }, mimeType: 'image/jpeg' })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(cropped))

    cropProps.at(-1).onClose()
    expect(onClose).toHaveBeenCalled()
  })
})
