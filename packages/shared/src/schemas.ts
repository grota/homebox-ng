import { z } from 'zod'

export const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})
export const locationInput = z.object({
  name: z.string().min(1),
  parentId: z.number().int().positive().nullable(),
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
export const tagInput = z.object({ name: z.string().min(1), color: z.string().default('#888888') })

export type LoginInput = z.infer<typeof loginInput>
export type LocationInput = z.infer<typeof locationInput>
export type ItemTypeInput = z.infer<typeof itemTypeInput>
export type ItemInput = z.infer<typeof itemInput>
export type TagInput = z.infer<typeof tagInput>
