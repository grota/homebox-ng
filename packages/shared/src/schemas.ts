import { z } from 'zod'
import { ROLES } from './constants.js'

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
