import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// `vi.hoisted` runs before the vi.mock factories, so the factory can reference
// these without hitting the top-level-const temporal dead zone (vitest hoists
// vi.mock calls above the imports/body).
const { invalidateList, invalidateGet, editorProps } = vi.hoisted(() => ({
  invalidateList: vi.fn(),
  invalidateGet: vi.fn(),
  editorProps: [] as any[],
}))

vi.mock('react-filerobot-image-editor', () => ({
  TABS: { FINETUNE: 'Finetune', FILTERS: 'Filters', ADJUST: 'Adjust', WATERMARK: 'Watermark', ANNOTATE: 'Annotate', RESIZE: 'Resize' },
  // The package exports the editor as its default export (plus `TABS`). On mount,
  // record the config — which rendition it was pointed at, which tabs it was
  // given — then invoke onSave with a fake edited image to exercise the submit path.
  default: (props: any) => {
    editorProps.push(props)
    props.onSave({ imageCanvas: { toBlob: (cb: any) => cb(new Blob(['x'], { type: 'image/png' })) }, mimeType: 'image/png' })
    return null
  },
}))

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ items: { list: { invalidate: invalidateList }, get: { invalidate: invalidateGet } } }),
    },
    __mocks: { invalidateList, invalidateGet },
  }
})

import { PhotoEditor } from '../src/features/upload/PhotoEditor'

describe('PhotoEditor', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    editorProps.length = 0
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any
  })

  it('posts the edited blob and invalidates item queries on save', async () => {
    const onClose = vi.fn()
    render(<PhotoEditor image={{ id: 7, path: 'uploads/originals/x.png' }} itemId={3} open onClose={onClose} />)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/upload/image/edit', expect.objectContaining({ method: 'POST' }))
    })
    await waitFor(() => expect(invalidateList).toHaveBeenCalled())
    await waitFor(() => expect(invalidateGet).toHaveBeenCalledWith({ id: 3 }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  // The caller decides which rendition this is; the editor just opens what it is
  // handed. That is what lets "Edit photo" and "Edit original photo" share a
  // component, and it is the whole reason the prop stopped being `originalPath`.
  it('opens the rendition the caller named', () => {
    render(<PhotoEditor image={{ id: 7, path: 'uploads/edited/e.png' }} itemId={3} open onClose={vi.fn()} />)
    expect(editorProps.at(-1).source).toBe('/file/uploads/edited/e.png')
  })

  // An empty `tabsIds` is not "no tabs" in filerobot — it is every tab, so the
  // set has to be listed and a regression here is invisible without the assert.
  it('offers no Filters or Watermark tab', () => {
    render(<PhotoEditor image={{ id: 7, path: 'uploads/originals/x.png' }} itemId={3} open onClose={vi.fn()} />)
    const { tabsIds } = editorProps.at(-1)
    expect(tabsIds).not.toContain('Filters')
    expect(tabsIds).not.toContain('Watermark')
    expect(tabsIds).toContain('Finetune')
  })
})
