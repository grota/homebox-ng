import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { useAuth } from '../../lib/auth'

export function SetupPage() {
  const { user, isLoading } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const navigate = useNavigate()

  const setup = trpc.auth.setup.useMutation()
  const utils = trpc.useUtils()

  // The setup route is only meaningful before an account exists. If a user is
  // already present, send them home.
  if (isLoading) return null
  if (user) return <Navigate to="/" replace />

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await setup.mutateAsync({ name, email, password })
    // `auth.setup` does not auto-login, so the admin must sign in. Run the
    // `auth.me` query so the cache reflects reality (no session yet → `null`);
    // `RequireAuth` then routes to `/login` instead of flashing a stale state.
    // We `fetch` rather than `invalidate` because `invalidate` only refetches
    // *active* queries, and on `/setup` the query is active but the result would
    // not be awaited before navigation.
    await utils.auth.me.fetch()
    setDone(true)
    navigate('/')
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Setup</h1>

      <div>
        <label htmlFor="name">Name</label>
        <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button type="submit" disabled={setup.isPending}>
        Create account
      </button>

      {setup.error && <p role="alert">{setup.error.message}</p>}
      {done && <p>Account created</p>}
    </form>
  )
}
