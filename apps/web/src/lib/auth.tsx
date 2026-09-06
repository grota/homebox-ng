import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { trpc } from '../api/trpc'

// Returns the current user (derived from the `auth.me` query), or `null` when
// unauthenticated. `isLoading` is exposed so guards can avoid flashing the
// login page while the session cookie is being checked.
export function useAuth() {
  const { data: user, isLoading } = trpc.auth.me.useQuery()
  return { user, isLoading }
}

// True on a fresh first-run instance (no users exist yet) — the SPA uses this to
// route a brand-new install to `/setup` instead of the dead-end `/login`.
export function useSetupRequired() {
  const { data, isLoading } = trpc.auth.requiresSetup.useQuery()
  return { setupRequired: data?.setupRequired ?? false, isLoading }
}

// Route guard: on a first-run instance (no users exist), send the visitor to
// `/setup` — there's no account to log into yet. Rendering nothing while loading.
export function SetupGate({ children }: { children: ReactNode }) {
  const { setupRequired, isLoading } = useSetupRequired()
  if (isLoading) return null
  if (setupRequired) return <Navigate to="/setup" replace />
  return <>{children}</>
}

// Route guard: redirects unauthenticated visitors away from protected pages to
// `/login`. Renders nothing while the session is loading.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

// Route guard: non-admins can't reach the /admin area. An unauthenticated
// visitor is sent to /login; a logged-in non-admin is sent home.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}
