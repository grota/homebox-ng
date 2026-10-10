import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { renderThumbnail, THUMBNAIL_MAX_EDGE } from '../src/modules/images/thumbnail'

// The first test anywhere to pin what a thumbnail actually is. Until now the 400,
// the aspect preservation and the no-enlargement rule were asserted nowhere, and
// the e2e assertion that used to look at a thumbnail was deliberately deleted — so
// all three could change without a single test noticing.
//
// These are cheap because `renderThumbnail` is the only thing that resizes a photo.
// Before the rule was extracted it existed in four copies, and it was the copies
// that let the upscaling go unnoticed.
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .png()
    .toBuffer()

const sizeOf = async (buffer: Buffer) => {
  const meta = await sharp(buffer).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}

describe('renderThumbnail', () => {
  it('caps the long edge of a landscape photo at 400, keeping its shape', async () => {
    expect(await sizeOf(await renderThumbnail(await solid(1200, 800)))).toEqual({
      width: THUMBNAIL_MAX_EDGE,
      height: 267, // 400 * 800/1200, rounded
    })
  })

  // The case that made the old rule produce a file larger than its source: a very
  // tall photo came out 400 *wide* and 1876 tall. Capping the long edge instead
  // means a tall photo is a narrow, short file.
  it('caps the long edge of a tall photo, which is its height', async () => {
    expect(await sizeOf(await renderThumbnail(await solid(400, 1200)))).toEqual({
      width: 133, // 400 * 400/1200, rounded
      height: THUMBNAIL_MAX_EDGE,
    })
  })

  // `fit: 'inside'` alone still scales UP to fill the bound, so this is the
  // assertion that actually pins `withoutEnlargement`.
  it('never enlarges a photo smaller than the bound', async () => {
    expect(await sizeOf(await renderThumbnail(await solid(320, 200)))).toEqual({ width: 320, height: 200 })
  })

  it('leaves a photo that is exactly the bound alone', async () => {
    expect(await sizeOf(await renderThumbnail(await solid(400, 400)))).toEqual({ width: 400, height: 400 })
  })

  // The unpack path hands in a `Sharp` that has already been extracted from the
  // source photo rather than a buffer of the crop, so the overload is load-bearing.
  it('accepts an already-configured Sharp pipeline', async () => {
    const source = sharp(await solid(600, 600))
    const cropped = source.extract({ left: 100, top: 100, width: 300, height: 150 })
    expect(await sizeOf(await renderThumbnail(cropped))).toEqual({ width: 300, height: 150 })
  })

  // A phone photo: 400×300 landscape pixels plus EXIF orientation 6 ("rotate 90°
  // clockwise"), which every viewer shows as a 300×400 portrait. The thumbnail
  // carries no metadata, so it has to be rendered upright.
  it('renders a rotated phone photo upright', async () => {
    const phone = await sharp(await solid(400, 300)).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    expect(await sizeOf(await renderThumbnail(phone))).toEqual({ width: 300, height: 400 })
  })

  it('renders jpeg', async () => {
    const meta = await sharp(await renderThumbnail(await solid(800, 600))).metadata()
    expect(meta.format).toBe('jpeg')
  })
})
