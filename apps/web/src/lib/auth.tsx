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

// Route guard: redirects unauthenticated visitors away from protected pages to
// `/login`. Renders nothing while the session is loading.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}
