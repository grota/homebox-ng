import sharp, { type Sharp } from 'sharp'

/**
 * The one thumbnail rule. Every thumbnail in the app is rendered through this
 * function — nothing else calls `resize`, `jpeg`, `extract` or `extend` on a photo,
 * and `scripts/regenerate-thumbnails.ts` renders through it too, so changing the
 * rule here changes it everywhere by construction.
 *
 * It was written out four times (upload, edit, unpack crop, seed) before this. The
 * four copies are how the upscaling below went unnoticed for the life of the
 * project.
 *
 * ## Aspect ratio is preserved, always
 *
 * A thumbnail is a **faithful rendition of the whole photo**. How it is fitted into
 * a box is a *display* decision, made where the box is drawn — `object-contain` on a
 * black mat, see
 * `docs/superpowers/specs/2026-09-18-photo-fitting-and-page-width-design.md`.
 * Cropping or padding here would throw the photo's shape away, and no later layout
 * could get it back.
 *
 * ## The long edge is capped, and nothing is ever enlarged
 *
 * Both arguments are load-bearing, and the second is easy to miss:
 *
 * - `fit: 'inside'` inside a square bound caps whichever edge is **longer**, so a
 *   very tall photo comes out narrow rather than 400 wide and enormous. Constraining
 *   only the width made a 332x1557 source into a **400x1876** file — bigger than its
 *   original in both axes.
 * - `withoutEnlargement` is what actually stops that. `fit: 'inside'` on its own
 *   still scales *up* to fill the bound, so an image smaller than 400 would be
 *   inflated and softened. `sharp`'s default for this option is `false`, which is
 *   the whole reason four files in the development data are larger than their
 *   sources.
 */
export const THUMBNAIL_MAX_EDGE = 400

export const renderThumbnail = async (source: Buffer | Sharp): Promise<Buffer> =>
  (Buffer.isBuffer(source) ? sharp(source) : source)
    // A phone photo stores landscape pixels plus an EXIF "rotate" tag, and the
    // JPEG written below carries no metadata — so without this the tag is lost
    // and a portrait photo's thumbnail comes out sideways. A no-op for anything
    // already upright (the unpack crops are).
    .autoOrient()
    .resize({
      width: THUMBNAIL_MAX_EDGE,
      height: THUMBNAIL_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer()
