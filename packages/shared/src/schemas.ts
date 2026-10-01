import { z } from 'zod'
import { ROLES } from './constants.js'

export const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})
export const locationInput = z.object({
  name: z.string().min(1),
  parentId: z.number().int().positive().nullable(),
  description: z.string().nullable().optional(),
})
export const itemTypeInput = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
})
export const itemInput = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  quantity: z.number().int().min(0).default(1),
  unit: z.string().nullable().default(null),
  itemTypeId: z.number().int().positive(),
  locationId: z.number().int().positive().nullable(),
})
// A tag colour is only ever rendered as an inline CSS `background`, so constrain
// it to a hex literal. Unvalidated, any authenticated user could store
// `url(//attacker/pixel.png)` — no script execution, React's CSSOM path blocks
// that, but a stored beacon that leaks each viewer's IP and view timing to an
// attacker-chosen URL, with no length bound. 3/4/6/8 digits covers every form
// `<input type="color">` and the `#888888` default can produce.
export const hexColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export const tagInput = z.object({ name: z.string().min(1), color: z.string().regex(hexColor).default('#888888') })

export const userInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
})
export const userUpdateInput = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLES).optional(),
  password: z.string().min(8).optional(),
})

export type LoginInput = z.infer<typeof loginInput>
export type LocationInput = z.infer<typeof locationInput>
export type ItemTypeInput = z.infer<typeof itemTypeInput>
export type ItemInput = z.infer<typeof itemInput>
export type TagInput = z.infer<typeof tagInput>
export type UserInput = z.infer<typeof userInput>
export type UserUpdateInput = z.infer<typeof userUpdateInput>
