import { eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { users } from '@homebox/db'
import { loginInput } from '@homebox/shared'
import { z } from 'zod'
import { t, publicProcedure, protectedProcedure } from '../../trpc.js'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import { createSession, invalidateSession } from '../../auth/sessions.js'
import { parseSessionCookie } from '../../context.js'

const setupInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
})

const changePasswordInput = z.object({ current: z.string().min(8), next: z.string().min(8) })

const USER_FIELDS = { id: users.id, name: users.name, email: users.email, role: users.role, mustChangePassword: users.mustChangePassword } as const

export const authRouter = t.router({
  // Bootstraps the initial admin. Only allowed when no user exists yet.
  setup: publicProcedure.input(setupInput).mutation(async ({ ctx, input }) => {
    const existing = ctx.db.select().from(users).limit(1).get()
    if (existing) throw new TRPCError({ code: 'FORBIDDEN' })

    const inserted = ctx.db
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: 'admin',
      })
      .returning(USER_FIELDS)
      .get()

    return inserted
  }),

  // Logs in an existing user and sets the session cookie.
  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
    const found = ctx.db.select().from(users).where(eq(users.email, input.email)).get()
    const secret = process.env.SESSION_SECRET ?? ''

    // A corrupted `password_hash` row makes argon2's `verify` throw; treat that
    // as a failed login (`UNAUTHORIZED`) rather than surfacing a 500.
    let passwordOk = false
    if (found) {
      try {
        passwordOk = await verifyPassword(input.password, found.passwordHash)
      } catch {
        passwordOk = false
      }
    }
    if (!found || !passwordOk) throw new TRPCError({ code: 'UNAUTHORIZED' })

    const { token } = createSession(ctx.db, found.id, secret)
    ctx.res.header('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Path=/`)
    return { id: found.id, name: found.name, email: found.email, role: found.role, mustChangePassword: found.mustChangePassword }
  }),

  // Returns the current user (full shape), or null when unauthenticated.
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null
    const user = ctx.db.select(USER_FIELDS).from(users).where(eq(users.id, ctx.user.id)).get()
    return user ?? null
  }),

  // Allows an authenticated user to change their own password. A correct
  // current password clears the forced-change flag.
  changePassword: protectedProcedure.input(changePasswordInput).mutation(async ({ ctx, input }) => {
    const user = ctx.db.select().from(users).where(eq(users.id, ctx.user!.id)).get()
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' })
    if (!(await verifyPassword(input.current, user.passwordHash)))
      throw new TRPCError({ code: 'FORBIDDEN', message: 'current password is incorrect' })
    await ctx.db.update(users)
      .set({ passwordHash: await hashPassword(input.next), mustChangePassword: false })
      .where(eq(users.id, user.id))
    return { ok: true }
  }),

  // True when no user exists yet (fresh first-run instance). The SPA uses this
  // to route a brand-new install to `/setup` instead of the dead-end `/login`.
  requiresSetup: publicProcedure.query(async ({ ctx }) => {
    const existing = ctx.db.select({ id: users.id }).from(users).limit(1).get()
    return { setupRequired: existing == null }
  }),

  // Invalidates the session and clears the cookie.
  logout: publicProcedure.mutation(async ({ ctx }) => {
    const token = parseSessionCookie(ctx.req.headers.cookie)
    if (token) invalidateSession(ctx.db, token, process.env.SESSION_SECRET ?? '')
    ctx.res.header('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
    return { ok: true }
  }),
})
