import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { trpc } from '../../api/trpc'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const navigate = useNavigate()

  const login = trpc.auth.login.useMutation()
  const utils = trpc.useUtils()

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await login.mutateAsync({ email, password })
    // The login response sets the session cookie. Run the `auth.me` query and
    // *await* it so the cache holds the freshly-authenticated user before we
    // navigate; otherwise `RequireAuth` reads the stale cached `null` and bounces
    // straight back to `/login`. We `fetch` rather than `invalidate` because on
    // `/login` the `auth.me` query is NOT active, so `invalidate` would only mark
    // it stale without refetching (leaving the user stranded on `/login`).
    await utils.auth.me.fetch()
    setSignedIn(true)
    navigate('/')
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Sign in</h1>

      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button type="submit" disabled={login.isPending}>
        Sign in
      </button>

      {login.error && <p role="alert">{login.error.message}</p>}
      {signedIn && <p>Signed in</p>}
    </form>
  )
}
