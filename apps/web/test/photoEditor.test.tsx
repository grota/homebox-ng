import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

vi.mock('react-filerobot-image-editor', () => ({
  // The package exports the editor as its default export only (no named export).
  // On mount, invoke onSave with a fake edited image to exercise the submit path.
  default: ({ onSave }: any) => {
    onSave({ imageCanvas: { toBlob: (cb: any) => cb(new Blob(['x'], { type: 'image/png' })) }, mimeType: 'image/png' })
    return null
  },
}))

// `vi.hoisted` runs before the vi.mock factories, so the factory can reference
// these spies without hitting the top-level-const temporal dead zone (vitest
// hoists vi.mock calls above the imports/body).
const { invalidateList, invalidateGet } = vi.hoisted(() => ({
  invalidateList: vi.fn(),
  invalidateGet: vi.fn(),
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
  beforeEach(() => { vi.restoreAllMocks(); global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any })

  it('posts the edited blob and invalidates item queries on save', async () => {
    const onClose = vi.fn()
    render(<PhotoEditor image={{ id: 7, originalPath: 'uploads/originals/x.png' }} itemId={3} open onClose={onClose} />)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/upload/image/edit', expect.objectContaining({ method: 'POST' }))
    })
    await waitFor(() => expect(invalidateList).toHaveBeenCalled())
    await waitFor(() => expect(invalidateGet).toHaveBeenCalledWith({ id: 3 }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
