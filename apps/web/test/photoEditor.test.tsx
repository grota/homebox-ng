import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// `vi.hoisted` runs before the vi.mock factories, so the factory can reference
// these without hitting the top-level-const temporal dead zone (vitest hoists
// vi.mock calls above the imports/body).
const { invalidateList, invalidateGet } = vi.hoisted(() => ({
  invalidateList: vi.fn(),
  invalidateGet: vi.fn(),
}))

// The editor saves the moment it mounts here — the flow under test is what happens
// after a save — with the recorded props coming from the shared mock.
vi.mock('react-filerobot-image-editor', async () => await import('./filerobotMock'))

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
import { editorProps, behavior } from './filerobotMock'

behavior.save = (props) =>
  props.onSave({ imageCanvas: { toBlob: (cb: any) => cb(new Blob(['x'], { type: 'image/png' })) }, mimeType: 'image/png' })

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

  // The Text tool is only reachable through the Annotate tab, so this and the
  // assertion above are the pair that keeps it usable: `tabsIds` must still
  // admit Annotate, and the tool must drop the mark this app wants rather than
  // filerobot's lorem-ipsum default at 14px.
  it('defaults the Text tool to a large "X"', () => {
    render(<PhotoEditor image={{ id: 7, path: 'uploads/originals/x.png' }} itemId={3} open onClose={vi.fn()} />)
    const { Text, tabsIds } = editorProps.at(-1)
    expect(Text).toEqual({ text: 'X', fontSize: 120 })
    expect(tabsIds).toContain('Annotate')
  })

  it('offers the tabs in the order the app wants, annotate first', () => {
    render(<PhotoEditor image={{ id: 7, path: 'uploads/originals/x.png' }} itemId={3} open onClose={vi.fn()} />)
    // Exactly four, in exactly this order: a `toContain` would not notice a reorder,
    // which is how the order drifted in the first place.
    expect(editorProps.at(-1).tabsIds).toEqual(['Annotate', 'Adjust', 'Resize', 'Finetune'])
  })

  it("opens on the first tab with that tab's own first tool armed", () => {
    render(<PhotoEditor image={{ id: 7, path: 'uploads/originals/x.png' }} itemId={3} open onClose={vi.fn()} />)
    const { defaultTabId, defaultToolId } = editorProps.at(-1)
    expect(defaultTabId).toBe('Annotate')
    // Not the library's own `Crop`: it is not in the Annotate tab's tool list, so the
    // tab would open with no tool highlighted and no options panel.
    expect(defaultToolId).toBe('Text')
  })
})
