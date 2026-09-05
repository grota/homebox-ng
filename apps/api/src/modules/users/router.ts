import { z } from 'zod'
import { userInput, userUpdateInput } from '@homebox/shared'
import { t, adminProcedure } from '../../trpc.js'
import * as service from './service.js'

// Mutations are admin-only. Inputs: `create` -> userInput; `update` ->
// `{ id, ...userUpdateInput }`; `delete` -> `{ id }`.
const idInput = z.object({ id: z.number().int().positive() })
const updateInput = z.object({ id: z.number().int().positive(), ...userUpdateInput.shape })

export const usersRouter = t.router({
  list: adminProcedure.query(({ ctx }) => service.listUsers(ctx.db)),
  create: adminProcedure.input(userInput).mutation(({ ctx, input }) => service.createUser(ctx.db, input)),
  update: adminProcedure.input(updateInput).mutation(({ ctx, input }) => service.updateUser(ctx.db, input.id, input)),
  delete: adminProcedure.input(idInput).mutation(({ ctx, input }) => service.deleteUser(ctx.db, input.id)),
})
