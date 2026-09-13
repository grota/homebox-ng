import { z } from 'zod'
import type { DetectionProviderImpl } from '../detection/provider.js'

// One rectangle the user drew, and the name they typed for it. Pixel space,
// top-left origin, in the source image's natural size — the same contract
// `DetectionBox` speaks, so nothing is converted on the way in.
export const RegionInputSchema = z.object({
  name: z.string(),
  box: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
  }),
})
export type ManualRegion = z.infer<typeof RegionInputSchema>

// A ceiling, not a target: each region becomes an item row and a cropped file, so
// an accidental thousand-rectangle request should fail fast rather than half-run.
export const RegionsInputSchema = z.array(RegionInputSchema).min(1).max(200)

// Manual unpack as a *box source*, not a second pipeline (ADR-0004). The regions
// arrive as `DetectionBox`es with the typed name as the box label — which is
// exactly what a detection provider produces — so `createItemsFromImage` names,
// crops and persists them without knowing the difference.
//
// `image` and `bounds` are ignored deliberately. The client clamps every
// rectangle to the image and enforces a minimum size; clamping again here would
// be a second place for the two to disagree, and the crop is best-effort anyway.
export const manualProvider = (regions: ManualRegion[]): DetectionProviderImpl => ({
  name: 'manual',
  detectBoxes: async () => regions.map((region) => ({ box: region.box, label: region.name, confidence: 1 })),
})
